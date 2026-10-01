import * as net from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NativeBridgeBroker,
  isNativeBridgeEnvName,
  withoutNativeBridgeEnv,
  type NativeBridgeCredentials,
} from '../../../electron/terminal/native-bridge-broker';

interface ServerRequest {
  type: 'request';
  id: string;
  command: string;
  params?: unknown;
}

class BridgeTestClient {
  readonly socket: net.Socket;
  readonly requests: ServerRequest[] = [];
  readonly frames: Array<{ type?: string }> = [];
  private buffer = Buffer.alloc(0);
  private registeredResolve!: () => void;
  private closedResolve!: () => void;
  readonly registered = new Promise<void>((resolve) => {
    this.registeredResolve = resolve;
  });
  readonly closed = new Promise<void>((resolve) => {
    this.closedResolve = resolve;
  });
  onRequest?: (request: ServerRequest) => void;
  private readonly sessionId: string;

  constructor(
    credentials: NativeBridgeCredentials,
    sessionId: string,
    token = credentials.token,
    parentPid?: number,
  ) {
    this.sessionId = sessionId;
    this.socket = net.createConnection(credentials.endpoint);
    this.socket.on('connect', () => {
      this.send({
        type: 'register',
        terminalKey: credentials.terminalKey,
        token,
        sessionId,
        ...(parentPid !== undefined ? { parentPid } : {}),
      });
    });
    this.socket.on('data', (chunk: Buffer) => this.handleData(chunk));
    this.socket.on('error', () => undefined);
    this.socket.on('close', () => this.closedResolve());
  }

  send(value: unknown): void {
    this.socket.write(`${JSON.stringify(value)}\n`);
  }

  respond(request: ServerRequest, result: unknown): void {
    this.send({ type: 'response', id: request.id, ok: true, result });
  }

  close(): void {
    this.socket.destroy();
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline === -1) return;
      const line = this.buffer.subarray(0, newline).toString('utf8');
      this.buffer = this.buffer.subarray(newline + 1);
      const message = JSON.parse(line) as { type?: string };
      this.frames.push(message);
      if (message.type === 'registered') {
        this.send({ type: 'ready', sessionId: this.sessionId });
      } else if (message.type === 'ready-ack') {
        this.registeredResolve();
      } else if (message.type === 'request') {
        const request = message as ServerRequest;
        this.requests.push(request);
        this.onRequest?.(request);
      }
    }
  }
}

const brokers: NativeBridgeBroker[] = [];
const clients: BridgeTestClient[] = [];

async function createBroker(): Promise<NativeBridgeBroker> {
  const broker = await NativeBridgeBroker.create({ requestTimeoutMs: 250 });
  brokers.push(broker);
  return broker;
}

function createClient(
  credentials: NativeBridgeCredentials,
  sessionId: string,
  token?: string,
  parentPid?: number,
): BridgeTestClient {
  const client = new BridgeTestClient(credentials, sessionId, token, parentPid);
  clients.push(client);
  return client;
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const broker of brokers.splice(0)) await broker.close();
});

