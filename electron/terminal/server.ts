// Terminal Server — runs as a forked child process.
// Owns all PTY processes, event watchers, scrollback buffers, and session persistence.
// Communicates with Electron main via process.send() / process.on('message').

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { spawn, execSync } from 'child_process';
import { EventsWatcher, CopilotEvent, formatToolStatus } from './events-watcher';
import type { MainToServer, ServerToMain } from './protocol';

// ── node-pty ────────────────────────────────────────────────────

let pty: typeof import('node-pty') | null = null;

// ── State ───────────────────────────────────────────────────────

interface PtyProcess {
  pid: number;
  process: any;
  agentId: string;
  sessionId: string;
  workingDir?: string;
}

const ptyProcesses: Map<string, PtyProcess> = new Map();
const agentToTerminal: Map<string, string> = new Map();
const activeAgentViewers: Set<string> = new Set();
const agentWatchers: Map<string, EventsWatcher> = new Map();

// Track per-agent ready state so it can be queried by the renderer
const agentReadyState: Map<string, boolean> = new Map();

// Per-agent raw scrollback buffer (preserves ANSI escape sequences)
const MAX_BUFFER_BYTES = 512 * 1024; // 512 KB
const agentScrollbackBuffers: Map<string, string[]> = new Map();
const agentScrollbackBytes: Map<string, number> = new Map();

// Session persistence
const SESSION_FILE = path.join(process.cwd(), 'copilot-office-sessions.json');
let agentSessionIds: Map<string, string> = new Map();
let agentSessionHistory: Map<string, string[]> = new Map();

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

async function loadSessionIds(): Promise<void> {
  try {
    const raw = await fs.promises.readFile(SESSION_FILE, 'utf8').catch(() => null);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate: old flat format → new { current, history } format
      if (parsed.current && typeof parsed.current === 'object') {
        agentSessionIds = new Map(Object.entries(parsed.current));
        agentSessionHistory = new Map(
          Object.entries(parsed.history || {}).map(([k, v]) => [k, v as string[]])
        );
      } else {
        // Legacy flat format: { agentId: sessionId }
        agentSessionIds = new Map(Object.entries(parsed));
        agentSessionHistory = new Map();
        // Persist migration immediately
        await saveSessionIds();
      }
      console.log('[TermServer] Loaded saved sessions:', agentSessionIds.size, 'history entries:', agentSessionHistory.size);
    }
  } catch (e) {
    console.error('[TermServer] Failed to load session IDs:', e);
  }
}

