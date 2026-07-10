// Terminal Server — runs as a forked child process.
// Owns all PTY processes, event watchers, scrollback buffers, and session persistence.
// Communicates with Electron main via process.send() / process.on('message').

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { spawn, execSync } from 'child_process';
import { CopilotEvent, CopilotEventSource, FileWatcherEventSourceFactory } from './event-source';
import { formatToolStatus } from './events-watcher';
import type { MainToServer, ServerToMain, MsgSetSessionMeta, MsgGetSessionMeta, MsgQueryAgentStatuses } from './protocol';
import { CopilotSdkBackend, NodePtyBackend, UiServerBackend, resolveCopilotCliPath, sanitizeCopilotPath, TerminalBackend, TerminalProcess } from './terminal-backend';
import {
  addAgentViewer,
  hasActiveViewer as hasActiveViewerForMaps,
  removeAgentViewer,
  type ViewerMaps,
} from './agent-viewers';
import {
  shouldForwardSharedHostData,
  viewersToDeactivate,
} from './office-foreground';
import { repairDuplicateSessionIds } from './session-repair';
import { registerPty, unregisterPty } from './pty-registry';

// ── State ───────────────────────────────────────────────────────

interface PtyProcess {
  pid: number;
  process: TerminalProcess;
  agentId: string;
  sessionId: string;
  workingDir?: string;
}

const ptyProcesses: Map<string, PtyProcess> = new Map();

// ── Feature 002 forensic logging ──
// Set to true (or define COPILOT_OFFICE_DEBUG_COLD_START=1) to surface the
// per-agent cold-start log lines documented in
// `specs/002-fix-terminal-cold-start/contracts/terminal-protocol.md`.
// Default false so production builds stay quiet.
const DEBUG_COLD_START = process.env.COPILOT_OFFICE_DEBUG_COLD_START === '1';

// Dual-key viewer bookkeeping (R-002 — see electron/terminal/agent-viewers.ts
// for the full invariant). `agentToTerminal` maps a viewer-side composite key
// to the PTY's original terminal key for transferred fleet sessions;
// `activeAgentViewers` tracks every key with a live viewer attached.
//
// MUTATIONS THAT MAY INVOLVE TRANSFERRED SESSIONS MUST GO THROUGH
// addAgentViewer / removeAgentViewer / hasActiveViewer so both the alias
// key and the original PTY key stay in sync. Direct `Set.add` / `Set.delete`
// calls are intentionally allowed in non-transfer cleanup paths (PTY exit,
// reset-session, shutdown) where the dual-key contract does not apply.
const agentToTerminal: Map<string, string> = new Map();
const activeAgentViewers: Set<string> = new Set();
// Composite keys whose copilot-events must be mirrored to main-process consumers
// (e.g. the Teams service) even when no renderer is viewing the agent.
const agentForwardKeys: Set<string> = new Set();
// Last time (ms epoch) each composite key's PTY produced output. Used by the
// programmatic-submit path to detect when the Ink TUI has settled (output idle)
// before injecting Enter, so a second queued prompt isn't submitted mid-render.
const lastPtyDataAt: Map<string, number> = new Map();
const viewerMaps: ViewerMaps = { activeAgentViewers, agentToTerminal };
// ui-server shared-host foreground tracking. Under the ui-server backend every
// agent in an office shares ONE host TUI (`runtime.rawPty`); its output only
// ever renders the *foreground* session, yet all agents' onData callbacks fire.
// This maps officeId → the composite key of the agent that currently owns the
// shared stream, so rendered output is attributed to exactly one agent and can't
// leak into another session's scrollback/live view. Only meaningful for
// ui-server (node-pty agents own a private PTY each).
const officeForegroundCk: Map<string, string> = new Map();
const agentWatchers: Map<string, CopilotEventSource> = new Map();
let terminalBackend: TerminalBackend | null = null;
// Lazily-created node-pty backend used as a start-time fallback when the
// ui-server backend fails to bring an office runtime online (FR-010 / T039):
// selection-time probe success is necessary but not sufficient (the resolved
// CLI may not actually host --ui-server), so a failed start must never leave an
// agent unstarted — we transparently retry once with node-pty.
let nodePtyFallbackBackend: TerminalBackend | null = null;
function getNodePtyFallbackBackend(): TerminalBackend | null {
  if (terminalBackend && terminalBackend.name === 'node-pty') return terminalBackend;
  if (!nodePtyFallbackBackend) {
    nodePtyFallbackBackend = NodePtyBackend.tryCreate();
  }
  return nodePtyFallbackBackend;
}
const eventSourceFactory = new FileWatcherEventSourceFactory();

// Track per-agent ready state so it can be queried by the renderer
const agentReadyState: Map<string, boolean> = new Map();

// Track per-agent turn activity (between turn_start and turn_end)
const agentInTurn: Map<string, boolean> = new Map();

// Monotonic count of `user.message` events seen per terminal key, plus the text of
// the most recent one. Together they let the programmatic-submit path confirm that
// the CLI accepted OUR specific prompt: it snapshots the count, presses Enter, and
// re-presses until the count advances AND the latest user.message text matches the
// prompt we pasted — a closed-loop confirm that beats guessing render timing, and
// won't false-positive on a human typing concurrently in the same session.
const userMessageSeq: Map<string, number> = new Map();
const lastUserMessageText: Map<string, string> = new Map();

/** Normalize prompt/user-message text for tolerant equality (collapse whitespace). */
function normalizePromptText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// Per-agent raw scrollback buffer (preserves ANSI escape sequences)
const MAX_BUFFER_BYTES = 512 * 1024; // 512 KB
const agentScrollbackBuffers: Map<string, string[]> = new Map();
const agentScrollbackBytes: Map<string, number> = new Map();

// Session persistence — per-office session files: .data/{officeId}.sessions.json
const DATA_DIR = path.join(process.cwd(), '.data');
const OLD_SESSION_FILE = path.join(DATA_DIR, 'copilot-office-sessions.json');
const OFFICES_FILE = path.join(DATA_DIR, 'copilot-offices.json');

// Per-office session state
interface OfficeSessionData {
  sessionIds: Map<string, string>;          // agentId → current sessionId
  sessionHistory: Map<string, string[]>;    // agentId → past sessionIds
  sessionMeta: Map<string, { title: string }>; // agentId → metadata
}

const officeSessions: Map<string, OfficeSessionData> = new Map();
const hasAutoTitled: Set<string> = new Set(); // keyed by `${officeId}:${agentId}`

function getSessionFile(officeId: string): string {
  return path.join(DATA_DIR, `${officeId}.sessions.json`);
}

function getOfficeSession(officeId: string): OfficeSessionData {
  let data = officeSessions.get(officeId);
  if (!data) {
    data = { sessionIds: new Map(), sessionHistory: new Map(), sessionMeta: new Map() };
    officeSessions.set(officeId, data);
  }
  return data;
}

// Composite key for PTY/runtime maps: `${officeId}:${agentId}`
function compositeKey(officeId: string, agentId: string): string {
  return `${officeId}:${agentId}`;
}

// Clear an office's shared-host foreground pointer only when it currently points
// at `ck` (i.e. the foreground agent's PTY is being destroyed). A later start or
// attach re-establishes the foreground. See `officeForegroundCk`.
function clearForegroundIf(officeId: string, ck: string): void {
  if (officeForegroundCk.get(officeId) === ck) officeForegroundCk.delete(officeId);
}

/**
 * Check if a composite key has an active viewer, including alias keys.
 * Delegates to the dual-key helper so transferred fleet sessions are handled
 * uniformly (R-002). See `electron/terminal/agent-viewers.ts` for the invariant.
 */
function hasActiveViewer(ck: string): boolean {
  return hasActiveViewerForMaps(ck, viewerMaps);
}

// ── Helpers ─────────────────────────────────────────────────────

