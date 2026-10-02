/* eslint-disable no-console */
'use strict';

// Bounded real smoke for the default native-TUI bridge architecture.
//
// Starts the compiled terminal server in an isolated cwd, launches two pinned
// native Copilot TUIs concurrently, submits SDK-bridge prompts to each, verifies
// terminal/event isolation, runs /clear in one TUI and verifies the extension
// reconnects on a new session, then kills every process and removes smoke state.

const { fork, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(REPO_ROOT, 'dist', 'electron', 'terminal', 'server.js');
const RUN_ID = crypto.randomBytes(5).toString('hex');
const OFFICE_ID = `native-bridge-smoke-${RUN_ID}`;
const AGENTS = ['smoke-a', 'smoke-b'];
const SMOKE_ROOT = path.join(os.tmpdir(), `copilot-office-native-bridge-${RUN_ID}`);
const SESSION_STATE_ROOT = path.join(os.homedir(), '.copilot', 'session-state');
const START_TIMEOUT_MS = 120_000;
const TURN_TIMEOUT_MS = 120_000;
const CLEAR_TIMEOUT_MS = 45_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function eventContent(event) {
  const data = event && typeof event === 'object' ? event.data : undefined;
  if (!data || typeof data !== 'object') return '';
  const value = data.content ?? data.text ?? data.message ?? '';
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => (typeof part === 'string' ? part : part?.text))
    .filter((part) => typeof part === 'string')
    .join('');
}