async function saveSessionIds(): Promise<void> {
  try {
    const data = {
      current: Object.fromEntries(agentSessionIds),
      history: Object.fromEntries(agentSessionHistory),
    };
    await fs.promises.writeFile(SESSION_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[TermServer] Failed to save session IDs:', e);
  }
}

function archiveSessionId(agentId: string): void {
  const oldId = agentSessionIds.get(agentId);
  if (oldId) {
    const history = agentSessionHistory.get(agentId) || [];
    if (!history.includes(oldId)) {
      history.push(oldId);
      agentSessionHistory.set(agentId, history);
    }
  }
}

function getTerminalKey(agentId: string): string | null {
  const assignedKey = agentToTerminal.get(agentId);
  if (assignedKey && ptyProcesses.has(assignedKey)) return assignedKey;
  if (ptyProcesses.has(agentId)) return agentId;
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
  try {
    if (os.platform() === 'win32') {
      try {
        execSync(`taskkill /T /F /PID ${proc.pid}`, { stdio: 'ignore' });
      } catch {
        proc.process.kill();
      }
    } else {
      proc.process.kill();
    }
  } catch { /* process already dead */ }
}

// ── PTY Lifecycle ───────────────────────────────────────────────

async function startTerminalForAgent(
  agentId: string,
  workingDir?: string,
  cols?: number,
  rows?: number
): Promise<{ success: boolean; pid?: number; sessionId?: string; reused?: boolean; error?: string }> {
  if (!pty) {
    return { success: false, error: 'node-pty not available' };
  }

  const existingTerminalKey = agentToTerminal.get(agentId);
  if (existingTerminalKey && ptyProcesses.has(existingTerminalKey)) {
    const existing = ptyProcesses.get(existingTerminalKey)!;
    return { success: true, pid: existing.pid, sessionId: existing.sessionId, reused: true };
  }

  let sessionId = agentSessionIds.get(agentId);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    agentSessionIds.set(agentId, sessionId);
    await saveSessionIds();
    console.log(`[TermServer] New session GUID for ${agentId}: ${sessionId}`);
  } else {
    console.log(`[TermServer] Reusing session GUID for ${agentId}: ${sessionId}`);
  }

  const terminalKey = agentId;
  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  let cwd = process.cwd();
  if (workingDir) {
    const customPath = path.join(process.cwd(), workingDir);
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
    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
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

    agentToTerminal.set(agentId, terminalKey);
    agentSessionIds.set(agentId, sessionId);
    await saveSessionIds();

    // Signal that the PTY is spawned and copilot CLI is starting
    send({ type: 'terminal-preload-status', agentId, status: 'preloading' });

    // EventsWatcher — defer start so the preloading signal has time to reach
    // the renderer and render 'starting' before the watcher processes historical
    // events and potentially fires signalReady() (which sends 'ready').
    const watcher = new EventsWatcher(sessionId);
    agentWatchers.set(agentId, watcher);

    let hasSignalledReady = false;
    let skippedEventCount = 0;
    agentReadyState.set(agentId, false);

    const signalReady = () => {
      if (hasSignalledReady) return;
      hasSignalledReady = true;
      agentReadyState.set(agentId, true);
      console.log(`[TermServer] Agent ${agentId} signalled READY at ${Date.now()} (skipped ${skippedEventCount} startup events)`);
      send({ type: 'terminal-preload-status', agentId, status: 'ready' });
    };

    const watcherCallback = (event: CopilotEvent) => {
      // Primary ready signal: first turn_end means copilot CLI has finished loading
      if (!hasSignalledReady && (event.type === 'assistant.turn_end' || event.type === 'user.message')) {
        signalReady();
      }

      // Only forward AFTER the agent is ready — during startup, old events
      // from resumed sessions would interfere with the custom startup detection.
      if (!hasSignalledReady) {
        skippedEventCount++;
        return;
      }

      if (event.type === 'tool.execution_start') {
        const d = event.data as { toolCallId: string; toolName: string; arguments: Record<string, unknown> };
        console.log(`[TermServer] Forwarding tool_start for ${agentId}: ${d.toolName}`);
        send({ type: 'copilot-tool-start', agentId, toolName: d.toolName, toolId: d.toolCallId, status: formatToolStatus(d.toolName, d.arguments) });
      } else if (event.type === 'tool.execution_complete') {
        const d = event.data as { toolCallId: string; success: boolean };
        console.log(`[TermServer] Forwarding tool_complete for ${agentId}: ${d.toolCallId}`);
        send({ type: 'copilot-tool-complete', agentId, toolId: d.toolCallId, success: d.success });
      } else if (event.type === 'assistant.turn_end') {
        console.log(`[TermServer] Forwarding turn_end for ${agentId}`);
        send({ type: 'copilot-turn-end', agentId });
      } else if (event.type === 'assistant.turn_start') {
        console.log(`[TermServer] Forwarding turn_start for ${agentId}`);
        send({ type: 'copilot-turn-start', agentId });
      } else if (event.type === 'user.message') {
        console.log(`[TermServer] Forwarding user_message for ${agentId}`);
        send({ type: 'copilot-user-message', agentId });
      }

      // Only forward the verbose raw copilot-event when someone is viewing
      if (activeAgentViewers.has(agentId)) {
        send({ type: 'copilot-event', agentId, event });
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
      if (pendingData && activeAgentViewers.has(agentId)) {
        send({ type: 'terminal-data', agentId, data: pendingData });
      }
      pendingData = '';
    };

    proc.onData((data: string) => {
      appendToScrollback(agentId, data);
      // Primary ready signal: "Environment loaded" in PTY output
      if (!hasSignalledReady && data.includes('Environment loaded')) {
        console.log(`[TermServer] Primary ready signal for ${agentId}: "Environment loaded" detected`);
        signalReady();
      }
      if (!activeAgentViewers.has(agentId)) return;
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
      activeAgentViewers.delete(agentId);
      agentScrollbackBuffers.delete(agentId);
      agentScrollbackBytes.delete(agentId);
      agentReadyState.delete(agentId);
      const w = agentWatchers.get(agentId);
      if (w) { w.stop(); agentWatchers.delete(agentId); }
    });

    // Start copilot CLI
    setTimeout(() => {
      console.log(`[TermServer] Starting copilot --resume for ${agentId}: ${sessionId}`);
      proc.write(`copilot --resume ${sessionId}\r`);
    }, 500);

    return { success: true, pid: proc.pid, sessionId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ── Message Handler ─────────────────────────────────────────────

async function handleMessage(msg: MainToServer): Promise<void> {
  switch (msg.type) {
    case 'start': {
      activeAgentViewers.add(msg.agentId);
      const result = await startTerminalForAgent(msg.agentId, msg.workingDir, msg.cols, msg.rows);
      send({ type: 'response', requestId: msg.requestId, result });
      break;
    }

    case 'write': {
      const key = getTerminalKey(msg.agentId);
      const proc = key ? ptyProcesses.get(key) : null;
      if (proc) proc.process.write(msg.data);
      break;
    }

    case 'resize': {
      const key = getTerminalKey(msg.agentId);
      const proc = key ? ptyProcesses.get(key) : null;
      if (proc) proc.process.resize(msg.cols, msg.rows);
      break;
    }

    case 'kill': {
      const key = getTerminalKey(msg.agentId);
      const proc = key ? ptyProcesses.get(key) : null;
      if (proc) {
        try {
          killPtyProcess(proc);
          ptyProcesses.delete(key!);
          agentToTerminal.delete(msg.agentId);
          // Archive old session ID and clear it so next start generates a fresh one
          archiveSessionId(msg.agentId);
          agentSessionIds.delete(msg.agentId);
          await saveSessionIds();
          // Stop event watcher
          const w = agentWatchers.get(msg.agentId);
          if (w) { w.stop(); agentWatchers.delete(msg.agentId); }
          agentReadyState.delete(msg.agentId);
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
      console.log(`[TermServer] Attaching viewer for ${msg.agentId}`);
      activeAgentViewers.add(msg.agentId);
      const chunks = agentScrollbackBuffers.get(msg.agentId) || [];
      const rawScrollback = chunks.join('');
      send({ type: 'response', requestId: msg.requestId, result: { success: true, scrollback: rawScrollback } });
      break;
    }

    case 'detach': {
      console.log(`[TermServer] Detaching viewer for ${msg.agentId}`);
      activeAgentViewers.delete(msg.agentId);
      break;
    }

    case 'exists': {
      send({ type: 'response', requestId: msg.requestId, result: getTerminalKey(msg.agentId) !== null });
      break;
    }

    case 'get-session-id': {
      send({ type: 'response', requestId: msg.requestId, result: agentSessionIds.get(msg.agentId) || null });
      break;
    }

    case 'pop-out': {
      const sid = agentSessionIds.get(msg.agentId);
      if (!sid) {
        send({ type: 'response', requestId: msg.requestId, result: { success: false, error: 'No session found for agent' } });
        break;
      }
      const termKey = agentToTerminal.get(msg.agentId);
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
      console.log(`[TermServer] Resetting session for ${msg.agentId}`);
      // Kill PTY if alive
      const resetKey = getTerminalKey(msg.agentId);
      const resetProc = resetKey ? ptyProcesses.get(resetKey) : null;
      if (resetProc) {
        killPtyProcess(resetProc);
        ptyProcesses.delete(resetKey!);
        agentToTerminal.delete(msg.agentId);
      }
      // Stop event watcher
      const resetWatcher = agentWatchers.get(msg.agentId);
      if (resetWatcher) { resetWatcher.stop(); agentWatchers.delete(msg.agentId); }
      agentReadyState.delete(msg.agentId);
      // Clear scrollback
      agentScrollbackBuffers.delete(msg.agentId);
      agentScrollbackBytes.delete(msg.agentId);
      activeAgentViewers.delete(msg.agentId);
      // Archive old session ID and generate new one (but don't start PTY)
      archiveSessionId(msg.agentId);
      const newSessionId = crypto.randomUUID();
      agentSessionIds.set(msg.agentId, newSessionId);
      await saveSessionIds();
      console.log(`[TermServer] Reset session for ${msg.agentId}: new GUID ${newSessionId}`);
      send({ type: 'response', requestId: msg.requestId, result: { success: true, sessionId: newSessionId } });
      break;
    }

    case 'get-session-history': {
      const history = agentSessionHistory.get(msg.agentId) || [];
      send({ type: 'response', requestId: msg.requestId, result: history });
      break;
    }

    case 'clear-session-history': {
      agentSessionHistory.delete(msg.agentId);
      await saveSessionIds();
      console.log(`[TermServer] Cleared session history for ${msg.agentId}`);
      send({ type: 'response', requestId: msg.requestId, result: { success: true } });
      break;
    }

    case 'reset-all-sessions': {
      console.log('[TermServer] Resetting all sessions — killing PTYs and generating new GUIDs');
      killAllPtyProcesses();
      agentScrollbackBuffers.clear();
      agentScrollbackBytes.clear();
      // Regenerate a fresh GUID for every agent that had a session
      for (const agentId of agentSessionIds.keys()) {
        agentSessionIds.set(agentId, crypto.randomUUID());
      }
      await saveSessionIds();
      console.log('[TermServer] All sessions reset, new GUIDs saved');
      send({ type: 'response', requestId: msg.requestId, result: { success: true } });
      break;
    }

    case 'list-active': {
      const activeAgentIds = Array.from(agentToTerminal.keys()).filter(id => {
        const key = agentToTerminal.get(id);
        return key && ptyProcesses.has(key);
      });
      console.log(`[TermServer] Active terminals: ${activeAgentIds.join(', ') || '(none)'}`);
      send({ type: 'response', requestId: msg.requestId, result: activeAgentIds });
      break;
    }

    case 'query-agent-statuses': {
      const statuses: Record<string, { alive: boolean; ready: boolean }> = {};
      for (const [agentId] of agentToTerminal) {
        const key = agentToTerminal.get(agentId);
        const alive = !!(key && ptyProcesses.has(key));
        const ready = agentReadyState.get(agentId) ?? false;
        statuses[agentId] = { alive, ready };
      }
      send({ type: 'response', requestId: msg.requestId, result: statuses });
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

  // Load node-pty
  try {
    pty = require('node-pty');
    console.log('[TermServer] node-pty loaded');
  } catch (e) {
    console.error('[TermServer] Failed to load node-pty:', e);
  }

  await loadSessionIds();

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
