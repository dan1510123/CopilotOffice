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
import { CopilotSdkBackend, NodePtyBackend, TerminalBackend, TerminalProcess } from './terminal-backend';

// ── State ───────────────────────────────────────────────────────

interface PtyProcess {
  pid: number;
  process: TerminalProcess;
  agentId: string;
  sessionId: string;
  workingDir?: string;
}

const ptyProcesses: Map<string, PtyProcess> = new Map();
const agentToTerminal: Map<string, string> = new Map();
const activeAgentViewers: Set<string> = new Set();
const agentWatchers: Map<string, CopilotEventSource> = new Map();
let terminalBackend: TerminalBackend | null = null;
const eventSourceFactory = new FileWatcherEventSourceFactory();

// Track per-agent ready state so it can be queried by the renderer
const agentReadyState: Map<string, boolean> = new Map();

// Track per-agent turn activity (between turn_start and turn_end)
const agentInTurn: Map<string, boolean> = new Map();

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

/**
 * Check if a composite key has an active viewer, including alias keys.
 * For transferred sessions, the closure captures the original key but the viewer
 * may only have the alias (fleet office) key registered. This checks both.
 */
function hasActiveViewer(ck: string): boolean {
  if (activeAgentViewers.has(ck)) return true;
  for (const [alias, termKey] of agentToTerminal) {
    if (termKey === ck && activeAgentViewers.has(alias)) return true;
  }
  return false;
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

function killAllPtyProcesses(): void {
  console.log(`[TermServer] Killing ${ptyProcesses.size} PTY processes`);
  ptyProcesses.forEach((proc) => killPtyProcess(proc));
  ptyProcesses.clear();
  agentToTerminal.clear();
  agentWatchers.forEach((w) => w.stop());
  agentWatchers.clear();
}

/** Platform-aware process-tree kill. On Windows, uses taskkill /T /F to kill
 *  the entire tree (shell + copilot CLI + children). Single canonical kill
 *  function — all PTY kill sites must use this, never bare proc.process.kill(). */
function killPtyProcess(proc: PtyProcess): void {
  proc.process.kill();
}

// ── PTY Lifecycle ───────────────────────────────────────────────

/** Stores pre-seeded prompts to send once the agent signals ready. */
const pendingPreseededPrompts = new Map<string, string>();

async function startTerminalForAgent(
  officeId: string,
  agentId: string,
  workingDir?: string,
  cols?: number,
  rows?: number,
  preseededPrompt?: string
): Promise<{ success: boolean; pid?: number; sessionId?: string; reused?: boolean; error?: string }> {
  if (!terminalBackend || !terminalBackend.isAvailable()) {
    return { success: false, error: 'terminal backend not available' };
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
    COPILOT_OFFICE_PROCESS: 'true',
    COPILOT_OFFICE_AGENT: agentId,
  } as { [key: string]: string };

  try {
    const proc = await terminalBackend.start({
      sessionId,
      shell,
      cols: cols ?? 120,
      rows: rows ?? 30,
      cwd,
      env: taggedEnv,
    });

    ptyProcesses.set(terminalKey, {
      pid: proc.pid,
      process: proc,
      agentId: terminalKey,
      sessionId,
      workingDir,
    });

    agentToTerminal.set(ck, terminalKey);

    // Signal that the PTY is spawned and copilot CLI is starting
    send({ type: 'terminal-preload-status', agentId, status: 'preloading' });

     // EventsWatcher — defer start so the preloading signal has time to reach
     // the renderer and render 'starting' before the watcher processes historical
     // events and potentially fires signalReady() (which sends 'ready').
    const watcher = eventSourceFactory.create(sessionId);
    agentWatchers.set(ck, watcher);

    let hasSignalledReady = false;
    let skippedEventCount = 0;
    agentReadyState.set(ck, false);

    // Store pre-seeded prompt before signalReady is defined so it's available on first ready
    if (preseededPrompt) {
      pendingPreseededPrompts.set(ck, preseededPrompt);
    }

    const signalReady = () => {
      if (hasSignalledReady) return;
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

    if (terminalBackend.name === 'copilot-sdk') {
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
        console.log(`[TermServer] Forwarding user_message for ${ck}, data keys: ${JSON.stringify(Object.keys(event.data || {}))}`);
        send({ type: 'copilot-user-message', agentId });

        // Auto-set session title from first user message if no title exists
        if (!hasAutoTitled.has(ck)) {
          hasAutoTitled.add(ck);
          const existing = officeData.sessionMeta.get(agentId);
          if (!existing?.title) {
            const d = event.data as Record<string, unknown>;
            const msgText = d?.content || d?.message || d?.text || d?.input || d?.prompt || d?.body || '';
            const raw = String(msgText).trim();
            if (raw) {
              const title = raw.length > 80 ? raw.slice(0, 77) + '...' : raw;
              const meta = existing || { title: '' };
              meta.title = title;
              officeData.sessionMeta.set(agentId, meta);
              saveOfficeSessionFile(officeId);
              console.log(`[TermServer] Auto-titled ${ck}: "${title}"`);
              send({ type: 'session-meta-updated', agentId, meta: { ...meta } });
            }
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
      } else {
        console.warn(`[TermServer] Dropped copilot-event ${event.type} for ${ck} — no active viewer (viewers: [${[...activeAgentViewers].join(', ')}])`);
      }
    };

    // Defer watcher start by 100ms so the 'preloading' IPC message has time to
    // reach the renderer and render 'starting' before the watcher processes
    // historical events and fires signalReady() (which sends 'ready').
    setTimeout(() => watcher.start(watcherCallback), 100);

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

    proc.onData((data: string) => {
      appendToScrollback(ck, data);
      // Primary ready signal: "Environment loaded" in PTY output
      if (terminalBackend?.name === 'node-pty' && !hasSignalledReady && data.includes('Environment loaded')) {
        console.log(`[TermServer] Primary ready signal for ${ck}: "Environment loaded" detected`);
        signalReady();
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
      ptyProcesses.delete(terminalKey);
      activeAgentViewers.delete(ck);
      agentScrollbackBuffers.delete(ck);
      agentScrollbackBytes.delete(ck);
      agentReadyState.delete(ck);
      agentInTurn.delete(ck);
      const w = agentWatchers.get(ck);
      if (w) { w.stop(); agentWatchers.delete(ck); }
    });

    if (terminalBackend.name === 'node-pty') {
      // Start copilot CLI
      setTimeout(() => {
        console.log(`[TermServer] Starting copilot --resume for ${ck}: ${sessionId}`);
        proc.write(`copilot --resume ${sessionId}\r`);
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
      const result = await startTerminalForAgent(msg.officeId, msg.agentId, msg.workingDir, msg.cols, msg.rows, msg.preseededPrompt);
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

    case 'resize': {
      const key = getTerminalKey(msg.officeId, msg.agentId);
      const proc = key ? ptyProcesses.get(key) : null;
      if (proc) proc.process.resize(msg.cols, msg.rows);
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
      activeAgentViewers.add(ck);

      // If this is a transferred session, the PTY data callback closure captured the
      // ORIGINAL composite key. We must also mark that key as having an active viewer,
      // otherwise terminal output and copilot-event forwarding are silently dropped.
      const termKey = agentToTerminal.get(ck);
      if (termKey && termKey !== ck) {
        activeAgentViewers.add(termKey);
        console.log(`[TermServer] Also marking original key ${termKey} as active viewer (transferred session)`);
      }

      const chunks = agentScrollbackBuffers.get(ck) || [];
      const rawScrollback = chunks.join('');
      send({ type: 'response', requestId: msg.requestId, result: { success: true, scrollback: rawScrollback } });
      break;
    }

    case 'detach': {
      const ck = compositeKey(msg.officeId, msg.agentId);
      console.log(`[TermServer] Detaching viewer for ${ck}`);
      activeAgentViewers.delete(ck);
      // Also remove original key if this was a transferred session
      const termKey = agentToTerminal.get(ck);
      if (termKey && termKey !== ck) {
        activeAgentViewers.delete(termKey);
      }
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
        spawn('wt', ['-d', cwd, 'copilot', '--resume', sid], { detached: true, stdio: 'ignore' }).unref();
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
      send({ type: 'response', requestId: msg.requestId, result: Object.fromEntries(officeData.sessionMeta) });
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

  const preferredBackend = (process.env.COPILOT_TERMINAL_BACKEND || 'node-pty').toLowerCase();
  if (preferredBackend === 'sdk') {
    terminalBackend = await CopilotSdkBackend.tryCreate();
    if (!terminalBackend) {
      console.warn('[TermServer] COPILOT_TERMINAL_BACKEND=sdk requested but @github/copilot-sdk is unavailable; falling back to node-pty');
    }
  }

  if (!terminalBackend) {
    terminalBackend = NodePtyBackend.tryCreate();
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

  // Signal ready
  send({ type: 'ready' });
  console.log('[TermServer] Ready');
}

main();
