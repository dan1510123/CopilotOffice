/* eslint-disable no-console */
'use strict';

// Bounded server-level smoke for fleet transient session leases.
//
// Uses COPILOT_E2E shell mode so no model call is required, while still driving
// the compiled terminal server, node-pty lifecycle, persistence file, and disk
// cleanup through the real begin/dispose protocol.

const { fork } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(REPO_ROOT, 'dist', 'electron', 'terminal', 'server.js');
const RUN_ID = crypto.randomBytes(5).toString('hex');
const OFFICE_ID = `fleet-transient-smoke-${RUN_ID}`;
const AGENT_ID = 'generalist';
const LIFECYCLE_ID = `fleet-smoke-${RUN_ID}`;
const PRIOR_SESSION_ID = `persistent-${RUN_ID}`;
const UNRELATED_SESSION_ID = `unrelated-${RUN_ID}`;
const SMOKE_ROOT = path.join(os.tmpdir(), `copilot-office-fleet-${RUN_ID}`);
const COPILOT_HOME = path.join(SMOKE_ROOT, 'copilot-home');
const SESSION_FILE = path.join(SMOKE_ROOT, '.data', `${OFFICE_ID}.sessions.json`);

async function main() {
  await fs.mkdir(path.dirname(SESSION_FILE), { recursive: true });
  await fs.mkdir(path.join(COPILOT_HOME, 'session-state', PRIOR_SESSION_ID), { recursive: true });
  await fs.mkdir(path.join(COPILOT_HOME, 'session-state', UNRELATED_SESSION_ID), { recursive: true });
  await fs.writeFile(
    SESSION_FILE,
    JSON.stringify(
      {
        current: { [AGENT_ID]: PRIOR_SESSION_ID },
        history: {
          [AGENT_ID]: [{ id: `older-${RUN_ID}`, title: 'Older persistent work' }],
        },
        metadata: { [AGENT_ID]: { title: 'Prior persistent title' } },
        transient: {},
      },
      null,
      2,
    ),
  );

  const server = fork(SERVER_PATH, [], {
    cwd: SMOKE_ROOT,
    env: {
      ...process.env,
      COPILOT_E2E: '1',
      COPILOT_HOME,
      COPILOT_TERMINAL_BACKEND: 'node-pty',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  const pending = new Map();
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  let terminalExitResolve;
  const terminalExited = new Promise((resolve) => {
    terminalExitResolve = resolve;
  });

  server.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[server:err] ${chunk}`));
  server.once('exit', (code, signal) => {
    const error = new Error(`Terminal server exited early (code=${code}, signal=${signal})`);
    readyReject(error);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  server.on('message', (message) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready') {
      readyResolve();
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
    if (
      message.type === 'terminal-exit'
      && message.officeId === OFFICE_ID
      && message.agentId === AGENT_ID
      && message.lifecycleId === LIFECYCLE_ID
    ) {
      terminalExitResolve(message);
    }
  });

  const request = (message, timeoutMs = 30_000) => {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Timed out waiting for ${message.type}`));
      }, timeoutMs);
      pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      server.send({ ...message, requestId });
    });
  };

  let transientSessionId;
  try {
    await ready;
    const begin = await request({
      type: 'begin-transient-session',
      officeId: OFFICE_ID,
      agentId: AGENT_ID,
      lifecycleId: LIFECYCLE_ID,
      title: 'Fleet smoke task',
      workingDir: REPO_ROOT,
      preseededPrompt: 'fleet smoke prompt',
    });
    if (!begin?.success) throw new Error(`Transient begin failed: ${begin?.error ?? 'unknown'}`);
    transientSessionId = begin.sessionId;
    if (!transientSessionId || transientSessionId === PRIOR_SESSION_ID) {
      throw new Error('Transient begin did not mint a fresh session id');
    }

    const transientDir = path.join(COPILOT_HOME, 'session-state', transientSessionId);
    await fs.mkdir(transientDir, { recursive: true });
    await fs.writeFile(path.join(transientDir, 'events.jsonl'), '{}\n');

    const writeExit = await request({
      type: 'write',
      officeId: OFFICE_ID,
      agentId: AGENT_ID,
      data: 'exit\r',
    });
    if (!writeExit?.success) throw new Error(`Failed to stop smoke terminal: ${writeExit?.error}`);
    await Promise.race([
      terminalExited,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('Timed out waiting for transient terminal exit')),
        15_000,
      )),
    ]);

    const dispose = await request({
      type: 'dispose-transient-session',
      officeId: OFFICE_ID,
      agentId: AGENT_ID,
      lifecycleId: LIFECYCLE_ID,
    });
    if (!dispose?.success || !dispose.disposed) {
      throw new Error(`Transient dispose failed: ${dispose?.error ?? 'not disposed'}`);
    }

    const duplicateDispose = await request({
      type: 'dispose-transient-session',
      officeId: OFFICE_ID,
      agentId: AGENT_ID,
      lifecycleId: LIFECYCLE_ID,
    });
    const failedBegin = await request({
      type: 'begin-transient-session',
      officeId: OFFICE_ID,
      agentId: AGENT_ID,
      lifecycleId: `${LIFECYCLE_ID}-start-failure`,
      title: 'Fleet start failure',
      workingDir: path.join(SMOKE_ROOT, 'does-not-exist'),
      preseededPrompt: 'this prompt must never run',
    });
    const persisted = JSON.parse(await fs.readFile(SESSION_FILE, 'utf8'));
    const transientExists = await fs.access(transientDir).then(() => true, () => false);
    const priorExists = await fs
      .access(path.join(COPILOT_HOME, 'session-state', PRIOR_SESSION_ID))
      .then(() => true, () => false);
    const unrelatedExists = await fs
      .access(path.join(COPILOT_HOME, 'session-state', UNRELATED_SESSION_ID))
      .then(() => true, () => false);
    const statuses = await request({
      type: 'query-agent-statuses',
      officeId: OFFICE_ID,
    });

    const checks = {
      freshTransientId: transientSessionId !== PRIOR_SESSION_ID,
      priorCurrentRestored: persisted.current?.[AGENT_ID] === PRIOR_SESSION_ID,
      priorTitleRestored:
        persisted.metadata?.[AGENT_ID]?.title === 'Prior persistent title',
      priorHistoryPreserved:
        persisted.history?.[AGENT_ID]?.[0]?.id === `older-${RUN_ID}`,
      transientLeaseRemoved:
        !persisted.transient || !persisted.transient[AGENT_ID],
      transientDiskStateRemoved: !transientExists,
      priorDiskStatePreserved: priorExists,
      unrelatedDiskStatePreserved: unrelatedExists,
      terminalStopped: !statuses?.[AGENT_ID]?.alive,
      duplicateDisposeNoOp:
        duplicateDispose?.success === true && duplicateDispose.disposed === false,
      startFailureRolledBack:
        failedBegin?.success === false
        && persisted.current?.[AGENT_ID] === PRIOR_SESSION_ID
        && (!persisted.transient || !persisted.transient[AGENT_ID]),
    };
    if (Object.values(checks).some((value) => value !== true)) {
      throw new Error(`Transient fleet smoke failed: ${JSON.stringify(checks)}`);
    }

    console.log(JSON.stringify({
      ok: true,
      officeId: OFFICE_ID,
      priorSessionId: PRIOR_SESSION_ID,
      transientSessionId,
      checks,
    }, null, 2));
  } finally {
    if (server.connected) server.send({ type: 'shutdown' });
    await new Promise((resolve) => {
      if (server.exitCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, 10_000);
      server.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    try {
      await fs.rm(SMOKE_ROOT, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 250,
      });
    } catch (error) {
      // Windows can retain a short-lived cwd handle after node-pty exits. The
      // smoke's product assertion already proved the transient session-state
      // directory was removed; don't turn unrelated temp-root cleanup into a
      // false product failure.
      console.warn(`[fleet-smoke] Temp cleanup deferred: ${String(error)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
