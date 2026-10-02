/* eslint-disable no-console */
'use strict';

// Bounded, data-safe startup harness for restored native-bridge offices.
//
// Reproduces "restored office launches N agents at once" without touching the
// user's persisted CopilotOffice .data or their real Copilot sessions:
//   * the compiled terminal server runs with an isolated temp cwd, so its .data
//     (office session map, pty registry) lives under the temp root;
//   * every restored session is a COPY of a real session-state directory under
//     a brand-new UUID (lock files and remote mission-control linkage stripped);
//   * fresh agents get brand-new UUIDs;
//   * all copied/created session-state directories and the temp root are
//     removed on exit, and every launched native TUI is killed.
//
// Usage:
//   node scripts/smoke-native-bridge-restored.js --cwd <repo> \
//     [--restore <id,id,...>] [--restore-from <office.sessions.json> [--limit N]] \
//     [--fresh N] [--timeout-sec 150] [--prompt]
//
// Prints a per-agent startup timeline (spawn, first PTY output, consent,
// registration/READY, exit) and a JSON summary; exits non-zero unless every
// agent became READY (and, with --prompt, rendered a bridge prompt reply).

const { fork, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(REPO_ROOT, 'dist', 'electron', 'terminal', 'server.js');
const SESSION_STATE_ROOT = path.join(os.homedir(), '.copilot', 'session-state');
const RUN_ID = crypto.randomBytes(5).toString('hex');
const OFFICE_ID = `native-bridge-restored-${RUN_ID}`;
const TEMP_ROOT = path.join(os.tmpdir(), `copilot-office-restored-${RUN_ID}`);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const options = { restore: [], fresh: 0, timeoutSec: 150, prompt: false, limit: Infinity };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      i += 1;
      return value;
    };
    if (arg === '--cwd') options.cwd = path.resolve(next());
    else if (arg === '--restore') options.restore.push(...next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (arg === '--restore-from') options.restoreFrom = path.resolve(next());
    else if (arg === '--limit') options.limit = Number(next());
    else if (arg === '--fresh') options.fresh = Number(next());
    else if (arg === '--timeout-sec') options.timeoutSec = Number(next());
    else if (arg === '--prompt') options.prompt = true;
    else if (arg === '--dump-dir') options.dumpDir = path.resolve(next());
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.cwd) throw new Error('--cwd is required');
  return options;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(value) {
  return String(value ?? '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
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
    // Best effort.
  }
}

async function replaceInFile(source, destination, from, to) {
  // Stream line-by-line so multi-MB events.jsonl copies stay bounded in memory.
  const input = fs.createReadStream(source, { encoding: 'utf8' });
  const output = fs.createWriteStream(destination, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!output.write(`${line.split(from).join(to)}\n`)) {
      await new Promise((resolve) => output.once('drain', resolve));
    }
  }
  await new Promise((resolve, reject) => output.end((error) => (error ? reject(error) : resolve())));
}

/** Copy a real session-state directory under a new UUID; never mutates the source. */
async function copySession(sourceId) {
  if (!UUID_RE.test(sourceId)) throw new Error(`Not a session id: ${sourceId}`);
  const sourceDir = path.join(SESSION_STATE_ROOT, sourceId);
  await fsp.access(path.join(sourceDir, 'workspace.yaml'));
  const newId = crypto.randomUUID();
  const destinationDir = path.join(SESSION_STATE_ROOT, newId);

  async function copyDir(from, to) {
    await fsp.mkdir(to, { recursive: true });
    for (const entry of await fsp.readdir(from, { withFileTypes: true })) {
      const name = entry.name;
      if (/^inuse\..*\.lock$/i.test(name) || name === '.workspace-fork.lock' || name.includes('.tmp.')) continue;
      const src = path.join(from, name);
      const dst = path.join(to, name);
      if (entry.isDirectory()) {
        await copyDir(src, dst);
      } else if (from === sourceDir && name === 'workspace.yaml') {
        const yaml = (await fsp.readFile(src, 'utf8'))
          .split(/\r?\n/)
          // Drop remote mission-control linkage so the copy can never export
          // into, or be steered from, the user's real remote session.
          .filter((line) => !/^mc_[a-z_]+:/.test(line))
          .join('\n')
          .split(sourceId).join(newId);
        await fsp.writeFile(dst, yaml, 'utf8');
      } else if (from === sourceDir && name === 'events.jsonl') {
        await replaceInFile(src, dst, sourceId, newId);
      } else if (entry.isFile()) {
        await fsp.copyFile(src, dst);
      }
    }
  }

  await copyDir(sourceDir, destinationDir);
  return newId;
}