function send(msg: ServerToMain): void {
  if (process.send) {
    process.send(msg);
  }
}

function appendToScrollback(agentId: string, data: string): void {
  let buf = agentScrollbackBuffers.get(agentId);
  if (!buf) {
    buf = [];
    agentScrollbackBuffers.set(agentId, buf);
    agentScrollbackBytes.set(agentId, 0);
  }
  buf.push(data);
  const currentBytes = (agentScrollbackBytes.get(agentId) || 0) + data.length;
  agentScrollbackBytes.set(agentId, currentBytes);
  // Trim oldest chunks if over byte limit
  while ((agentScrollbackBytes.get(agentId) || 0) > MAX_BUFFER_BYTES && buf.length > 1) {
    const removed = buf.shift()!;
    agentScrollbackBytes.set(agentId, (agentScrollbackBytes.get(agentId) || 0) - removed.length);
  }
}

async function loadOfficeSessionFile(officeId: string): Promise<void> {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const filePath = getSessionFile(officeId);
    const raw = await fs.promises.readFile(filePath, 'utf8').catch(() => null);
    const data = getOfficeSession(officeId);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.current && typeof parsed.current === 'object') {
        data.sessionIds = new Map(Object.entries(parsed.current));
        data.sessionHistory = new Map(
          Object.entries(parsed.history || {}).map(([k, v]) => [k, v as string[]])
        );
        data.sessionMeta = new Map(
          Object.entries(parsed.metadata || {}).map(([k, v]) => [k, v as { title: string }])
        );
      } else {
        // Legacy flat format: { agentId: sessionId }
        data.sessionIds = new Map(Object.entries(parsed));
        data.sessionHistory = new Map();
        data.sessionMeta = new Map();
        await saveOfficeSessionFile(officeId);
      }
      // V3 (spec 002): repair duplicate sessionIds across agents in this office.
      // First occurrence wins; subsequent duplicates get a freshly minted UUID.
      const repaired = repairDuplicateSessionIds(officeId, data);
      if (repaired) {
        await saveOfficeSessionFile(officeId);
      }
      console.log(`[TermServer] Loaded sessions for ${officeId}: ${data.sessionIds.size} current, ${data.sessionHistory.size} history`);
    }
  } catch (e) {
    console.error(`[TermServer] Failed to load sessions for ${officeId}:`, e);
  }
}

async function saveOfficeSessionFile(officeId: string): Promise<void> {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const data = getOfficeSession(officeId);
    const json = {
      current: Object.fromEntries(data.sessionIds),
      history: Object.fromEntries(data.sessionHistory),
      metadata: Object.fromEntries(data.sessionMeta),
    };
    await fs.promises.writeFile(getSessionFile(officeId), JSON.stringify(json, null, 2));
  } catch (e) {
    console.error(`[TermServer] Failed to save sessions for ${officeId}:`, e);
  }
}

async function createEmptySessionFile(officeId: string): Promise<void> {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const filePath = getSessionFile(officeId);
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    // File already exists — load it instead of overwriting
    await loadOfficeSessionFile(officeId);
  } catch {
    // File doesn't exist — create empty
    const empty = { current: {}, history: {}, metadata: {} };
    await fs.promises.writeFile(filePath, JSON.stringify(empty, null, 2));
    getOfficeSession(officeId); // ensure in-memory entry
    console.log(`[TermServer] Created empty session file for ${officeId}: ${filePath}`);
  }
}

function archiveSessionId(officeId: string, agentId: string): void {
  const data = getOfficeSession(officeId);
  const oldId = data.sessionIds.get(agentId);
  if (oldId) {
    const history = data.sessionHistory.get(agentId) || [];
    if (!history.includes(oldId)) {
      history.push(oldId);
      data.sessionHistory.set(agentId, history);
    }
  }
}

/** Migrate the old global session file to per-office files. */
async function migrateGlobalSessionFile(): Promise<void> {
  try {
    const migratedMarker = OLD_SESSION_FILE + '.migrated';
    // Skip if already migrated
    try {
      await fs.promises.access(migratedMarker, fs.constants.F_OK);
      return;
    } catch { /* not migrated yet */ }

    // Check if old global file exists
    let oldRaw: string | null = null;
    try {
      oldRaw = await fs.promises.readFile(OLD_SESSION_FILE, 'utf8');
    } catch {
      return; // no old file to migrate
    }

    // Load offices list to find the first office
    let firstOfficeId = 'office-0';
    try {
      const officesRaw = await fs.promises.readFile(OFFICES_FILE, 'utf8');
      const officesData = JSON.parse(officesRaw);
      if (Array.isArray(officesData.offices) && officesData.offices.length > 0) {
        // Use the first office in the array (index 0)
        firstOfficeId = officesData.offices[0].id || 'office-0';
      }
    } catch { /* use default */ }

    // Copy old sessions to first office's file
    const firstOfficeFile = getSessionFile(firstOfficeId);
    try {
      await fs.promises.access(firstOfficeFile, fs.constants.F_OK);
      // First office file already exists — don't overwrite
    } catch {
      await fs.promises.writeFile(firstOfficeFile, oldRaw);
      console.log(`[TermServer] Migrated global sessions to ${firstOfficeFile}`);
    }

    // Rename old file as backup
    await fs.promises.rename(OLD_SESSION_FILE, migratedMarker);
    console.log(`[TermServer] Renamed old session file to ${migratedMarker}`);
  } catch (e) {
    console.error('[TermServer] Migration error:', e);
  }
}

/** Load all per-office session files from .data/ directory. */
async function loadAllOfficeSessions(): Promise<void> {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });

  // Run migration first
  await migrateGlobalSessionFile();

  // Discover all *.sessions.json files
  try {
    const files = await fs.promises.readdir(DATA_DIR);
    for (const file of files) {
      const match = file.match(/^(.+)\.sessions\.json$/);
      if (match) {
        await loadOfficeSessionFile(match[1]);
      }
    }
  } catch (e) {
    console.error('[TermServer] Failed to scan session files:', e);
  }
}

function getTerminalKey(officeId: string, agentId: string): string | null {
  const ck = compositeKey(officeId, agentId);
  const assignedKey = agentToTerminal.get(ck);
  if (assignedKey && ptyProcesses.has(assignedKey)) return assignedKey;
  if (ptyProcesses.has(ck)) return ck;
  return null;
}

/**
 * Inject a full prompt into the interactive Copilot CLI (Ink/React TUI) running
 * under node-pty, and submit it. There is no programmatic submit for a raw PTY,
 * so we simulate a paste + Enter the way a human would:
 *
 *   1. Ctrl+U clears any half-typed input.
 *   2. Bracketed paste (`ESC[200~ … ESC[201~`) inserts the text as one unit —
 *      this stops `@`/`/` from triggering the TUI's file/command menus and stops
 *      the re-render storm from dropping characters.
 *   3. Closed-loop Enter. Ink detaches stdin while it re-renders, so an Enter sent
 *      mid-render is silently dropped — the failure mode where the prompt is pasted
 *      but never submitted (a second queued turn, or a stale/unviewed session after
 *      an office switch). Blind timed Enters can't reliably tell when the TUI is
 *      ready. Instead we snapshot the `user.message` counter (which the CLI bumps
 *      only when it actually accepts a prompt), press Enter, and re-press on an
 *      interval until that counter advances — positive confirmation the prompt was
 *      accepted — capped so we never wedge. Extra Enters on an empty input are no-ops.
 *
 * Response capture is unaffected — it comes from the EventsWatcher tailing
 * events.jsonl (assistant.message → turn_end), not from this input path.
 */
