import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeBridgeBroker } from '../../../electron/terminal/native-bridge-broker';
import {
  NATIVE_BRIDGE_EXTENSION_SOURCE,
  getNativeBridgeExtensionPath,
  materializeNativeBridgeExtension,
} from '../../../electron/terminal/native-bridge-extension';

const scratchDirectories: string[] = [];
const children: ChildProcess[] = [];
const brokers: NativeBridgeBroker[] = [];

afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
    child.kill();
  })));
  for (const broker of brokers.splice(0)) await broker.close();
  await Promise.all(scratchDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  ));
});

// Stand-in for the SDK the CLI injects into extension subprocesses. It records
// every joinSession/send so tests can prove the extension only joins sessions
// it is authorized to drive.
const STUB_SDK_SOURCE = String.raw`import { appendFileSync } from "node:fs";
function record(entry) {
  appendFileSync(process.env.STUB_LOG, JSON.stringify(entry) + "\n");
}
export async function joinSession(config) {
  record({
    type: "join",
    sessionId: process.env.SESSION_ID,
    handlers: [typeof config?.onUserInputRequest, typeof config?.onExitPlanModeRequest],
  });
  const listeners = new Set();
  return {
    sessionId: process.env.SESSION_ID,
    async send(request) {
      record({ type: "send", request });
      for (const listener of listeners) listener({ type: "user.message", data: { content: request.prompt } });
      return "message-1";
    },
    on(listener) {
      listeners.add(listener);
      if (process.env.STUB_SCENARIO === "local-user-input") {
        setTimeout(() => {
          void config.onUserInputRequest({ question: "Q1" });
          listener({ type: "user_input.requested", data: { requestId: "req-1" } });
          listener({ type: "user_input.completed", data: { requestId: "req-1" } });
          const second = config.onUserInputRequest({ question: "Q2" });
          listener({ type: "user_input.requested", data: { requestId: "req-2" } });
          second.then((answer) => record({ type: "user-answer", requestId: "req-2", answer }));
        }, 0);
      }
      if (process.env.STUB_SCENARIO === "oversized-event") {
        setTimeout(() => {
          listener({
            type: "assistant.message",
            id: "large-event",
            data: { content: "x".repeat(300 * 1024) },
          });
        }, 0);
      }
      if (process.env.STUB_SCENARIO === "local-plan") {
        setTimeout(() => {
          void config.onExitPlanModeRequest({ summary: "Plan 1" });
          listener({ type: "exit_plan_mode.requested", data: { requestId: "plan-1" } });
          listener({ type: "exit_plan_mode.completed", data: { requestId: "plan-1" } });
          const second = config.onExitPlanModeRequest({ summary: "Plan 2" });
          listener({ type: "exit_plan_mode.requested", data: { requestId: "plan-2" } });
          second.then((decision) => record({ type: "plan-decision", requestId: "plan-2", decision }));
        }, 0);
      }
      return () => listeners.delete(listener);
    },
    rpc: {
      usage: {
        async getMetrics() {
          return { totalPremiumRequestCost: 1, totalUserRequests: 2, totalApiDurationMs: 3 };
        },
      },
    },
  };
}
`;

interface ExtensionFixture {
  extensionPath: string;
  logPath: string;
}

async function writeExtensionFixture(): Promise<ExtensionFixture> {
  const directory = path.join(process.cwd(), 'tests', `.scratch-native-bridge-${randomUUID()}`);
  scratchDirectories.push(directory);
  await fs.mkdir(directory, { recursive: true });
  const extensionPath = path.join(directory, 'extension.mjs');
  await fs.writeFile(
    extensionPath,
    NATIVE_BRIDGE_EXTENSION_SOURCE.replace('"@github/copilot-sdk/extension"', '"./stub-sdk.mjs"'),
  );
  await fs.writeFile(path.join(directory, 'stub-sdk.mjs'), STUB_SDK_SOURCE);
  return { extensionPath, logPath: path.join(directory, 'stub.log') };
}

function runExtension(
  fixture: ExtensionFixture,
  extraEnv: Record<string, string>,
): { child: ChildProcess; exited: Promise<number | null> } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_OPTIONS;
  for (const name of Object.keys(env)) {
    if (name.toUpperCase().startsWith('COPILOT_OFFICE_BRIDGE_')) delete env[name];
  }
  const child = spawn(process.execPath, [fixture.extensionPath], {
    env: { ...env, STUB_LOG: fixture.logPath, ...extraEnv },
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  });
  children.push(child);
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  return { child, exited };
}

async function readStubLog(logPath: string): Promise<Array<{ type: string }>> {
  try {
    const raw = await fs.readFile(logPath, 'utf8');
    return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string });
  } catch {
    return [];
  }
}

async function createBroker(): Promise<NativeBridgeBroker> {
  const broker = await NativeBridgeBroker.create({ requestTimeoutMs: 10_000 });
  brokers.push(broker);
  return broker;
}

