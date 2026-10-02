import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

export const NATIVE_BRIDGE_ENV = {
  enabled: 'COPILOT_OFFICE_BRIDGE_ENABLED',
  endpoint: 'COPILOT_OFFICE_BRIDGE_ENDPOINT',
  terminalKey: 'COPILOT_OFFICE_BRIDGE_TERMINAL_KEY',
  // Avoid names such as TOKEN/SECRET/KEY: the CLI deliberately strips common
  // credential-shaped environment variables from extension subprocesses.
  nonce: 'COPILOT_OFFICE_BRIDGE_NONCE',
} as const;

const NATIVE_BRIDGE_ENV_PREFIX = 'COPILOT_OFFICE_BRIDGE_';

/** True for any bridge credential variable name (case-insensitive, as on Windows). */
export function isNativeBridgeEnvName(name: string): boolean {
  return name.toUpperCase().startsWith(NATIVE_BRIDGE_ENV_PREFIX);
}

/**
 * Copy an environment without any bridge credentials. Credentials are minted
 * per TUI and must only ever reach that TUI's child env — never be inherited by
 * unrelated children (shells, headless hosts, pop-outs) from a parent process.
 */
export function withoutNativeBridgeEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === 'string' && !isNativeBridgeEnvName(name)) result[name] = value;
  }
  return result;
}

export const DEFAULT_BRIDGE_MAX_MESSAGE_BYTES = 256 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface NativeBridgeCredentials {
  endpoint: string;
  terminalKey: string;
  token: string;
  env: Record<string, string>;
}

export interface NativeBridgeConnection {
  terminalKey: string;
  sessionId: string;
  generation: number;
}

export interface NativeBridgeSessionChange extends NativeBridgeConnection {
  previousSessionId?: string;
}

export interface NativeBridgeBrokerOptions {
  endpoint?: string;
  homeDir?: string;
  maxMessageBytes?: number;
  requestTimeoutMs?: number;
}

interface CredentialRecord {
  token: string;
  lastSessionId?: string;
  /**
   * PID of the native TUI process these credentials were minted for. When set,
   * only an extension claiming that direct parent may register. This is
   * defense-in-depth; the primary boundary is the random token plus the CLI's
   * `--secret-env-vars`, which strips bridge credentials from shell/MCP tools.
   */
  expectedParentPid?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface RegisteredConnection extends NativeBridgeConnection {
  socket: net.Socket;
  pending: Map<string, PendingRequest>;
  ready: boolean;
}

interface SocketState {
  buffer: Buffer;
  registration?: RegisteredConnection;
}

interface ConnectionWaiter {
  resolve: (connection: NativeBridgeConnection) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

type EventListener = (event: unknown, connection: NativeBridgeConnection) => void;
type SessionChangeListener = (change: NativeBridgeSessionChange) => void;

type ClientMessage =
  | {
      type: 'register';
      terminalKey: string;
      token: string;
      sessionId: string;
      parentPid?: number;
    }
  | {
      type: 'response';
      id: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }
  | {
      type: 'event';
      event: unknown;
    }
  | {
      type: 'ready';
      sessionId: string;
    };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function secureTokenEquals(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function validateIdentifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new Error(`Invalid bridge ${name}`);
  }
  return value;
}

export function createNativeBridgeEndpoint(
  platform = process.platform,
  homeDir = os.homedir(),
): string {
  const suffix = `${process.pid}-${randomBytes(12).toString('hex')}`;
  if (platform === 'win32') {
    return `\\\\.\\pipe\\copilot-office-${suffix}`;
  }
  return path.join(homeDir, '.copilot', 'run', `office-${suffix}.sock`);
}

/**
 * Local authenticated command/event broker owned by the terminal server.
 *
 * Each terminal launch gets a fresh token. A reconnect may reuse that token,
 * while allocating new credentials invalidates and destroys the previous TUI.
 */
export class NativeBridgeBroker {
  readonly endpoint: string;

  private readonly server: net.Server;
  private readonly maxMessageBytes: number;
  private readonly requestTimeoutMs: number;
  private readonly credentials = new Map<string, CredentialRecord>();
  private readonly registrations = new Map<string, RegisteredConnection>();
  private readonly sockets = new Set<net.Socket>();
  private readonly waiters = new Map<string, Set<ConnectionWaiter>>();
  private readonly eventListeners = new Map<string, Set<EventListener>>();
  private readonly sessionChangeListeners = new Set<SessionChangeListener>();
  private nextGeneration = 1;
  private closed = false;