function submitViaKeystrokes(proc: TerminalProcess, prompt: string, ck: string): void {
  const text = prompt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const safeWrite = (data: string) => {
    try { proc.write(data); } catch { /* pty may have exited */ }
    // Count our own writes as PTY activity so the idle clock resets here. Without
    // this, a stale session (e.g. after an office switch left it idle) has a very
    // old `lastPtyDataAt`, so the pre-Enter `waitForIdle` reads it, resolves
    // instantly, and fires Enter before the bracketed paste has finished rendering
    // — Ink drops the Enter mid-render and the text sits typed-but-unsubmitted.
    // Resetting on write forces `waitForIdle` to wait for the paste's echo/render
    // to settle (or at least a full `quietMs` floor) before Enter.
    lastPtyDataAt.set(ck, Date.now());
  };
  // Resolve once the PTY has produced no output for `quietMs`, or `capMs` elapses.
  const waitForIdle = (quietMs: number, capMs: number): Promise<void> =>
    new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const last = lastPtyDataAt.get(ck) ?? 0;
        if (Date.now() - last >= quietMs || Date.now() - start >= capMs) resolve();
        else setTimeout(tick, 50);
      };
      tick();
    });
  void (async () => {
    // Let any prior turn's final render settle before touching the input line.
    await waitForIdle(300, 3000);
    safeWrite('\x15'); // Ctrl+U — clear the input line
    safeWrite(`\x1b[200~${text}\x1b[201~`); // bracketed paste
    // Let the paste's echo/re-render settle so the Enter isn't dropped mid-render.
    await waitForIdle(250, 2000);

    // Closed-loop submit. Blind timed Enters are unreliable: if the Ink TUI is
    // still re-rendering (e.g. a stale/unviewed session after an office switch, or
    // the tail end of a prior turn), an Enter is silently dropped and the pasted
    // text sits unsubmitted. Instead, press Enter and wait for the CLI to write a
    // `user.message` event whose text matches this prompt (proof OUR prompt was
    // accepted — a bare counter could be advanced by a human typing concurrently in
    // the same session). If not yet accepted, press Enter again. Requiring the count
    // to advance too means an identical re-send still submits. Extra Enters on an
    // already-empty input are harmless no-ops.
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const want = normalizePromptText(text);
    const baseline = userMessageSeq.get(ck) ?? 0;
    const accepted = () =>
      (userMessageSeq.get(ck) ?? 0) > baseline && lastUserMessageText.get(ck) === want;
    const MAX_ATTEMPTS = 12; // ~6s worst case at 500ms spacing
    const POLL_MS = 500;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !accepted(); attempt++) {
      safeWrite('\r'); // submit
      // Poll in small slices so we react quickly once the event lands.
      for (let waited = 0; waited < POLL_MS && !accepted(); waited += 50) {
        await delay(50);
      }
    }
    if (!accepted()) {
      console.warn(`[TermServer] submitViaKeystrokes: prompt not confirmed accepted after ${MAX_ATTEMPTS} Enter attempts for ${ck} — it may not have submitted.`);
    }
  })();
}

function killAllPtyProcesses(): void {
  console.log(`[TermServer] Killing ${ptyProcesses.size} PTY processes`);
  ptyProcesses.forEach((proc) => killPtyProcess(proc));
  ptyProcesses.clear();
  agentToTerminal.clear();
  agentWatchers.forEach((w) => w.stop());
  agentWatchers.clear();
  // Note: each killPtyProcess() already unregistered its own PID from the
  // registry, so no blanket reset is needed here (a reset would also wipe a
  // co-running instance's live entries).
}

/** Platform-aware process-tree kill. On Windows, uses taskkill /T /F to kill
 *  the entire tree (shell + copilot CLI + children). Single canonical kill
 *  function — all PTY kill sites must use this, never bare proc.process.kill(). */
function killPtyProcess(proc: PtyProcess): void {
  proc.process.kill();
  unregisterPty(proc.pid);
}

// ── PTY Lifecycle ───────────────────────────────────────────────

/** Global YOLO flag, synced from the renderer via the `set-yolo` message.
 *  When true, copilot CLI sessions launch with `--yolo` (auto-approves all
 *  tool/file/URL permissions). Applies to the next launch — already-running
 *  PTYs are unaffected. */
let yoloEnabled = false;

/** Global additional-parameters string, synced from the renderer via the
 *  `set-additional-params` message. Appended to copilot CLI launches when
 *  non-empty (e.g. "--model gpt-5.4"). Applies to the next launch. */
let additionalParams = '';

/** Offices for which a ui-server SDK control plane has come online, so the
 *  `backend-online` confirmation is emitted at most once per office. */
const uiServerOnlineOffices = new Set<string>();

/** Stores pre-seeded prompts to send once the agent signals ready. */
const pendingPreseededPrompts = new Map<string, string>();