describe('native bridge extension materializer', () => {
  it('writes the bundled extension atomically and skips identical content', async () => {
    const homeDir = path.join(process.cwd(), 'tests', `.scratch-native-bridge-${randomUUID()}`);
    scratchDirectories.push(homeDir);
    const expectedPath = getNativeBridgeExtensionPath(homeDir);

    const first = await materializeNativeBridgeExtension({ homeDir });
    const firstStat = await fs.stat(expectedPath);
    const second = await materializeNativeBridgeExtension({ homeDir });
    const secondStat = await fs.stat(expectedPath);

    expect(first).toEqual({ changed: true, extensionPath: expectedPath });
    expect(second).toEqual({ changed: false, extensionPath: expectedPath });
    expect(await fs.readFile(expectedPath, 'utf8')).toBe(NATIVE_BRIDGE_EXTENSION_SOURCE);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
    expect((await fs.readdir(path.dirname(expectedPath))).sort()).toEqual(['extension.mjs']);
  });

  it('rewrites the extension when bundled content changes', async () => {
    const homeDir = path.join(process.cwd(), 'tests', `.scratch-native-bridge-${randomUUID()}`);
    scratchDirectories.push(homeDir);
    await materializeNativeBridgeExtension({ homeDir, source: 'old' });

    await expect(materializeNativeBridgeExtension({ homeDir, source: 'new' }))
      .resolves.toEqual({
        changed: true,
        extensionPath: getNativeBridgeExtensionPath(homeDir),
      });
    expect(await fs.readFile(getNativeBridgeExtensionPath(homeDir), 'utf8')).toBe('new');
  });

  it('contains the required native-session bridge behaviors', () => {
    expect(NATIVE_BRIDGE_EXTENSION_SOURCE).toContain(
      'import { joinSession } from "@github/copilot-sdk/extension"',
    );
    expect(NATIVE_BRIDGE_EXTENSION_SOURCE).toContain('mode: "enqueue"');
    expect(NATIVE_BRIDGE_EXTENSION_SOURCE).toContain('case "run-control"');
    expect(NATIVE_BRIDGE_EXTENSION_SOURCE).toContain('case "submit-answer"');
    expect(NATIVE_BRIDGE_EXTENSION_SOURCE).toContain('case "submit-plan-decision"');
    expect(NATIVE_BRIDGE_EXTENSION_SOURCE).not.toContain(
      'COPILOT_TEST_DISABLE_INTERRUPTED_SESSION_RESTORE',
    );
    expect(NATIVE_BRIDGE_EXTENSION_SOURCE).not.toContain('console.log');
  });
});