function terminalTail(value, maxChars = 4000) {
  const plain = String(value ?? '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  return plain.slice(-maxChars);
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killTree(pid) {
  if (!processAlive(pid)) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill.exe', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    // Best effort; the terminal server's canonical cleanup path runs first.
  }
}

async function main() {
  await fs.mkdir(SMOKE_ROOT, { recursive: true });

  const childEnv = { ...process.env, COPILOT_TERMINAL_BACKEND: 'native-bridge' };
  delete childEnv.COPILOT_E2E;
  delete childEnv.COPILOT_TEST_DISABLE_INTERRUPTED_SESSION_RESTORE;

  const server = fork(SERVER_PATH, [], {
    cwd: SMOKE_ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  const pending = new Map();
  const terminalOutput = new Map(AGENTS.map((agentId) => [agentId, '']));
  const assistantMessages = new Map(AGENTS.map((agentId) => [agentId, []]));
  const sessionChanges = [];
  const exitEvents = [];
  const startedPids = [];
  const createdSessionIds = new Set();
  const readyAgents = new Set();
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const onServerExit = (code, signal) => {
    const error = new Error(`Terminal server exited early (code=${code}, signal=${signal})`);
    readyReject(error);
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  server.once('exit', onServerExit);
  server.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[server:err] ${chunk}`));
  server.on('message', (message) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready') {
      if (message.backend?.name !== 'native-bridge') {
        readyReject(new Error(
          `Native bridge did not load: ${message.backend?.reason ?? message.backend?.name ?? 'unknown'}`,
        ));
      } else {
        readyResolve(message.backend);
      }
      return;
    }
    if (message.type === 'response' && typeof message.requestId === 'string') {
      const waiter = pending.get(message.requestId);
      if (waiter) {
        pending.delete(message.requestId);
        waiter.resolve(message.result);
      }
      return;
    }
    if (message.type === 'terminal-data' && AGENTS.includes(message.agentId)) {
      terminalOutput.set(
        message.agentId,
        `${terminalOutput.get(message.agentId) ?? ''}${String(message.data ?? '')}`,
      );
      return;
    }
    if (message.type === 'copilot-event' && AGENTS.includes(message.agentId)) {
      if (message.event?.type === 'assistant.message') {
        assistantMessages.get(message.agentId)?.push(eventContent(message.event));
      }
      return;
    }
    if (
      message.type === 'session-meta-updated'
      && message.officeId === OFFICE_ID
      && AGENTS.includes(message.agentId)
      && message.meta?.sessionId
    ) {
      createdSessionIds.add(message.meta.sessionId);
      sessionChanges.push({
        agentId: message.agentId,
        sessionId: message.meta.sessionId,
      });
      return;
    }
    if (message.type === 'terminal-exit' && AGENTS.includes(message.agentId)) {
      exitEvents.push({ agentId: message.agentId, exitCode: message.exitCode });
    }
  });

  function request(message, timeoutMs = 30_000) {
    if (!server.connected) return Promise.reject(new Error('Terminal server IPC is disconnected'));
    const requestId = crypto.randomUUID();
    const promise = new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      server.send({ ...message, requestId }, (error) => {
        if (!error) return;
        pending.delete(requestId);
        reject(error);
      });
    });
    return withTimeout(
      promise,
      timeoutMs,
      `Timed out waiting for terminal-server response: ${message.type}`,
    ).finally(() => pending.delete(requestId));
  }

  async function waitUntil(predicate, timeoutMs, description) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${description}`);
  }

  async function acceptFolderTrustIfNeeded(agentId) {
    // Folder trust is a native TUI prompt, and its ANSI-rendered wording has
    // changed across CLI builds. Empty Enter is a no-op once the normal prompt
    // is ready, so press it boundedly while this agent is still preloading.
    for (const waitMs of [8_000, 10_000, 10_000, 10_000]) {
      await delay(waitMs);
      if (readyAgents.has(agentId)) return;
      await request({
        type: 'write',
        officeId: OFFICE_ID,
        agentId,
        data: '\r',
      }).catch(() => undefined);
    }
  }

  try {
    await withTimeout(ready, 20_000, 'Terminal server did not load the native bridge');

    const starts = AGENTS.map((agentId) => request({
        type: 'start',
        officeId: OFFICE_ID,
        agentId,
        workingDir: REPO_ROOT,
        cols: 120,
        rows: 40,
        readyTimeoutMs: 90_000,
      }, START_TIMEOUT_MS)
      .then((result) => {
        if (result?.success && result?.ready) readyAgents.add(agentId);
        if (result?.pid) startedPids.push(result.pid);
        if (result?.sessionId) createdSessionIds.add(result.sessionId);
        return result;
      }));

    const trustHelpers = AGENTS.map((agentId) => acceptFolderTrustIfNeeded(agentId));
    const startResults = await Promise.all(starts);
    await Promise.allSettled(trustHelpers);
    for (const [index, result] of startResults.entries()) {
      if (!result?.success || !result?.ready || !result?.sessionId || !result?.pid) {
        throw new Error(
          `Agent ${AGENTS[index]} failed to start: ${result?.error ?? JSON.stringify(result)}\n` +
          `Terminal tail:\n${terminalTail(terminalOutput.get(AGENTS[index]))}`,
        );
      }
    }
    if (startResults[0].sessionId === startResults[1].sessionId) {
      throw new Error('Concurrent agents registered the same session id');
    }
    if (startResults[0].pid === startResults[1].pid) {
      throw new Error('Concurrent agents shared one native TUI process');
    }

    const prompts = {
      'smoke-a': {
        promptMarker: `OFFICE_BRIDGE_PROMPT_A_${RUN_ID}`,
        responseMarker: `OFFICE_BRIDGE_RESPONSE_A_${RUN_ID}`,
      },
      'smoke-b': {
        promptMarker: `OFFICE_BRIDGE_PROMPT_B_${RUN_ID}`,
        responseMarker: `OFFICE_BRIDGE_RESPONSE_B_${RUN_ID}`,
      },
    };

    await Promise.all(AGENTS.map((agentId) => {
      const marker = prompts[agentId];
      return request({
        type: 'submit-prompt',
        officeId: OFFICE_ID,
        agentId,
        prompt: `${marker.promptMarker}. Reply with exactly ${marker.responseMarker} and nothing else. Do not use tools.`,
      }, 40_000);
    }));

    await Promise.all(AGENTS.map((agentId) => waitUntil(
      () => assistantMessages.get(agentId)?.some((text) => text.includes(prompts[agentId].responseMarker)),
      TURN_TIMEOUT_MS,
      `${agentId} assistant response`,
    )));
    await Promise.all(AGENTS.map((agentId) => waitUntil(
      () => (terminalOutput.get(agentId) ?? '').includes(prompts[agentId].responseMarker),
      TURN_TIMEOUT_MS,
      `${agentId} native TUI rendering`,
    )));

    const outputA = terminalOutput.get('smoke-a') ?? '';
    const outputB = terminalOutput.get('smoke-b') ?? '';
    if (outputA.includes(prompts['smoke-b'].promptMarker) || outputB.includes(prompts['smoke-a'].promptMarker)) {
      throw new Error('Prompt/output crossed between independent native TUI agents');
    }

    const previousASession = startResults[0].sessionId;
    let replacement;
    const clearDeadline = Date.now() + CLEAR_TIMEOUT_MS;
    while (!replacement && Date.now() < clearDeadline) {
      // Ink can briefly detach stdin during a final render. Clear the current
      // input line, submit /clear, and retry only if no replacement registration
      // appears within the bounded slice.
      await request({
        type: 'write',
        officeId: OFFICE_ID,
        agentId: 'smoke-a',
        data: '\x15/clear\r',
      });
      replacement = await waitUntil(
        () => sessionChanges.find(
          (change) => change.agentId === 'smoke-a' && change.sessionId !== previousASession,
        ),
        Math.min(12_000, Math.max(100, clearDeadline - Date.now())),
        'smoke-a bridge reconnect after /clear',
      ).catch(() => undefined);
    }
    if (!replacement) throw new Error('Timed out waiting for smoke-a bridge reconnect after /clear');
    createdSessionIds.add(replacement.sessionId);

    const postClearPrompt = `OFFICE_BRIDGE_POST_CLEAR_PROMPT_${RUN_ID}`;
    const postClearResponse = `OFFICE_BRIDGE_POST_CLEAR_RESPONSE_${RUN_ID}`;
    await request({
      type: 'submit-prompt',
      officeId: OFFICE_ID,
      agentId: 'smoke-a',
      prompt: `${postClearPrompt}. Reply with exactly ${postClearResponse} and nothing else. Do not use tools.`,
    }, 40_000);
    await waitUntil(
      () => assistantMessages.get('smoke-a')?.some((text) => text.includes(postClearResponse)),
      TURN_TIMEOUT_MS,
      'smoke-a post-clear assistant response',
    );
    await waitUntil(
      () => (terminalOutput.get('smoke-a') ?? '').includes(postClearResponse),
      TURN_TIMEOUT_MS,
      'smoke-a post-clear native TUI rendering',
    );

    console.log(JSON.stringify({
      ok: true,
      officeId: OFFICE_ID,
      agents: startResults.map((result, index) => ({
        agentId: AGENTS[index],
        pid: result.pid,
        initialSessionId: result.sessionId,
      })),
      replacementSessionId: replacement.sessionId,
      independentPids: startResults[0].pid !== startResults[1].pid,
      independentSessions: startResults[0].sessionId !== startResults[1].sessionId,
      promptsRenderedInMatchingTuis: true,
      postClearReconnectAndPrompt: true,
    }, null, 2));
  } finally {
    for (const agentId of AGENTS) {
      await request({
        type: 'kill',
        officeId: OFFICE_ID,
        agentId,
      }, 10_000).catch(() => undefined);
    }
    await waitUntil(
      () => exitEvents.length >= AGENTS.length || startedPids.every((pid) => !processAlive(pid)),
      10_000,
      'native TUI process exits',
    ).catch(() => undefined);
    if (server.connected) server.send({ type: 'shutdown' });
    await withTimeout(
      new Promise((resolve) => server.once('exit', resolve)),
      10_000,
      'terminal server shutdown',
    ).catch(() => killTree(server.pid));
    server.removeListener('exit', onServerExit);

    for (const pid of startedPids) killTree(pid);
    const stillAlive = startedPids.filter(processAlive);
    if (stillAlive.length > 0) {
      throw new Error(`Native TUI processes survived cleanup: ${stillAlive.join(', ')}`);
    }

    for (const sessionId of createdSessionIds) {
      await fs.rm(path.join(SESSION_STATE_ROOT, sessionId), { recursive: true, force: true });
    }
    await fs.rm(SMOKE_ROOT, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[native-bridge-smoke] ${error.stack || error}`);
  process.exitCode = 1;
});