async function startTerminalForAgent(
  officeId: string,
  agentId: string,
  workingDir?: string,
  cols?: number,
  rows?: number,
  preseededPrompt?: string,
  launchMode: 'copilot' | 'shell' = 'copilot',
): Promise<{ success: boolean; pid?: number; sessionId?: string; reused?: boolean; error?: string }> {
  // Spec 008-smoke: force shell mode end-to-end when the e2e harness is driving
  // the app. Avoids depending on a real copilot CLI binary on the test runner
  // while still exercising the full IPC + PTY + xterm pipeline.
  if (process.env.COPILOT_E2E === '1') {
    launchMode = 'shell';
  }
  if (!terminalBackend || !terminalBackend.isAvailable()) {
    return { success: false, error: 'terminal backend not available' };
  }
  const shellOnlyMode = launchMode === 'shell';
  if (shellOnlyMode && terminalBackend.name !== 'node-pty') {
    return { success: false, error: 'shell mode requires node-pty backend' };
  }

  const ck = compositeKey(officeId, agentId);

  const existingTerminalKey = agentToTerminal.get(ck);
  if (existingTerminalKey && ptyProcesses.has(existingTerminalKey)) {
    const existing = ptyProcesses.get(existingTerminalKey)!;
    return { success: true, pid: existing.pid, sessionId: existing.sessionId, reused: true };
  }

  const officeData = getOfficeSession(officeId);
  let sessionId = officeData.sessionIds.get(agentId);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    officeData.sessionIds.set(agentId, sessionId);
    await saveOfficeSessionFile(officeId);
    console.log(`[TermServer] New session GUID for ${ck}: ${sessionId}`);
  } else {
    console.log(`[TermServer] Reusing session GUID for ${ck}: ${sessionId}`);
  }

  const terminalKey = ck;
  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  let cwd = process.cwd();
  if (workingDir) {
    const customPath = path.isAbsolute(workingDir)
      ? workingDir
      : path.join(process.cwd(), workingDir);
    try {
      await fs.promises.access(customPath, fs.constants.F_OK);
      cwd = customPath;
    } catch { /* use default */ }
  }

  const taggedEnv = {
    ...process.env,
    PATH: sanitizeCopilotPath(process.env.PATH, process.cwd()),
    COPILOT_OFFICE_PROCESS: 'true',
    COPILOT_OFFICE_AGENT: agentId,
  } as { [key: string]: string };

  try {
    const startOptions = {
      sessionId,
      shell,
      cols: cols ?? 120,
      rows: rows ?? 30,
      cwd,
      env: taggedEnv,
      officeId,
      yolo: yoloEnabled,
      // Live getter so toggling YOLO in the app takes effect on already-running
      // ui-server sessions (the permission handler evaluates this per request).
      isYoloEnabled: () => yoloEnabled,
      // Additional-parameters setting (e.g. "--model gpt-5.4"). node-pty appends
      // these to its `copilot --session-id` launch below; the ui-server backend
      // appends them to the per-office host launch (once per office).
      extraArgs: additionalParams ? additionalParams.split(/\s+/).filter(Boolean) : [],
    };

    // Backend used for THIS session — may differ from the selected backend if the
    // ui-server start fails and we fall back to node-pty (T039).
    let activeBackend: TerminalBackend = terminalBackend;
    let sessionFallbackReason: string | undefined;
    let proc: TerminalProcess;
    try {
      proc = await terminalBackend.start(startOptions);
    } catch (startError) {
      if (terminalBackend.name === 'ui-server' && !shellOnlyMode) {
        const fallback = getNodePtyFallbackBackend();
        if (fallback && fallback.isAvailable()) {
          console.warn(`[lifecycle] ui-server start failed for ${ck} (${String(startError)}); falling back to node-pty for this session`);
          activeBackend = fallback;
          sessionFallbackReason = String((startError as Error)?.message ?? startError);
          proc = await fallback.start(startOptions);
        } else {
          throw startError;
        }
      } else {
        throw startError;
      }
    }

    ptyProcesses.set(terminalKey, {
      pid: proc.pid,
      process: proc,
      agentId: terminalKey,
      sessionId,
      workingDir,
    });

    agentToTerminal.set(ck, terminalKey);

    // Per-agent ui-server → node-pty fallback (T039). Surface it so a broken SDK
    // attach is never silent (a stale/incompatible SDK once masked itself this way).
    if (sessionFallbackReason) {
      send({ type: 'backend-session-fallback', officeId, agentId, reason: sessionFallbackReason });
    }

    // Announce (once per office) that the ui-server SDK control plane is online
    // for this office — i.e. the `copilot --ui-server` host is up and the SDK
    // client attached. Only when the session actually runs on ui-server (not a
    // T039 node-pty fallback), so the renderer's confirmation toast is accurate.
    if (activeBackend.name === 'ui-server' && !uiServerOnlineOffices.has(officeId)) {
      uiServerOnlineOffices.add(officeId);
      send({ type: 'backend-online', officeId, backend: activeBackend.name });
    }

    // Persist the PTY root PID so a crashed/ungracefully-killed session can be
    // reaped on the next launch (see electron/terminal/pty-registry.ts). Only
    // real OS PIDs from node-pty are tracked — the SDK backend hands out
    // synthetic PIDs (1_000_000+) that must never be force-killed.
    if (activeBackend.name === 'node-pty') {
      registerPty({ pid: proc.pid, agentId, sessionId, startedAt: Date.now() });
    }

    if (!shellOnlyMode) {
      // Signal that the PTY is spawned and copilot CLI is starting
      send({ type: 'terminal-preload-status', agentId, status: 'preloading' });
    }

    let hasSignalledReady = shellOnlyMode;
    let skippedEventCount = 0;
    agentReadyState.set(ck, shellOnlyMode);

    // Store pre-seeded prompt before signalReady is defined so it's available on first ready
    if (!shellOnlyMode && preseededPrompt) {
      pendingPreseededPrompts.set(ck, preseededPrompt);
    }

    const signalReady = () => {
      if (shellOnlyMode || hasSignalledReady) return;
      hasSignalledReady = true;
      agentReadyState.set(ck, true);
      console.log(`[TermServer] Agent ${ck} signalled READY at ${Date.now()} (skipped ${skippedEventCount} startup events)`);
      send({ type: 'terminal-preload-status', agentId, status: 'ready' });

      // Write pre-seeded prompt to PTY once CLI is ready
      const prompt = pendingPreseededPrompts.get(ck);
      if (prompt) {
        pendingPreseededPrompts.delete(ck);
        console.log(`[TermServer] Writing pre-seeded prompt for ${ck}`);
        proc.write(prompt + '\r');
      }
    };

    if (!shellOnlyMode) {
      // EventsWatcher — defer start so the preloading signal has time to reach
      // the renderer and render 'starting' before the watcher processes historical
      // events and potentially fires signalReady() (which sends 'ready').
      // T011: SDK-backed processes (ui-server) supply their own event source
      // (session.on → normalized CopilotEvent); others use the file watcher.
      const watcher = proc.createEventSource ? proc.createEventSource() : eventSourceFactory.create(sessionId);
      agentWatchers.set(ck, watcher);

      if (activeBackend.name === 'copilot-sdk' || activeBackend.name === 'ui-server') {
        setTimeout(signalReady, 50);
      }

      const watcherCallback = (event: CopilotEvent, isHistorical: boolean) => {
        // Ready detection works on ALL events (historical + new) so both
        // detection paths (first turn_end and "Environment loaded") remain functional.
        if (!hasSignalledReady && (event.type === 'assistant.turn_end' || event.type === 'user.message')) {
          signalReady();
        }

        // Historical events (from a resumed session's existing events.jsonl) are
        // used for ready detection above but never forwarded to the renderer.
        // Forwarding them caused two bugs: (1) tool events before ready triggered
        // invalid starting→thinking transitions, and (2) turn/user events after
        // ready left the agent stuck in thinking with no matching turn_end.
        if (isHistorical) {
          skippedEventCount++;
          return;
        }

        // New events before ready are also skipped — the CLI is still loading.
        if (!hasSignalledReady) {
          skippedEventCount++;
          return;
        }

        // Forward tool events
        if (event.type === 'tool.execution_start') {
          const d = event.data as { toolCallId: string; toolName: string; arguments: Record<string, unknown> };
          console.log(`[TermServer] Forwarding tool_start for ${ck}: ${d.toolName}`);
          send({ type: 'copilot-tool-start', agentId, toolName: d.toolName, toolId: d.toolCallId, status: formatToolStatus(d.toolName, d.arguments) });
        } else if (event.type === 'tool.execution_complete') {
          const d = event.data as { toolCallId: string; success: boolean };
          console.log(`[TermServer] Forwarding tool_complete for ${ck}: ${d.toolCallId}`);
          send({ type: 'copilot-tool-complete', agentId, toolId: d.toolCallId, success: d.success });
        }

        if (event.type === 'assistant.turn_end') {
          agentInTurn.set(ck, false);
          console.log(`[TermServer] Forwarding turn_end for ${ck}`);
          send({ type: 'copilot-turn-end', agentId });
        } else if (event.type === 'assistant.turn_start') {
          agentInTurn.set(ck, true);
          console.log(`[TermServer] Forwarding turn_start for ${ck}`);
          send({ type: 'copilot-turn-start', agentId });
        } else if (event.type === 'user.message') {
          userMessageSeq.set(ck, (userMessageSeq.get(ck) ?? 0) + 1);
          let rawUserText = '';
          {
            const d = (event.data ?? {}) as Record<string, unknown>;
            const raw = d.content || d.message || d.text || d.input || d.prompt || d.body || '';
            rawUserText = String(raw);
            lastUserMessageText.set(ck, normalizePromptText(rawUserText));
          }
          console.log(`[TermServer] Forwarding user_message for ${ck}, data keys: ${JSON.stringify(Object.keys(event.data || {}))}`);
          send({ type: 'copilot-user-message', agentId, text: rawUserText });

          // Auto-set session title from first non-empty user message while title is empty.
          const existing = officeData.sessionMeta.get(agentId);
          const existingTitle = typeof existing?.title === 'string' ? existing.title.trim() : '';
          if (existingTitle) {
            hasAutoTitled.add(ck);
          } else {
            const d = event.data as Record<string, unknown>;
            const msgText = d?.content || d?.message || d?.text || d?.input || d?.prompt || d?.body || '';
            const raw = String(msgText).trim();
            if (raw) {
              const title = raw.length > 80 ? raw.slice(0, 77) + '...' : raw;
              const meta = existing || { title: '' };
              meta.title = title;
              officeData.sessionMeta.set(agentId, meta);
              saveOfficeSessionFile(officeId);
              hasAutoTitled.add(ck);
              console.log(`[TermServer] Auto-titled ${ck}: "${title}"`);
              send({ type: 'session-meta-updated', agentId, meta: { ...meta } });
            } else {
              hasAutoTitled.delete(ck);
            }
          }
        } else if (event.type === 'subagent.started') {
          const d = event.data as { toolCallId?: string; agentName?: string; agentDisplayName?: string };
          console.log(`[TermServer] Subagent started for ${ck}: ${d.agentName ?? 'unknown'} (toolCallId: ${d.toolCallId ?? '?'})`);
        } else if (event.type === 'subagent.completed') {
          const d = event.data as { toolCallId?: string; agentName?: string };
          console.log(`[TermServer] Subagent completed for ${ck}: ${d.agentName ?? 'unknown'} (toolCallId: ${d.toolCallId ?? '?'})`);
        } else if (event.type === 'subagent.failed') {
          const d = event.data as { toolCallId?: string; agentName?: string; error?: string };
          console.log(`[TermServer] Subagent FAILED for ${ck}: ${d.agentName ?? 'unknown'} (toolCallId: ${d.toolCallId ?? '?'}, error: ${d.error ?? 'unknown'})`);
        }

        // Sub-agent lifecycle events are critical for fleet tracking and must always
        // be forwarded, even without an active terminal viewer. This matches how
        // copilot-tool-start / copilot-tool-complete are already sent unconditionally.
        // Without this, FleetTracker goes silent when MeetingScene cleanup detaches
        // the viewer before FleetTracker can re-attach it.
        const isFleetCriticalEvent =
          event.type.startsWith('subagent.') ||
          event.type === 'system.notification' ||
          (event.type === 'tool.execution_start' && (event.data as { toolName?: string })?.toolName === 'task');

        if (isFleetCriticalEvent || hasActiveViewer(ck)) {
          send({ type: 'copilot-event', agentId, event });
        } else if (agentForwardKeys.has(ck)) {
          // Teams-online agent with no active renderer viewer: mirror the event to
          // main-process consumers (the Teams service captures assistant.message to
          // post the reply back to the thread) but keep it out of the renderer.
          send({ type: 'copilot-event', agentId, event, mainOnly: true });
        } else {
          console.warn(`[TermServer] Dropped copilot-event ${event.type} for ${ck} — no active viewer (viewers: [${[...activeAgentViewers].join(', ')}])`);
        }
      };

      // Defer watcher start by 100ms so the 'preloading' IPC message has time to
      // reach the renderer and render 'starting' before the watcher processes
      // historical events and fires signalReady() (which sends 'ready').
      setTimeout(() => watcher.start(watcherCallback), 100);
    }

    // Batched PTY data output
    const MAX_PENDING_BYTES = 65536;
    let pendingData = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushData = () => {
      flushTimer = null;
      if (pendingData && hasActiveViewer(ck)) {
        send({ type: 'terminal-data', agentId, data: pendingData });
      }
      pendingData = '';
    };

    // ui-server: every agent in an office shares ONE host TUI (rawPty). Its bytes
    // only ever render the *foreground* session, yet all agents' onData callbacks
    // fire. Attribute the shared stream to exactly one agent (the office
    // foreground) so a session's rendered output cannot leak into another's
    // scrollback or live view. Default the first started agent to foreground;
    // the `attach` handler updates it on every agent switch.
    const isSharedHostBackend = activeBackend.name === 'ui-server';
    if (isSharedHostBackend && !officeForegroundCk.has(officeId)) {
      officeForegroundCk.set(officeId, ck);
    }

    proc.onData((data: string) => {
      if (isSharedHostBackend && !shouldForwardSharedHostData(ck, officeForegroundCk.get(officeId))) {
        // Not the office foreground — this is another session's rendered output
        // arriving on the shared host TUI stream. Ignore it so it can't leak into
        // this agent's scrollback or live view.
        return;
      }
      lastPtyDataAt.set(ck, Date.now());
      appendToScrollback(ck, data);
      // Ready signal from PTY output. Newer CLI builds do not always emit the old
      // "Environment loaded" marker, so accept either the legacy marker or the
      // interactive help footer that appears once startup finishes.
      if (!shellOnlyMode && activeBackend?.name === 'node-pty' && !hasSignalledReady) {
        const hasLegacyReadyMarker = data.includes('Environment loaded');
        const hasInteractiveFooter = data.includes('/ commands') || data.includes('? help');
        if (hasLegacyReadyMarker || hasInteractiveFooter) {
          console.log(`[TermServer] Ready signal for ${ck}: PTY marker detected`);
          signalReady();
        }
      }
      if (!hasActiveViewer(ck)) return;
      pendingData += data;
      if (pendingData.length >= MAX_PENDING_BYTES) {
        if (flushTimer) clearTimeout(flushTimer);
        flushData();
      } else if (!flushTimer) {
        flushTimer = setTimeout(flushData, 16);
      }
    });

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      send({ type: 'terminal-exit', agentId, exitCode });
      unregisterPty(proc.pid);
      ptyProcesses.delete(terminalKey);
      activeAgentViewers.delete(ck);
      clearForegroundIf(officeId, ck);
      agentScrollbackBuffers.delete(ck);
      agentScrollbackBytes.delete(ck);
      agentReadyState.delete(ck);
      agentInTurn.delete(ck);
      lastPtyDataAt.delete(ck);
      userMessageSeq.delete(ck);
      lastUserMessageText.delete(ck);
      const w = agentWatchers.get(ck);
      if (w) { w.stop(); agentWatchers.delete(ck); }
    });

    if (!shellOnlyMode && activeBackend.name === 'node-pty') {
      // Start copilot CLI
      setTimeout(() => {
        const yoloFlag = yoloEnabled ? ' --yolo' : '';
        const extraParams = additionalParams ? ` ${additionalParams}` : '';
        console.log(`[TermServer] Starting copilot --session-id for ${ck}: ${sessionId}${yoloEnabled ? ' (yolo)' : ''}${additionalParams ? ` (params: ${additionalParams})` : ''}`);
        proc.write(`copilot --session-id=${sessionId}${yoloFlag}${extraParams}\r`);
      }, 500);
    }

    return { success: true, pid: proc.pid, sessionId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ── Message Handler ─────────────────────────────────────────────

async function handleMessage(msg: MainToServer): Promise<void> {
  switch (msg.type) {
    case 'start': {
      const ck = compositeKey(msg.officeId, msg.agentId);
      activeAgentViewers.add(ck);
      const result = await startTerminalForAgent(msg.officeId, msg.agentId, msg.workingDir, msg.cols, msg.rows, msg.preseededPrompt, msg.launchMode);
      send({ type: 'response', requestId: msg.requestId, result });
      break;
    }

    case 'write': {
      const key = getTerminalKey(msg.officeId, msg.agentId);
      const proc = key ? ptyProcesses.get(key) : null;
      if (proc) {
        proc.process.write(msg.data);
        send({ type: 'response', requestId: msg.requestId, result: { success: true } });
      } else {
        const ck = compositeKey(msg.officeId, msg.agentId);
        const alias = agentToTerminal.get(ck);
        console.log(`[TermServer] WRITE FAILED — no PTY for ${ck} (alias=${alias ?? 'none'}, key=${key ?? 'none'}, ptyKeys=[${[...ptyProcesses.keys()].join(', ')}])`);
        send({ type: 'response', requestId: msg.requestId, result: { success: false, error: `No PTY for ${ck}` } });
      }
      break;
    }

    case 'submit-prompt': {
      // Programmatic prompt submission (e.g. Teams remote). Prefer the backend's
      // atomic submit (SDK: session.send enqueue). Fall back to a bracketed-paste
      // write for raw PTY backends so multi-line prompts aren't submitted early
      // and TUI re-render storms don't drop characters.
      const key = getTerminalKey(msg.officeId, msg.agentId);
      const proc = key ? ptyProcesses.get(key) : null;
      if (proc) {
        // A programmatic submit implies a main-process consumer (Teams) is driving
        // this turn and needs the resulting assistant.message events, even if no
        // renderer is viewing the session. Enable forwarding here so it can't be
        // lost if the separate set-agent-forwarding message was dropped (e.g. across
        // a terminal-server reconnect); this rides the reliable request path.
        agentForwardKeys.add(compositeKey(msg.officeId, msg.agentId));
        const backendProc = proc.process;
        if (typeof backendProc.submitPrompt === 'function') {
          // SDK backend: atomic programmatic submit (session.send enqueue).
          backendProc.submitPrompt(msg.prompt, msg.label);
        } else {
          // node-pty backend: the real Copilot CLI is an Ink/React TUI. It has no
          // programmatic submit — inject keystrokes. Bracketed paste avoids @ / //
          // triggering TUI menus and re-render char drops; but Ink detaches stdin
          // during re-renders, so a single Enter is unreliable. Use the idle-gated
          // sequence: Ctrl+U (clear) → paste → wait-for-render-idle → Enter. Key
          // idle tracking by the resolved terminal `key` (not the office composite
          // key) so it stays correct for transferred/aliased sessions where the
          // PTY's onData writes timestamps under its original terminal key.
          submitViaKeystrokes(backendProc, msg.prompt, key!);
        }
        send({ type: 'response', requestId: msg.requestId, result: { success: true } });
      } else {
        const ck = compositeKey(msg.officeId, msg.agentId);
        console.log(`[TermServer] SUBMIT-PROMPT FAILED — no PTY for ${ck}`);
        send({ type: 'response', requestId: msg.requestId, result: { success: false, error: `No PTY for ${ck}` } });
      }
      break;
    }

    case 'set-agent-forwarding': {
      // Teams remote: keep copilot-event flowing to main-process consumers for an
      // agent even when no renderer is viewing it, so replies can be posted back.
      const ck = compositeKey(msg.officeId, msg.agentId);
      if (msg.enabled) agentForwardKeys.add(ck);
      else agentForwardKeys.delete(ck);
      break;
    }

    case 'resize': {
      const key = getTerminalKey(msg.officeId, msg.agentId);
      const proc = key ? ptyProcesses.get(key) : null;
      if (proc) proc.process.resize(msg.cols, msg.rows);
      break;
    }

    case 'set-yolo': {
      yoloEnabled = msg.enabled;
      console.log(`[TermServer] YOLO mode ${yoloEnabled ? 'ENABLED' : 'disabled'}`);
      break;
    }

    case 'set-additional-params': {
      additionalParams = (msg.params ?? '').trim();
      console.log(`[TermServer] Additional params ${additionalParams ? `set: ${additionalParams}` : 'cleared'}`);
      break;
    }

    case 'kill': {
      const ck = compositeKey(msg.officeId, msg.agentId);
      const key = getTerminalKey(msg.officeId, msg.agentId);
      const proc = key ? ptyProcesses.get(key) : null;
      if (proc) {
        try {
          killPtyProcess(proc);
          ptyProcesses.delete(key!);
          agentToTerminal.delete(ck);
          clearForegroundIf(msg.officeId, ck);
          // Archive old session ID and clear it so next start generates a fresh one
          archiveSessionId(msg.officeId, msg.agentId);
          const officeData = getOfficeSession(msg.officeId);
          officeData.sessionIds.delete(msg.agentId);
          await saveOfficeSessionFile(msg.officeId);
          // Stop event watcher
          const w = agentWatchers.get(ck);
          if (w) { w.stop(); agentWatchers.delete(ck); }
          agentReadyState.delete(ck);
          agentInTurn.delete(ck);
          send({ type: 'response', requestId: msg.requestId, result: { success: true } });
        } catch (error) {
          send({ type: 'response', requestId: msg.requestId, result: { success: false, error: String(error) } });
        }
      } else {
        send({ type: 'response', requestId: msg.requestId, result: { success: false, error: 'No terminal for this agent' } });
      }
      break;
    }

    case 'attach': {
      const ck = compositeKey(msg.officeId, msg.agentId);
      console.log(`[TermServer] Attaching viewer for ${ck}`);
      // Dual-key invariant (R-002): for transferred fleet sessions, this also
      // marks the original terminal key so PTY/event closures bound to the
      // source composite key continue forwarding. See agent-viewers.ts.
      const { aliasKey } = addAgentViewer(ck, viewerMaps);
      if (aliasKey) {
        console.log(`[TermServer] Also marking original key ${aliasKey} as active viewer (transferred session)`);
      }

      // T024: bring this agent's session to the foreground of its office's hosted
      // TUI runtime so the real terminal renders the selected agent. Only the
      // ui-server backend implements setForeground; other backends own a PTY per
      // agent and need no switch. Best-effort — a foreground failure must not fail
      // the attach.
      const attachedKey = getTerminalKey(msg.officeId, msg.agentId);
      const attachedProc = attachedKey ? ptyProcesses.get(attachedKey) : null;
      const isSharedHost = !!attachedProc && typeof attachedProc.process.setForeground === 'function';
      if (isSharedHost) {
        // Single active agent per office (shared ui-server host): make this agent
        // the office foreground so the shared TUI stream is attributed only to it,
        // and deactivate every other active viewer in the same office so exactly
        // one agent is UI-active at a time.
        officeForegroundCk.set(msg.officeId, ck);
        for (const otherCk of viewersToDeactivate(msg.officeId, ck, aliasKey, activeAgentViewers)) {
          removeAgentViewer(otherCk, viewerMaps);
          console.log(`[TermServer] Deactivated prior viewer ${otherCk} — single active agent per office`);
        }
        // Await the foreground switch before responding: under the shared
        // ui-server host, ALL input funnels to the host rawPty and is routed to
        // whichever session is foreground. If we respond (and the viewer focuses
        // the xterm) before the switch completes, keystrokes race to the PREVIOUS
        // foreground agent — the "I can't see what I type until I switch back to
        // my last active terminal" bug. Awaiting closes that race for the common
        // switch path. Failure is non-fatal (attach still succeeds).
        try {
          await attachedProc!.process.setForeground?.();
        } catch (err: unknown) {
          console.warn(`[lifecycle] setForeground failed for ${ck}: ${String(err)}`);
        }
      }

      const chunks = agentScrollbackBuffers.get(ck) || [];
      const rawScrollback = chunks.join('');
      send({ type: 'response', requestId: msg.requestId, result: { success: true, scrollback: rawScrollback } });
      break;
    }

    case 'detach': {
      const ck = compositeKey(msg.officeId, msg.agentId);
      console.log(`[TermServer] Detaching viewer for ${ck}`);
      // Pairs with addAgentViewer on attach: dual-key removal for transferred sessions.
      removeAgentViewer(ck, viewerMaps);
      break;
    }

    case 'exists': {
      send({ type: 'response', requestId: msg.requestId, result: getTerminalKey(msg.officeId, msg.agentId) !== null });
      break;
    }

    case 'get-session-id': {
      const officeData = getOfficeSession(msg.officeId);
      send({ type: 'response', requestId: msg.requestId, result: officeData.sessionIds.get(msg.agentId) || null });
      break;
    }

    case 'set-session-id': {
      const normalized = msg.sessionId.trim().toLowerCase();
      const officeData = getOfficeSession(msg.officeId);
      const current = officeData.sessionIds.get(msg.agentId);
      const changed = !!normalized && current !== normalized;

      // Spec 007 defense-in-depth: reject if proposed id collides with
      // another agent's id in the same office. Prevents any future renderer
      // bug from re-introducing duplicate session ids in the persisted file
      // (cf. the parseSessionId greedy regex removed in spec 007).
      if (changed && normalized) {
        for (const [otherAgent, otherSid] of officeData.sessionIds) {
          if (otherAgent !== msg.agentId && otherSid === normalized) {
            console.warn(`[TermServer] Rejected set-session-id ${normalized} for ${compositeKey(msg.officeId, msg.agentId)} — already in use by ${otherAgent}`);
            send({ type: 'response', requestId: msg.requestId, result: { success: false, error: 'sessionId already in use by another agent in this office' } });
            return;
          }
        }
      }

      if (changed) {
        archiveSessionId(msg.officeId, msg.agentId);
        officeData.sessionIds.set(msg.agentId, normalized);
        await saveOfficeSessionFile(msg.officeId);
        console.log(`[TermServer] Updated session ID for ${compositeKey(msg.officeId, msg.agentId)}: ${current ?? '(none)'} -> ${normalized}`);
      }

      const key = getTerminalKey(msg.officeId, msg.agentId);
      const proc = key ? ptyProcesses.get(key) : null;
      if (proc && changed) {
        proc.sessionId = normalized;
      }

      send({ type: 'response', requestId: msg.requestId, result: { success: true } });
      break;
    }

    case 'pop-out': {
      const ck = compositeKey(msg.officeId, msg.agentId);
      const officeData = getOfficeSession(msg.officeId);
      const sid = officeData.sessionIds.get(msg.agentId);
      if (!sid) {
        send({ type: 'response', requestId: msg.requestId, result: { success: false, error: 'No session found for agent' } });
        break;
      }
      const termKey = agentToTerminal.get(ck);
      const ptyProc = termKey ? ptyProcesses.get(termKey) : null;
      let cwd = process.cwd();
      if (ptyProc?.workingDir) {
        const customPath = path.join(process.cwd(), ptyProc.workingDir);
        try {
          await fs.promises.access(customPath, fs.constants.F_OK);
          cwd = customPath;
        } catch { /* use default */ }
      }
      try {
        const wtArgs = ['-d', cwd, 'copilot', '--session-id', sid];
        if (yoloEnabled) wtArgs.push('--yolo');
        if (additionalParams) wtArgs.push(...additionalParams.split(/\s+/).filter(Boolean));
        spawn('wt', wtArgs, { detached: true, stdio: 'ignore' }).unref();
        send({ type: 'response', requestId: msg.requestId, result: { success: true } });
      } catch (error) {
        send({ type: 'response', requestId: msg.requestId, result: { success: false, error: String(error) } });
      }
      break;
    }

    case 'reset-session': {
      const ck = compositeKey(msg.officeId, msg.agentId);
      console.log(`[TermServer] Resetting session for ${ck}`);
      // Kill PTY if alive
      const resetKey = getTerminalKey(msg.officeId, msg.agentId);
      const resetProc = resetKey ? ptyProcesses.get(resetKey) : null;
      if (resetProc) {
        killPtyProcess(resetProc);
        ptyProcesses.delete(resetKey!);
        agentToTerminal.delete(ck);
      }
      // Stop event watcher
      const resetWatcher = agentWatchers.get(ck);
      if (resetWatcher) { resetWatcher.stop(); agentWatchers.delete(ck); }
      agentReadyState.delete(ck);
      agentInTurn.delete(ck);
      // Clear scrollback
      agentScrollbackBuffers.delete(ck);
      agentScrollbackBytes.delete(ck);
      activeAgentViewers.delete(ck);
      clearForegroundIf(msg.officeId, ck);
      // Clear session metadata
      const officeDataReset = getOfficeSession(msg.officeId);
      officeDataReset.sessionMeta.delete(msg.agentId);
      hasAutoTitled.delete(ck);
      send({ type: 'session-meta-updated', agentId: msg.agentId, meta: { title: '' } });
      // Archive old session ID and generate new one (but don't start PTY)
      archiveSessionId(msg.officeId, msg.agentId);
      const newSessionId = crypto.randomUUID();
      officeDataReset.sessionIds.set(msg.agentId, newSessionId);
      await saveOfficeSessionFile(msg.officeId);
      console.log(`[TermServer] Reset session for ${ck}: new GUID ${newSessionId}`);
      send({ type: 'response', requestId: msg.requestId, result: { success: true, sessionId: newSessionId } });
      break;
    }

    case 'get-session-history': {
      const officeData = getOfficeSession(msg.officeId);
      const history = officeData.sessionHistory.get(msg.agentId) || [];
      send({ type: 'response', requestId: msg.requestId, result: history });
      break;
    }

    case 'clear-session-history': {
      const officeData = getOfficeSession(msg.officeId);
      officeData.sessionHistory.delete(msg.agentId);
      await saveOfficeSessionFile(msg.officeId);
      console.log(`[TermServer] Cleared session history for ${compositeKey(msg.officeId, msg.agentId)}`);
      send({ type: 'response', requestId: msg.requestId, result: { success: true } });
      break;
    }

    case 'reset-all-sessions': {
      const officeId = msg.officeId;
      console.log(`[TermServer] Resetting all sessions for ${officeId}`);
      const officeData = getOfficeSession(officeId);
      // Kill PTYs for this office
      for (const agentId of officeData.sessionIds.keys()) {
        const ck = compositeKey(officeId, agentId);
        const key = agentToTerminal.get(ck);
        if (key) {
          const proc = ptyProcesses.get(key);
          if (proc) {
            killPtyProcess(proc);
            ptyProcesses.delete(key);
          }
          agentToTerminal.delete(ck);
        }
        const w = agentWatchers.get(ck);
        if (w) { w.stop(); agentWatchers.delete(ck); }
        agentScrollbackBuffers.delete(ck);
        agentScrollbackBytes.delete(ck);
        agentReadyState.delete(ck);
        agentInTurn.delete(ck);
        activeAgentViewers.delete(ck);
        clearForegroundIf(officeId, ck);
        hasAutoTitled.delete(ck);
        send({ type: 'session-meta-updated', agentId, meta: { title: '' } });
      }
      officeData.sessionMeta.clear();
      // Regenerate fresh GUIDs
      for (const agentId of officeData.sessionIds.keys()) {
        officeData.sessionIds.set(agentId, crypto.randomUUID());
      }
      await saveOfficeSessionFile(officeId);
      console.log(`[TermServer] All sessions reset for ${officeId}`);
      send({ type: 'response', requestId: msg.requestId, result: { success: true } });
      break;
    }

    case 'list-active': {
      const activeAgentIds = Array.from(agentToTerminal.keys())
        .filter(ck => {
          const key = agentToTerminal.get(ck);
          return key && ptyProcesses.has(key);
        })
        .map(ck => ck.split(':')[1] ?? ck);
      console.log(`[TermServer] Active terminals: ${activeAgentIds.join(', ') || '(none)'}`);
      send({ type: 'response', requestId: msg.requestId, result: activeAgentIds });
      break;
    }

    case 'query-agent-statuses': {
      const { officeId } = msg as MsgQueryAgentStatuses;
      const statuses: Record<string, { alive: boolean; ready: boolean; inTurn: boolean }> = {};
      for (const [ck] of agentToTerminal) {
        if (officeId && !ck.startsWith(officeId + ':')) continue;
        const agentId = ck.split(':')[1] ?? ck;
        const key = agentToTerminal.get(ck);
        const alive = !!(key && ptyProcesses.has(key));
        const ready = agentReadyState.get(ck) ?? false;
        const inTurn = agentInTurn.get(ck) ?? false;
        statuses[agentId] = { alive, ready, inTurn };
      }
      send({ type: 'response', requestId: msg.requestId, result: statuses });
      break;
    }

    case 'set-session-meta': {
      const { officeId, agentId, meta } = msg as MsgSetSessionMeta;
      const officeData = getOfficeSession(officeId);
      const existing = officeData.sessionMeta.get(agentId) || { title: '' };
      if (meta.title !== undefined) existing.title = meta.title;
      const ck = compositeKey(officeId, agentId);
      if ((existing.title || '').trim()) {
        hasAutoTitled.add(ck);
      } else {
        hasAutoTitled.delete(ck);
      }
      officeData.sessionMeta.set(agentId, existing);
      await saveOfficeSessionFile(officeId);
      send({ type: 'response', requestId: msg.requestId, result: { success: true } });
      break;
    }

    case 'get-session-meta': {
      const gmMsg = msg as MsgGetSessionMeta;
      const officeData = getOfficeSession(gmMsg.officeId);
      const meta = officeData.sessionMeta.get(gmMsg.agentId) || null;
      send({ type: 'response', requestId: msg.requestId, result: meta });
      break;
    }

    case 'get-all-session-meta': {
      const officeData = getOfficeSession(msg.officeId);
      // Spec 009-enhancement: include the current sessionId per agent so the
      // dashboard can render the id under the title without an extra RPC.
      const merged: Record<string, { title: string; sessionId?: string }> = {};
      for (const [agentId, meta] of officeData.sessionMeta.entries()) {
        const sessionId = officeData.sessionIds.get(agentId);
        merged[agentId] = sessionId ? { ...meta, sessionId } : { ...meta };
      }
      // Also surface agents that have a sessionId but no metadata entry yet
      // (e.g., session minted but no first user message → no auto-title yet).
      for (const [agentId, sessionId] of officeData.sessionIds.entries()) {
        if (!merged[agentId]) merged[agentId] = { title: '', sessionId };
      }
      send({ type: 'response', requestId: msg.requestId, result: merged });
      break;
    }

    case 'create-office-session': {
      await createEmptySessionFile(msg.officeId);
      send({ type: 'response', requestId: msg.requestId, result: { success: true } });
      break;
    }

    case 'delete-office-session': {
      const filePath = getSessionFile(msg.officeId);
      try {
        await fs.promises.unlink(filePath);
        officeSessions.delete(msg.officeId);
        console.log(`[TermServer] Deleted session file for ${msg.officeId}`);
      } catch { /* file may not exist */ }
      send({ type: 'response', requestId: msg.requestId, result: { success: true } });
      break;
    }

    case 'transfer-session': {
      // Copy session ID, metadata, and scrollback from one office to another for a given agent.
      // Also registers a PTY alias so the same terminal process is accessible under the new office key.
      const fromData = getOfficeSession(msg.fromOfficeId);
      const toData = getOfficeSession(msg.toOfficeId);
      const sid = fromData.sessionIds.get(msg.agentId);
      if (!sid) {
        send({ type: 'response', requestId: msg.requestId, result: { success: false, error: 'No session to transfer' } });
        break;
      }

      // Copy session ID and metadata
      toData.sessionIds.set(msg.agentId, sid);
      const meta = fromData.sessionMeta.get(msg.agentId);
      if (meta) toData.sessionMeta.set(msg.agentId, { ...meta });

      // Register PTY alias: map the new composite key to the existing terminal key
      const fromCk = compositeKey(msg.fromOfficeId, msg.agentId);
      const toCk = compositeKey(msg.toOfficeId, msg.agentId);
      const existingTermKey = agentToTerminal.get(fromCk);
      if (existingTermKey && ptyProcesses.has(existingTermKey)) {
        agentToTerminal.set(toCk, existingTermKey);
        // Copy scrollback buffer so attach works from the new office
        const scrollback = agentScrollbackBuffers.get(fromCk);
        if (scrollback) agentScrollbackBuffers.set(toCk, [...scrollback]);
        const bytes = agentScrollbackBytes.get(fromCk);
        if (bytes !== undefined) agentScrollbackBytes.set(toCk, bytes);
        // Copy ready state
        const ready = agentReadyState.get(fromCk);
        if (ready !== undefined) agentReadyState.set(toCk, ready);
        // Copy turn state
        const turnState = agentInTurn.get(fromCk);
        if (turnState !== undefined) agentInTurn.set(toCk, turnState);
        // Do NOT share the EventsWatcher — it's bound to the original composite key's
        // closure. Sharing causes the destination's kill/reset to stop() the source's
        // watcher via the shared object reference. The destination creates its own watcher
        // when startTerminalForAgent is called for a new session.
        // Carry over active viewer registration so PTY output is forwarded under the new key
        if (activeAgentViewers.has(fromCk)) {
          activeAgentViewers.add(toCk);
        }
      }

      // Copy session history
      const history = fromData.sessionHistory.get(msg.agentId);
      if (history) toData.sessionHistory.set(msg.agentId, [...history]);

      await saveOfficeSessionFile(msg.toOfficeId);
      console.log(`[TermServer] Transferred session for ${msg.agentId}: ${msg.fromOfficeId} → ${msg.toOfficeId} (sid=${sid})`);
      send({ type: 'response', requestId: msg.requestId, result: { success: true, sessionId: sid } });
      break;
    }

    case 'shutdown': {
      console.log('[TermServer] Shutdown requested');
      killAllPtyProcesses();
      process.exit(0);
    }
  }
}

// ── Bootstrap ───────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[TermServer] Starting...');

  const resolvedCopilotCliPath = resolveCopilotCliPath(process.cwd(), process.env.PATH);
  // Backend selection (T008). Values mirror src/config/terminalBackend.ts
  // ('node-pty' | 'ui-server' | 'sdk'); the renderer decides and passes the choice
  // via COPILOT_TERMINAL_BACKEND. Default is ui-server (auto-probes and falls back
  // to node-pty when the CLI can't host --ui-server); node-pty remains the
  // permanent fallback.
  const preferredBackend = (process.env.COPILOT_TERMINAL_BACKEND || 'ui-server').toLowerCase();
  let backendFallbackReason: string | undefined;
  if (preferredBackend === 'ui-server') {
    const candidate = UiServerBackend.tryCreate(resolvedCopilotCliPath);
    // isAvailable() runs the --ui-server capability probe (undocumented flag);
    // on any failure we fall back to node-pty rather than surfacing an error.
    if (candidate && candidate.isAvailable()) {
      terminalBackend = candidate;
    } else {
      backendFallbackReason = 'UI-server is unavailable on this Copilot CLI';
      console.warn('[lifecycle] backend=ui-server requested but --ui-server is unavailable on this CLI; falling back to node-pty');
    }
  } else if (preferredBackend === 'sdk') {
    terminalBackend = await CopilotSdkBackend.tryCreate(resolvedCopilotCliPath);
    if (!terminalBackend) {
      backendFallbackReason = 'SDK backend could not initialize';
      console.warn('[TermServer] COPILOT_TERMINAL_BACKEND=sdk requested but the SDK backend could not initialize; falling back to node-pty');
    }
  }

  if (!terminalBackend) {
    terminalBackend = NodePtyBackend.tryCreate();
  }

  if (resolvedCopilotCliPath) {
    console.log(`[TermServer] Using Copilot CLI at: ${resolvedCopilotCliPath}`);
  } else {
    console.warn('[TermServer] Could not resolve a non-local Copilot CLI path');
  }

  if (terminalBackend) {
    console.log(`[TermServer] ${terminalBackend.name} backend loaded`);
  } else {
    console.error('[TermServer] Failed to load any terminal backend');
  }

  await loadAllOfficeSessions();

  // Listen for messages from parent
  process.on('message', (msg: MainToServer) => {
    handleMessage(msg).catch((e) => {
      console.error('[TermServer] Unhandled error in message handler:', e);
    });
  });

  // Clean up on unexpected exit
  process.on('SIGTERM', () => {
    killAllPtyProcesses();
    process.exit(0);
  });

  // Signal ready, including the backend-selection outcome so the renderer can
  // surface a toast when a requested backend (e.g. ui-server) fell back to node-pty.
  const loadedBackendName = terminalBackend?.name ?? 'none';
  const fellBack =
    (preferredBackend === 'ui-server' || preferredBackend === 'sdk') &&
    loadedBackendName === 'node-pty';
  send({
    type: 'ready',
    backend: {
      name: loadedBackendName,
      requested: preferredBackend,
      fellBack,
      reason: backendFallbackReason,
    },
  });
  console.log('[TermServer] Ready');
}

main();