function newestLogFor(pid, sinceMs) {
  const logDir = path.join(os.homedir(), '.copilot', 'logs');
  try {
    return fs.readdirSync(logDir)
      .filter((name) => name.endsWith(`-${pid}.log`))
      .map((name) => path.join(logDir, name))
      .filter((file) => fs.statSync(file).mtimeMs >= sinceMs)
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  } catch {
    return undefined;
  }
}

function extensionOutcomes(sessionIds, sinceMs) {
  const logDir = path.join(os.homedir(), '.copilot', 'logs');
  const outcomes = [];
  let names = [];
  try {
    names = fs.readdirSync(logDir);
  } catch {
    return outcomes;
  }
  for (const name of names) {
    const file = path.join(logDir, name);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.mtimeMs < sinceMs || stat.size > 64 * 1024) continue;
    const text = fs.readFileSync(file, 'utf8');
    const moduleMatch = /module=\S*[\\/]extensions[\\/]([^\\/]+)[\\/]/.exec(text);
    const sessionMatch = /SESSION_ID=([0-9a-f-]{36})/i.exec(text);
    if (!moduleMatch || !sessionMatch || !sessionIds.has(sessionMatch[1])) continue;
    const markers = text.split(/\r?\n/).filter((line) => line.startsWith('===') && !line.includes('launch pid='));
    outcomes.push({ extension: moduleMatch[1], sessionId: sessionMatch[1], markers });
  }
  return outcomes;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await fsp.access(SERVER_PATH);

  let sourceIds = [...options.restore];
  if (options.restoreFrom) {
    const parsed = JSON.parse(await fsp.readFile(options.restoreFrom, 'utf8'));
    const current = parsed.current && typeof parsed.current === 'object' ? parsed.current : parsed;
    for (const value of Object.values(current)) {
      if (typeof value === 'string' && UUID_RE.test(value)
        && fs.existsSync(path.join(SESSION_STATE_ROOT, value, 'workspace.yaml'))) {
        sourceIds.push(value);
      }
    }
  }
  sourceIds = [...new Set(sourceIds)].slice(0, options.limit);

  // Never delete a session-state directory that existed before this run, even
  // if a bridge registration reports it.
  const preexistingSessions = new Set(fs.existsSync(SESSION_STATE_ROOT) ? fs.readdirSync(SESSION_STATE_ROOT) : []);
  const createdSessionIds = new Set();
  const agents = [];
  const startedPids = [];
  const runStartedAt = Date.now();
  let server;

  try {
    for (const [index, sourceId] of sourceIds.entries()) {
      const copyId = await copySession(sourceId);
      createdSessionIds.add(copyId);
      agents.push({ agentId: `restored-${index}`, sessionId: copyId, sourceId, kind: 'restored' });
    }
    for (let index = 0; index < options.fresh; index += 1) {
      const sessionId = crypto.randomUUID();
      createdSessionIds.add(sessionId);
      agents.push({ agentId: `fresh-${index}`, sessionId, kind: 'fresh' });
    }
    if (agents.length === 0) throw new Error('No agents requested (use --restore/--restore-from/--fresh)');

    await fsp.mkdir(path.join(TEMP_ROOT, '.data'), { recursive: true });
    await fsp.writeFile(
      path.join(TEMP_ROOT, '.data', `${OFFICE_ID}.sessions.json`),
      JSON.stringify({
        current: Object.fromEntries(agents.map((agent) => [agent.agentId, agent.sessionId])),
        history: {},
        metadata: {},
      }, null, 2),
    );

    const childEnv = { ...process.env, COPILOT_TERMINAL_BACKEND: 'native-bridge', COPILOT_AUTO_UPDATE: 'false' };
    delete childEnv.COPILOT_E2E;
    delete childEnv.COPILOT_TEST_DISABLE_INTERRUPTED_SESSION_RESTORE;
    server = fork(SERVER_PATH, [], { cwd: TEMP_ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });

    const state = new Map(agents.map((agent) => [agent.agentId, {
      ...agent,
      output: '',
      bytes: 0,
      firstOutputMs: null,
      readyMs: null,
      exit: null,
      pid: null,
      consentApprovedMs: null,
      assistant: [],
    }]));
    const pending = new Map();
    const serverLines = [];
    let readyResolve;
    let readyReject;
    const serverReady = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const at = () => Date.now() - runStartedAt;

    const onServerLine = (line) => {
      serverLines.push(`${at()}ms ${line}`);
      if (serverLines.length > 4000) serverLines.shift();
      const approve = /Approving scoped environment access for [^:]+:([^#\s]+)/.exec(line);
      if (approve && state.has(approve[1])) state.get(approve[1]).consentApprovedMs ??= at();
    };
    let stdoutRest = '';
    server.stdout.on('data', (chunk) => {
      const text = stdoutRest + chunk;
      const parts = text.split(/\r?\n/);
      stdoutRest = parts.pop() ?? '';
      parts.forEach(onServerLine);
    });
    server.stderr.on('data', (chunk) => String(chunk).split(/\r?\n/).filter(Boolean).forEach((l) => onServerLine(`[err] ${l}`)));
    server.once('exit', (code, signal) => {
      const error = new Error(`Terminal server exited early (code=${code}, signal=${signal})`);
      readyReject(error);
      for (const waiter of pending.values()) waiter.reject(error);
    });
    server.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ready') {
        if (message.backend?.name === 'native-bridge') readyResolve(message.backend);
        else readyReject(new Error(`Native bridge did not load: ${JSON.stringify(message.backend)}`));
        return;
      }
      if (message.type === 'response' && pending.has(message.requestId)) {
        const waiter = pending.get(message.requestId);
        pending.delete(message.requestId);
        waiter.resolve(message.result);
        return;
      }
      const agent = message.officeId === OFFICE_ID ? state.get(message.agentId) : undefined;
      if (!agent) return;
      if (message.type === 'terminal-data') {
        const data = String(message.data ?? '');
        agent.firstOutputMs ??= at();
        agent.bytes += data.length;
        agent.output = (agent.output + data).slice(-256 * 1024);
      } else if (message.type === 'terminal-preload-status' && message.status === 'ready') {
        agent.readyMs ??= at();
      } else if (message.type === 'terminal-exit') {
        agent.exit = { atMs: at(), exitCode: message.exitCode };
      } else if (message.type === 'session-meta-updated' && message.meta?.sessionId) {
        createdSessionIds.add(message.meta.sessionId);
      } else if (message.type === 'copilot-event' && message.event?.type === 'assistant.message') {
        const content = message.event?.data?.content;
        if (typeof content === 'string') agent.assistant.push(content);
      }
    });

    function request(message, timeoutMs = 30_000) {
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Timed out waiting for ${message.type}`));
        }, timeoutMs);
        pending.set(requestId, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
        server.send({ ...message, requestId }, (error) => {
          if (!error) return;
          clearTimeout(timer);
          pending.delete(requestId);
          reject(error);
        });
      });
    }

    await Promise.race([serverReady, delay(30_000).then(() => { throw new Error('server ready timeout'); })]);
    console.log(`[restored-smoke] server ready; starting ${agents.length} agent(s) in ${options.cwd}`);

    // Mirror the renderer: every agent of the restored office is started at
    // once, without readyTimeoutMs, and nothing ever presses keys for it.
    const startResults = await Promise.all(agents.map((agent) => request({
      type: 'start',
      officeId: OFFICE_ID,
      agentId: agent.agentId,
      workingDir: options.cwd,
      hostWorkingDir: options.cwd,
    }, 60_000).then((result) => {
      const entry = state.get(agent.agentId);
      entry.startResult = result;
      entry.startedMs = at();
      if (result?.pid) {
        entry.pid = result.pid;
        startedPids.push(result.pid);
      }
      return result;
    }).catch((error) => ({ success: false, error: String(error) }))));
    console.log(`[restored-smoke] start responses: ${startResults.map((r) => (r?.success ? `pid ${r.pid}` : `FAIL ${r?.error}`)).join(', ')}`);

    const deadline = Date.now() + options.timeoutSec * 1000;
    let lastReport = 0;
    while (Date.now() < deadline) {
      const all = [...state.values()];
      if (all.every((agent) => agent.readyMs !== null || agent.exit)) break;
      if (Date.now() - lastReport >= 10_000) {
        lastReport = Date.now();
        const readyCount = all.filter((agent) => agent.readyMs !== null).length;
        const outputCount = all.filter((agent) => agent.firstOutputMs !== null).length;
        console.log(`[restored-smoke] t=${at()}ms ready=${readyCount}/${all.length} withOutput=${outputCount}/${all.length}`);
      }
      await delay(250);
    }

    if (options.prompt) {
      await Promise.all([...state.values()].filter((agent) => agent.readyMs !== null).map(async (agent) => {
        const marker = `RESTORED_SMOKE_${RUN_ID}_${agent.agentId.replace(/\W/g, '_').toUpperCase()}`;
        agent.promptMarker = marker;
        const result = await request({
          type: 'submit-prompt',
          officeId: OFFICE_ID,
          agentId: agent.agentId,
          prompt: `Reply with exactly ${marker} and nothing else. Do not use tools.`,
        }, 60_000).catch((error) => ({ success: false, error: String(error) }));
        agent.promptResult = result;
        const promptDeadline = Date.now() + 150_000;
        while (Date.now() < promptDeadline) {
          if (agent.assistant.some((text) => text.includes(marker)) && stripAnsi(agent.output).includes(marker)) {
            agent.promptRendered = true;
            return;
          }
          await delay(250);
        }
        agent.promptRendered = false;
      }));
    }

    const sessionIdSet = new Set(agents.map((agent) => agent.sessionId));
    const outcomes = extensionOutcomes(sessionIdSet, runStartedAt);
    const summary = [...state.values()].map((agent) => {
      const cliLog = agent.pid ? newestLogFor(agent.pid, runStartedAt) : undefined;
      let cliLogTail;
      if (cliLog && agent.readyMs === null) {
        cliLogTail = fs.readFileSync(cliLog, 'utf8').split(/\r?\n/).slice(-6).map((line) => line.slice(0, 220));
      }
      return {
        agentId: agent.agentId,
        kind: agent.kind,
        sourceSession: agent.sourceId?.slice(0, 8),
        pid: agent.pid,
        startedMs: agent.startedMs,
        firstOutputMs: agent.firstOutputMs,
        outputBytes: agent.bytes,
        consentApprovedMs: agent.consentApprovedMs,
        readyMs: agent.readyMs,
        exit: agent.exit,
        promptRendered: agent.promptRendered,
        extensions: outcomes
          .filter((outcome) => outcome.sessionId === agent.sessionId)
          .map((outcome) => `${outcome.extension}: ${outcome.markers.join(' | ') || '(running)'}`),
        ...(agent.readyMs === null
          ? { screenTail: stripAnsi(agent.output).replace(/\s+/g, ' ').slice(-600), cliLogTail }
          : {}),
      };
    });

    const relevant = serverLines.filter((line) => /NativeBridge|lifecycle|READY|bridge|error|Error/i.test(line));
    if (options.dumpDir) {
      // Raw PTY bytes per agent (outside the repo) for offline screen rendering.
      await fsp.mkdir(options.dumpDir, { recursive: true });
      for (const agent of state.values()) {
        await fsp.writeFile(path.join(options.dumpDir, `${agent.agentId}.raw`), agent.output, 'utf8');
      }
      await fsp.writeFile(path.join(options.dumpDir, 'server.log'), serverLines.join('\n'), 'utf8');
    }
    console.log('[restored-smoke] relevant server lines (last 60):');
    for (const line of relevant.slice(-60)) console.log(`  ${line.slice(0, 260)}`);
    const ok = summary.every((agent) => agent.readyMs !== null && (!options.prompt || agent.promptRendered));
    console.log(JSON.stringify({ ok, officeId: OFFICE_ID, cwd: options.cwd, agents: summary }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    if (server && server.connected) {
      for (const agent of agents) {
        await new Promise((resolve) => {
          const requestId = crypto.randomUUID();
          server.send({ type: 'kill', officeId: OFFICE_ID, agentId: agent.agentId, requestId }, () => resolve());
        });
      }
      await delay(1500);
      server.send({ type: 'shutdown' });
      await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(10_000)]);
    }
    if (server) killTree(server.pid);
    for (const pid of startedPids) killTree(pid);
    await delay(500);
    const survivors = startedPids.filter(processAlive);
    if (survivors.length > 0) console.error(`[restored-smoke] native TUIs survived cleanup: ${survivors.join(', ')}`);
    for (const sessionId of createdSessionIds) {
      if (!UUID_RE.test(sessionId) || preexistingSessions.has(sessionId)) continue;
      await fsp.rm(path.join(SESSION_STATE_ROOT, sessionId), { recursive: true, force: true }).catch(() => undefined);
    }
    await fsp.rm(TEMP_ROOT, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`[restored-smoke] ${error.stack || error}`);
  process.exitCode = 1;
});
