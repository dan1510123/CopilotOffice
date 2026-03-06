// Terminal Server — runs as a forked child process.
// Owns all PTY processes, event watchers, scrollback buffers, and session persistence.
// Communicates with Electron main via process.send() / process.on('message').

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
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

// Per-agent scrollback buffer
const MAX_BUFFER_LINES = 500;
const agentScrollbackBuffers: Map<string, string[]> = new Map();

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
  }
  const lines = data.split('\n');
  for (const line of lines) {
    buf.push(line);
  }
  if (buf.length > MAX_BUFFER_LINES) {
    buf.splice(0, buf.length - MAX_BUFFER_LINES);
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
  ptyProcesses.forEach((proc, key) => {
    try { proc.process.kill(); } catch (e) { /* ignore */ }
  });
  ptyProcesses.clear();
  agentToTerminal.clear();
  agentWatchers.forEach((w) => w.stop());
  agentWatchers.clear();
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
    AGENCY_OFFICE_PROCESS: 'true',
    AGENCY_OFFICE_AGENT: agentId,
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

    // EventsWatcher
    const watcher = new EventsWatcher(sessionId);
    agentWatchers.set(agentId, watcher);

    watcher.start((event: CopilotEvent) => {
      if (!activeAgentViewers.has(agentId)) return;
      send({ type: 'copilot-event', agentId, event });

      if (event.type === 'tool.execution_start') {
        const d = event.data as { toolCallId: string; toolName: string; arguments: Record<string, unknown> };
        send({ type: 'copilot-tool-start', agentId, toolName: d.toolName, toolId: d.toolCallId, status: formatToolStatus(d.toolName, d.arguments) });
      } else if (event.type === 'tool.execution_complete') {
        const d = event.data as { toolCallId: string; success: boolean };
        send({ type: 'copilot-tool-complete', agentId, toolId: d.toolCallId, success: d.success });
      } else if (event.type === 'assistant.turn_end') {
        send({ type: 'copilot-turn-end', agentId });
      } else if (event.type === 'user.message') {
        send({ type: 'copilot-user-message', agentId });
      }
    });

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
          proc.process.kill();
          ptyProcesses.delete(key!);
          agentToTerminal.delete(msg.agentId);
          // Archive old session ID and clear it so next start generates a fresh one
          archiveSessionId(msg.agentId);
          agentSessionIds.delete(msg.agentId);
          await saveSessionIds();
          // Stop event watcher
          const w = agentWatchers.get(msg.agentId);
          if (w) { w.stop(); agentWatchers.delete(msg.agentId); }
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
      const scrollback = agentScrollbackBuffers.get(msg.agentId) || [];
      send({ type: 'response', requestId: msg.requestId, result: { success: true, scrollback } });
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

    case 'save-session-id': {
      agentSessionIds.set(msg.agentId, msg.sessionId);
      await saveSessionIds();
      console.log(`[TermServer] Saved session for ${msg.agentId}: ${msg.sessionId}`);
      send({ type: 'response', requestId: msg.requestId, result: { success: true } });
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
        try { resetProc.process.kill(); } catch { /* ignore */ }
        ptyProcesses.delete(resetKey!);
        agentToTerminal.delete(msg.agentId);
      }
      // Stop event watcher
      const resetWatcher = agentWatchers.get(msg.agentId);
      if (resetWatcher) { resetWatcher.stop(); agentWatchers.delete(msg.agentId); }
      // Clear scrollback
      agentScrollbackBuffers.delete(msg.agentId);
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
      // Regenerate a fresh GUID for every agent that had a session
      for (const agentId of agentSessionIds.keys()) {
        agentSessionIds.set(agentId, crypto.randomUUID());
      }
      await saveSessionIds();
      console.log('[TermServer] All sessions reset, new GUIDs saved');
      send({ type: 'response', requestId: msg.requestId, result: { success: true } });
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