  private constructor(endpoint: string, options: NativeBridgeBrokerOptions) {
    this.endpoint = endpoint;
    this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_BRIDGE_MAX_MESSAGE_BYTES;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.maxMessageBytes) || this.maxMessageBytes < 1024) {
      throw new Error('Bridge maxMessageBytes must be an integer of at least 1024');
    }
    this.server = net.createServer((socket) => this.acceptSocket(socket));
  }

  static async create(options: NativeBridgeBrokerOptions = {}): Promise<NativeBridgeBroker> {
    const endpoint = options.endpoint ?? createNativeBridgeEndpoint(process.platform, options.homeDir);
    const broker = new NativeBridgeBroker(endpoint, options);
    if (process.platform !== 'win32') {
      await fs.mkdir(path.dirname(endpoint), { recursive: true, mode: 0o700 });
      await fs.rm(endpoint, { force: true });
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          broker.server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          broker.server.off('error', onError);
          resolve();
        };
        broker.server.once('error', onError);
        broker.server.once('listening', onListening);
        broker.server.listen(endpoint);
      });
      if (process.platform !== 'win32') {
        await fs.chmod(endpoint, 0o600);
      }
      return broker;
    } catch (error) {
      await broker.close().catch(() => undefined);
      throw new Error(`Failed to start native bridge at ${endpoint}: ${asError(error).message}`);
    }
  }

  allocateCredentials(terminalKey: string): NativeBridgeCredentials {
    this.assertOpen();
    validateIdentifier(terminalKey, 'terminal key');
    const token = randomBytes(32).toString('base64url');
    const lastSessionId = this.registrations.get(terminalKey)?.sessionId
      ?? this.credentials.get(terminalKey)?.lastSessionId;
    this.credentials.set(terminalKey, { token, lastSessionId });
    this.destroyRegistration(
      terminalKey,
      new Error(`Native bridge credentials replaced for ${terminalKey}`),
    );
    return {
      endpoint: this.endpoint,
      terminalKey,
      token,
      env: {
        [NATIVE_BRIDGE_ENV.enabled]: '1',
        [NATIVE_BRIDGE_ENV.endpoint]: this.endpoint,
        [NATIVE_BRIDGE_ENV.terminalKey]: terminalKey,
        [NATIVE_BRIDGE_ENV.nonce]: token,
      },
    };
  }

  /**
   * Bind credentials to the native TUI process they were minted for. Must be
   * called synchronously after spawning that process (before its extension can
   * connect); registrations whose `parentPid` differs are then rejected.
   */
  bindProcess(terminalKey: string, pid: number): void {
    this.assertOpen();
    validateIdentifier(terminalKey, 'terminal key');
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error(`Invalid native bridge process id for ${terminalKey}`);
    }
    const credential = this.credentials.get(terminalKey);
    if (!credential) {
      throw new Error(`Native bridge credentials are not allocated: ${terminalKey}`);
    }
    credential.expectedParentPid = pid;
  }

  waitForConnection(terminalKey: string, timeoutMs = this.requestTimeoutMs): Promise<NativeBridgeConnection> {
    this.assertOpen();
    validateIdentifier(terminalKey, 'terminal key');
    const current = this.registrations.get(terminalKey);
    if (current?.ready) return Promise.resolve(this.connectionSnapshot(current));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const entries = this.waiters.get(terminalKey);
        entries?.delete(waiter);
        if (entries?.size === 0) this.waiters.delete(terminalKey);
        reject(new Error(`Timed out waiting for native bridge connection: ${terminalKey}`));
      }, timeoutMs);
      const waiter: ConnectionWaiter = { resolve, reject, timer };
      let entries = this.waiters.get(terminalKey);
      if (!entries) {
        entries = new Set();
        this.waiters.set(terminalKey, entries);
      }
      entries.add(waiter);
    });
  }

  request(
    terminalKey: string,
    command: string,
    params?: unknown,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<unknown> {
    this.assertOpen();
    validateIdentifier(terminalKey, 'terminal key');
    validateIdentifier(command, 'command');
    const registration = this.registrations.get(terminalKey);
    if (!registration?.ready) {
      return Promise.reject(new Error(`Native bridge is not connected: ${terminalKey}`));
    }

    const id = randomUUID();
    let payload: string;
    try {
      payload = `${JSON.stringify({ type: 'request', id, command, params })}\n`;
    } catch (error) {
      return Promise.reject(new Error(`Native bridge request is not serializable: ${asError(error).message}`));
    }
    if (Buffer.byteLength(payload) > this.maxMessageBytes) {
      return Promise.reject(new Error('Native bridge request exceeds maximum message size'));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        registration.pending.delete(id);
        reject(new Error(`Native bridge request timed out: ${command}`));
      }, timeoutMs);
      registration.pending.set(id, { resolve, reject, timer });
      registration.socket.write(payload, (error) => {
        if (!error) return;
        const pending = registration.pending.get(id);
        if (!pending) return;
        registration.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(new Error(`Failed to write native bridge request: ${error.message}`));
      });
    });
  }

  subscribe(terminalKey: string, listener: EventListener): () => void {
    this.assertOpen();
    validateIdentifier(terminalKey, 'terminal key');
    let listeners = this.eventListeners.get(terminalKey);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(terminalKey, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.eventListeners.delete(terminalKey);
    };
  }

  onSessionChange(listener: SessionChangeListener): () => void {
    this.assertOpen();
    this.sessionChangeListeners.add(listener);
    return () => this.sessionChangeListeners.delete(listener);
  }

  /**
   * Revoke a terminal's credentials and drop its connection. When `token` is
   * supplied, the call is a no-op unless it still matches the live credentials,
   * so a late cleanup from an earlier launch can never revoke a newer one.
   */
  unregister(terminalKey: string, token?: string): void {
    validateIdentifier(terminalKey, 'terminal key');
    if (token !== undefined) {
      const credential = this.credentials.get(terminalKey);
      if (!credential || !secureTokenEquals(credential.token, token)) return;
    }
    this.credentials.delete(terminalKey);
    this.destroyRegistration(terminalKey, new Error(`Native bridge unregistered: ${terminalKey}`));
    this.eventListeners.delete(terminalKey);
    this.rejectWaiters(terminalKey, new Error(`Native bridge unregistered: ${terminalKey}`));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    for (const terminalKey of [...this.registrations.keys()]) {
      this.destroyRegistration(terminalKey, new Error('Native bridge closed'));
    }
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    for (const terminalKey of [...this.waiters.keys()]) {
      this.rejectWaiters(terminalKey, new Error('Native bridge closed'));
    }
    this.credentials.clear();
    this.eventListeners.clear();
    this.sessionChangeListeners.clear();

    await new Promise<void>((resolve, reject) => {
      if (!this.server.listening) {
        resolve();
        return;
      }
      this.server.close((error) => error ? reject(error) : resolve());
    });
    if (process.platform !== 'win32') {
      await fs.rm(this.endpoint, { force: true });
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Native bridge broker is closed');
  }

  private acceptSocket(socket: net.Socket): void {
    if (this.closed) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    const state: SocketState = { buffer: Buffer.alloc(0) };
    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => this.handleData(socket, state, chunk));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      this.sockets.delete(socket);
      const registration = state.registration;
      if (registration && this.registrations.get(registration.terminalKey) === registration) {
        this.registrations.delete(registration.terminalKey);
        this.rejectPending(registration, new Error('Native bridge connection closed'));
      }
    });
  }

  private handleData(socket: net.Socket, state: SocketState, chunk: Buffer): void {
    if (socket.destroyed) return;
    state.buffer = Buffer.concat([state.buffer, chunk]);
    while (true) {
      const newlineIndex = state.buffer.indexOf(0x0a);
      if (newlineIndex === -1) break;
      if (newlineIndex > this.maxMessageBytes) {
        socket.destroy(new Error('Native bridge message exceeds maximum size'));
        return;
      }
      const line = state.buffer.subarray(0, newlineIndex);
      state.buffer = state.buffer.subarray(newlineIndex + 1);
      if (line.length === 0) continue;
      try {
        const parsed = JSON.parse(line.toString('utf8')) as unknown;
        this.handleMessage(socket, state, parsed);
      } catch {
        socket.destroy(new Error('Invalid native bridge JSON message'));
        return;
      }
    }
    if (state.buffer.length > this.maxMessageBytes) {
      socket.destroy(new Error('Native bridge message exceeds maximum size'));
    }
  }

  private handleMessage(socket: net.Socket, state: SocketState, value: unknown): void {
    if (!value || typeof value !== 'object' || !('type' in value)) {
      throw new Error('Invalid native bridge message');
    }
    const message = value as ClientMessage;
    if (!state.registration) {
      if (message.type !== 'register') {
        throw new Error('Native bridge socket must register first');
      }
      this.registerSocket(socket, state, message);
      return;
    }

    const registration = state.registration;
    if (this.registrations.get(registration.terminalKey) !== registration) {
      socket.destroy(new Error('Stale native bridge socket'));
      return;
    }
    if (message.type === 'response') {
      if (!registration.ready) throw new Error('Native bridge session is not ready');
      this.handleResponse(registration, message);
      return;
    }
    if (message.type === 'event') {
      if (!registration.ready) throw new Error('Native bridge session is not ready');
      for (const listener of this.eventListeners.get(registration.terminalKey) ?? []) {
        try {
          listener(message.event, this.connectionSnapshot(registration));
        } catch {
          // Listener failures must not break the transport.
        }
      }
      return;
    }
    if (message.type === 'ready') {
      this.markReady(registration, message.sessionId);
      return;
    }
    throw new Error('Native bridge socket is already registered');
  }

  private registerSocket(
    socket: net.Socket,
    state: SocketState,
    message: Extract<ClientMessage, { type: 'register' }>,
  ): void {
    const terminalKey = validateIdentifier(message.terminalKey, 'terminal key');
    const sessionId = validateIdentifier(message.sessionId, 'session ID');
    const token = validateIdentifier(message.token, 'token');
    const credential = this.credentials.get(terminalKey);
    if (
      !credential
      || !secureTokenEquals(credential.token, token)
      || (credential.expectedParentPid !== undefined && message.parentPid !== credential.expectedParentPid)
    ) {
      socket.write(`${JSON.stringify({ type: 'registration-error', error: 'authentication failed' })}\n`);
      socket.end();
      return;
    }

    const previous = this.registrations.get(terminalKey);
    const registration: RegisteredConnection = {
      terminalKey,
      sessionId,
      generation: this.nextGeneration++,
      socket,
      pending: new Map(),
      ready: false,
    };
    state.registration = registration;
    this.registrations.set(terminalKey, registration);
    if (previous) {
      this.rejectPending(previous, new Error('Native bridge connection replaced'));
      // Tell the superseded extension instance to stand down instead of
      // reconnecting and re-registering its stale session over the new one.
      const previousSocket = previous.socket;
      previousSocket.end(`${JSON.stringify({ type: 'replaced' })}\n`);
      setTimeout(() => previousSocket.destroy(), 1_000).unref();
    }

    socket.write(`${JSON.stringify({
      type: 'registered',
      terminalKey,
      sessionId,
      generation: registration.generation,
    })}\n`);
  }

  private markReady(registration: RegisteredConnection, reportedSessionId: unknown): void {
    if (this.registrations.get(registration.terminalKey) !== registration) {
      registration.socket.destroy(new Error('Stale native bridge socket'));
      return;
    }
    const sessionId = validateIdentifier(reportedSessionId, 'session ID');
    const credential = this.credentials.get(registration.terminalKey);
    if (!credential) {
      registration.socket.destroy(new Error('Native bridge credentials are no longer valid'));
      return;
    }
    const previousSessionId = credential.lastSessionId;
    registration.sessionId = sessionId;
    registration.ready = true;
    credential.lastSessionId = sessionId;
    registration.socket.write(`${JSON.stringify({
      type: 'ready-ack',
      terminalKey: registration.terminalKey,
      sessionId,
      generation: registration.generation,
    })}\n`);
    this.resolveWaiters(registration.terminalKey, registration);
    const change: NativeBridgeSessionChange = {
      ...this.connectionSnapshot(registration),
      ...(previousSessionId ? { previousSessionId } : {}),
    };
    for (const listener of this.sessionChangeListeners) {
      try {
        listener(change);
      } catch {
        // Listener failures must not break the transport.
      }
    }
  }

  private handleResponse(
    registration: RegisteredConnection,
    message: Extract<ClientMessage, { type: 'response' }>,
  ): void {
    if (typeof message.id !== 'string') return;
    const pending = registration.pending.get(message.id);
    if (!pending) return;
    registration.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(
        typeof message.error === 'string' && message.error.length > 0
          ? message.error
          : 'Native bridge command failed',
      ));
    }
  }

  private connectionSnapshot(registration: RegisteredConnection): NativeBridgeConnection {
    return {
      terminalKey: registration.terminalKey,
      sessionId: registration.sessionId,
      generation: registration.generation,
    };
  }

  private destroyRegistration(terminalKey: string, error: Error): void {
    const registration = this.registrations.get(terminalKey);
    if (!registration) return;
    this.registrations.delete(terminalKey);
    this.rejectPending(registration, error);
    registration.socket.destroy();
  }

  private rejectPending(registration: RegisteredConnection, error: Error): void {
    for (const pending of registration.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    registration.pending.clear();
  }

  private resolveWaiters(terminalKey: string, registration: RegisteredConnection): void {
    const waiters = this.waiters.get(terminalKey);
    if (!waiters) return;
    this.waiters.delete(terminalKey);
    const snapshot = this.connectionSnapshot(registration);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(snapshot);
    }
  }

  private rejectWaiters(terminalKey: string, error: Error): void {
    const waiters = this.waiters.get(terminalKey);
    if (!waiters) return;
    this.waiters.delete(terminalKey);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}