describe('bundled native bridge extension runtime', () => {
  it('exits cleanly without bridge credentials and never joins unrelated sessions', async () => {
    const fixture = await writeExtensionFixture();

    const { exited } = runExtension(fixture, { SESSION_ID: 'unrelated-user-session' });

    await expect(exited).resolves.toBe(0);
    expect(await readStubLog(fixture.logPath)).toEqual([]);
  });

  it('authenticates with its parent pid before joining, then serves prompts, control and events', async () => {
    const fixture = await writeExtensionFixture();
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:generalist#runtime');
    // The spawned extension's parent is this test process (the "native TUI").
    broker.bindProcess(credentials.terminalKey, process.pid);
    const events: unknown[] = [];
    broker.subscribe(credentials.terminalKey, (event) => events.push(event));

    runExtension(fixture, { ...credentials.env, SESSION_ID: 'session-native' });
    const connection = await broker.waitForConnection(credentials.terminalKey, 10_000);

    expect(connection.sessionId).toBe('session-native');
    await expect(broker.request(credentials.terminalKey, 'send', { prompt: 'hello' }))
      .resolves.toBe('message-1');
    await vi.waitFor(() => expect(events).toContainEqual({ type: 'user.message', data: { content: 'hello' } }));
    await expect(broker.request(credentials.terminalKey, 'run-control', { command: 'usage' }))
      .resolves.toEqual({ kind: 'usage', premiumRequestCost: 1, userRequests: 2, apiDurationMs: 3 });
    await expect(broker.request(credentials.terminalKey, 'submit-answer', { answer: 'Yes' }))
      .rejects.toThrow('No pending user-input request');
    expect(await readStubLog(fixture.logPath)).toEqual([
      { type: 'join', sessionId: 'session-native', handlers: ['function', 'function'] },
      { type: 'send', request: { prompt: 'hello', mode: 'enqueue' } },
    ]);
  }, 20_000);

  it('stands down without joining when a nested CLI presents inherited credentials', async () => {
    const fixture = await writeExtensionFixture();
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:generalist#nested');
    broker.bindProcess(credentials.terminalKey, process.pid + 1);
    const changes = vi.fn();
    broker.onSessionChange(changes);

    const { exited } = runExtension(fixture, { ...credentials.env, SESSION_ID: 'nested-session' });

    await expect(exited).resolves.toBe(0);
    expect(changes).not.toHaveBeenCalled();
    expect(await readStubLog(fixture.logPath)).toEqual([]);
  }, 20_000);

  it('lets a /clear replacement take over and retires the superseded instance', async () => {
    const fixture = await writeExtensionFixture();
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:generalist#clear');
    broker.bindProcess(credentials.terminalKey, process.pid);

    const first = runExtension(fixture, { ...credentials.env, SESSION_ID: 'session-before-clear' });
    await broker.waitForConnection(credentials.terminalKey, 10_000);
    const replaced = new Promise<void>((resolve) => {
      broker.onSessionChange((change) => {
        if (change.sessionId === 'session-after-clear') resolve();
      });
    });
    runExtension(fixture, { ...credentials.env, SESSION_ID: 'session-after-clear' });
    await replaced;

    await expect(first.exited).resolves.toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await broker.waitForConnection(credentials.terminalKey)).sessionId).toBe('session-after-clear');
  }, 20_000);

  it('clears locally-completed ask_user slots and rejects mismatched remote answers', async () => {
    const fixture = await writeExtensionFixture();
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:generalist#ask-user');
    broker.bindProcess(credentials.terminalKey, process.pid);
    const events: unknown[] = [];
    broker.subscribe(credentials.terminalKey, (event) => events.push(event));

    runExtension(fixture, {
      ...credentials.env,
      SESSION_ID: 'session-ask-user',
      STUB_SCENARIO: 'local-user-input',
    });
    await broker.waitForConnection(credentials.terminalKey, 10_000);
    await vi.waitFor(() => expect(events).toContainEqual({
      type: 'user_input.requested',
      data: { requestId: 'req-2' },
    }));

    await expect(broker.request(credentials.terminalKey, 'submit-answer', {
      requestId: 'req-1',
      answer: 'stale',
      wasFreeform: false,
    })).rejects.toThrow('does not match req-1');
    await expect(broker.request(credentials.terminalKey, 'submit-answer', {
      requestId: 'req-2',
      answer: 'current',
      wasFreeform: false,
    })).resolves.toEqual({ resolved: true });
    await vi.waitFor(async () => {
      expect(await readStubLog(fixture.logPath)).toContainEqual({
        type: 'user-answer',
        requestId: 'req-2',
        answer: { answer: 'current', wasFreeform: false },
      });
    });
  }, 20_000);

  it('truncates oversized SDK events without dropping the command connection', async () => {
    const fixture = await writeExtensionFixture();
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:generalist#large-event');
    broker.bindProcess(credentials.terminalKey, process.pid);
    const events: Array<{ type?: string; data?: Record<string, unknown> }> = [];
    broker.subscribe(credentials.terminalKey, (event) => {
      events.push(event as { type?: string; data?: Record<string, unknown> });
    });

    runExtension(fixture, {
      ...credentials.env,
      SESSION_ID: 'session-large-event',
      STUB_SCENARIO: 'oversized-event',
    });
    await broker.waitForConnection(credentials.terminalKey, 10_000);
    await vi.waitFor(() => expect(events.some((event) => event.type === 'assistant.message')).toBe(true));
    const largeEvent = events.find((event) => event.type === 'assistant.message');
    expect(largeEvent?.data?.bridgeTruncated).toBe(true);
    expect(String(largeEvent?.data?.content)).toContain('[bridge content truncated]');

    await expect(broker.request(credentials.terminalKey, 'send', { prompt: 'still connected' }))
      .resolves.toBe('message-1');
  }, 20_000);

  it('clears locally-completed plan slots and rejects mismatched remote decisions', async () => {
    const fixture = await writeExtensionFixture();
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:generalist#plan');
    broker.bindProcess(credentials.terminalKey, process.pid);
    const events: unknown[] = [];
    broker.subscribe(credentials.terminalKey, (event) => events.push(event));

    runExtension(fixture, {
      ...credentials.env,
      SESSION_ID: 'session-plan',
      STUB_SCENARIO: 'local-plan',
    });
    await broker.waitForConnection(credentials.terminalKey, 10_000);
    await vi.waitFor(() => expect(events).toContainEqual({
      type: 'exit_plan_mode.requested',
      data: { requestId: 'plan-2' },
    }));

    await expect(broker.request(credentials.terminalKey, 'submit-plan-decision', {
      requestId: 'plan-1',
      approved: true,
    })).rejects.toThrow('does not match plan-1');
    await expect(broker.request(credentials.terminalKey, 'submit-plan-decision', {
      requestId: 'plan-2',
      approved: false,
      feedback: 'revise',
    })).resolves.toEqual({ resolved: true });
    await vi.waitFor(async () => {
      expect(await readStubLog(fixture.logPath)).toContainEqual({
        type: 'plan-decision',
        requestId: 'plan-2',
        decision: { approved: false, feedback: 'revise' },
      });
    });
  }, 20_000);
});