describe('NativeBridgeBroker', () => {
  it('requires the per-terminal authentication token', async () => {
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:agent-a');
    const attacker = createClient(credentials, 'session-attacker', 'wrong-token');

    await attacker.closed;
    await expect(broker.waitForConnection(credentials.terminalKey, 25))
      .rejects.toThrow('Timed out waiting');
  });

  it('keeps registrations independent and routes requests to the selected terminal', async () => {
    const broker = await createBroker();
    const aCredentials = broker.allocateCredentials('office-a:agent-a');
    const bCredentials = broker.allocateCredentials('office-a:agent-b');
    const a = createClient(aCredentials, 'session-a');
    const b = createClient(bCredentials, 'session-b');
    a.onRequest = (request) => a.respond(request, { owner: 'a' });
    b.onRequest = (request) => b.respond(request, { owner: 'b' });

    await Promise.all([a.registered, b.registered]);
    await expect(broker.request(aCredentials.terminalKey, 'send', { prompt: 'one' }))
      .resolves.toEqual({ owner: 'a' });
    await expect(broker.request(bCredentials.terminalKey, 'send', { prompt: 'two' }))
      .resolves.toEqual({ owner: 'b' });
    expect(a.requests).toHaveLength(1);
    expect(b.requests).toHaveLength(1);
  });

  it('replaces stale sockets and never routes a request to the old generation', async () => {
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:agent-a');
    const stale = createClient(credentials, 'session-old');
    await stale.registered;

    const current = createClient(credentials, 'session-new');
    current.onRequest = (request) => current.respond(request, 'current');
    await current.registered;
    await stale.closed;

    await expect(broker.request(credentials.terminalKey, 'send', { prompt: 'hello' }))
      .resolves.toBe('current');
    expect(stale.requests).toHaveLength(0);
    expect(current.requests).toHaveLength(1);
  });

  it('correlates responses and rejects timed-out requests', async () => {
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:agent-a');
    const client = createClient(credentials, 'session-a');
    client.onRequest = (request) => {
      if (request.params === 'respond') client.respond(request, { requestId: request.id });
    };
    await client.registered;

    const result = await broker.request(credentials.terminalKey, 'send', 'respond');
    expect(result).toEqual({ requestId: client.requests[0].id });
    await expect(broker.request(credentials.terminalKey, 'send', 'ignore', 20))
      .rejects.toThrow('timed out');
  });

  it('publishes events only to subscribers for that terminal', async () => {
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:agent-a');
    const client = createClient(credentials, 'session-a');
    await client.registered;
    const listener = vi.fn();
    const unsubscribe = broker.subscribe(credentials.terminalKey, listener);

    client.send({ type: 'event', event: { type: 'session.idle' } });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(listener).toHaveBeenCalledWith(
      { type: 'session.idle' },
      expect.objectContaining({ sessionId: 'session-a' }),
    );

    unsubscribe();
    client.send({ type: 'event', event: { type: 'assistant.message' } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports reconnect session replacement and resolves new connection waiters', async () => {
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:agent-a');
    const changes = vi.fn();
    broker.onSessionChange(changes);

    const firstWait = broker.waitForConnection(credentials.terminalKey);
    const first = createClient(credentials, 'session-a');
    await expect(firstWait).resolves.toEqual(expect.objectContaining({ sessionId: 'session-a' }));
    first.close();
    await first.closed;

    const second = createClient(credentials, 'session-b');
    await second.registered;
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: 'session-b',
      previousSessionId: 'session-a',
    }));
    expect((await broker.waitForConnection(credentials.terminalKey)).sessionId).toBe('session-b');
  });

  it('unregisters and closes connections with pending work cleaned up', async () => {
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:agent-a');
    const client = createClient(credentials, 'session-a');
    await client.registered;
    const pending = broker.request(credentials.terminalKey, 'send', undefined, 5_000);

    broker.unregister(credentials.terminalKey);
    await expect(pending).rejects.toThrow('unregistered');
    await client.closed;
    await expect(broker.request(credentials.terminalKey, 'send'))
      .rejects.toThrow('not connected');

    await broker.close();
    expect(() => broker.allocateCredentials('another')).toThrow('closed');
  });

  it('only accepts registrations from the bound native TUI process', async () => {
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:agent-a');
    broker.bindProcess(credentials.terminalKey, 4242);

    const nested = createClient(credentials, 'session-nested', undefined, 4243);
    await nested.closed;
    expect(nested.frames).toEqual([{ type: 'registration-error', error: 'authentication failed' }]);
    const missingPid = createClient(credentials, 'session-missing');
    await missingPid.closed;
    expect(missingPid.frames).toEqual([{ type: 'registration-error', error: 'authentication failed' }]);

    const tui = createClient(credentials, 'session-a', undefined, 4242);
    await tui.registered;
    expect((await broker.waitForConnection(credentials.terminalKey)).sessionId).toBe('session-a');
    expect(() => broker.bindProcess('unknown-terminal', 1)).toThrow('not allocated');
    expect(() => broker.bindProcess(credentials.terminalKey, 0)).toThrow('Invalid native bridge process id');
  });

  it('tells a superseded registration to stand down before closing it', async () => {
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:agent-a');
    const stale = createClient(credentials, 'session-old');
    await stale.registered;

    const current = createClient(credentials, 'session-new');
    await current.registered;
    await stale.closed;

    expect(stale.frames.map((frame) => frame.type)).toEqual(['registered', 'ready-ack', 'replaced']);
    expect(current.frames.map((frame) => frame.type)).toEqual(['registered', 'ready-ack']);
  });

  it('ignores an unregister carrying a stale token', async () => {
    const broker = await createBroker();
    const credentials = broker.allocateCredentials('office-a:agent-a');
    const client = createClient(credentials, 'session-a');
    client.onRequest = (request) => client.respond(request, 'still-here');
    await client.registered;

    broker.unregister(credentials.terminalKey, 'not-the-current-token');
    await expect(broker.request(credentials.terminalKey, 'send')).resolves.toBe('still-here');

    broker.unregister(credentials.terminalKey, credentials.token);
    await client.closed;
    await expect(broker.request(credentials.terminalKey, 'send')).rejects.toThrow('not connected');
  });
});

describe('native bridge env helpers', () => {
  it('detects and strips bridge credentials case-insensitively', () => {
    expect(isNativeBridgeEnvName('COPILOT_OFFICE_BRIDGE_NONCE')).toBe(true);
    expect(isNativeBridgeEnvName('copilot_office_bridge_endpoint')).toBe(true);
    expect(isNativeBridgeEnvName('COPILOT_OFFICE_AGENT')).toBe(false);
    expect(withoutNativeBridgeEnv({
      COPILOT_OFFICE_BRIDGE_TERMINAL_KEY: 'k',
      Copilot_Office_Bridge_Nonce: 't',
      COPILOT_OFFICE_AGENT: 'generalist',
      UNSET: undefined,
    })).toEqual({ COPILOT_OFFICE_AGENT: 'generalist' });
  });
});
