import { randomUUID } from 'crypto';
import { CopilotEvent, EventCallback, EventsWatcher } from './events-watcher';

export interface CopilotEventSource {
  start(onEvent: EventCallback): void;
  stop(): void;
  getSessionId(): string;
}

export interface CopilotEventSourceFactory {
  create(sessionId: string): CopilotEventSource;
}

export interface SdkCopilotSession {
  on(handler: (evt: unknown) => void): () => void;
}

const EVENT_METADATA_KEYS = new Set(['type', 'id', 'timestamp', 'parentId']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getEventData(evt: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(evt.data)) {
    return { ...evt.data };
  }

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(evt)) {
    if (!EVENT_METADATA_KEYS.has(key)) {
      data[key] = value;
    }
  }
  return data;
}

export function mapSdkEventToCopilotEvent(evt: unknown): CopilotEvent {
  const eventRecord = isRecord(evt) ? evt : {};
  const type = typeof eventRecord.type === 'string' ? eventRecord.type : 'unknown';
  const id = typeof eventRecord.id === 'string' ? eventRecord.id : randomUUID();
  const timestamp = typeof eventRecord.timestamp === 'string'
    ? eventRecord.timestamp
    : new Date().toISOString();
  const parentId = typeof eventRecord.parentId === 'string' || eventRecord.parentId === null
    ? eventRecord.parentId
    : null;

  return {
    type,
    data: getEventData(eventRecord),
    id,
    timestamp,
    parentId,
  };
}

/**
 * Event source for SDK-backed Copilot sessions.
 *
 * TODO(T011): server wiring will construct this with the live SDK CopilotSession
 * when selecting the ui-server backend instead of the events.jsonl file watcher.
 */
export class SdkEventSource implements CopilotEventSource {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly session: SdkCopilotSession,
  ) {}

  start(onEvent: EventCallback): void {
    this.stop();
    this.unsubscribe = this.session.on((evt: unknown) => {
      onEvent(mapSdkEventToCopilotEvent(evt), false);
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }
}

/** Minimal broker surface the bridge event source needs (see native-bridge-broker.ts). */
export interface BridgeEventSubscriber {
  subscribe(
    terminalKey: string,
    listener: (event: unknown, connection: { sessionId: string }) => void,
  ): () => void;
}

/**
 * Event source for a native TUI driven through the SDK extension bridge.
 *
 * Events arrive from the extension's `session.on(...)` over the broker and are
 * normalized with {@link mapSdkEventToCopilotEvent}, so the server's watcher
 * callback (fleet-critical forwarding, Teams mirroring, ask_user/plan relays)
 * sees exactly the same `CopilotEvent` contract as the other backends. The
 * subscription is keyed by the TUI's terminal key rather than a session id, so
 * it keeps flowing when `/clear` replaces the session; `getSessionId()` tracks
 * the session of the latest delivered event.
 */
export class BrokerEventSource implements CopilotEventSource {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private sessionId: string,
    private readonly terminalKey: string,
    private readonly broker: BridgeEventSubscriber,
  ) {}

  start(onEvent: EventCallback): void {
    this.stop();
    try {
      this.unsubscribe = this.broker.subscribe(this.terminalKey, (evt, connection) => {
        if (connection?.sessionId) this.sessionId = connection.sessionId;
        onEvent(mapSdkEventToCopilotEvent(evt), false);
      });
    } catch (error) {
      // The broker only refuses subscriptions once it is closed (server shutdown).
      console.warn(`[BrokerEventSource] Cannot subscribe to ${this.terminalKey}: ${String((error as Error)?.message ?? error)}`);
    }
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }
}

class FileWatcherEventSource implements CopilotEventSource {
  private readonly watcher: EventsWatcher;

  constructor(sessionId: string) {
    this.watcher = new EventsWatcher(sessionId);
  }

  start(onEvent: EventCallback): void {
    this.watcher.start(onEvent);
  }

  stop(): void {
    this.watcher.stop();
  }

  getSessionId(): string {
    return this.watcher.getSessionId();
  }
}

export class FileWatcherEventSourceFactory implements CopilotEventSourceFactory {
  create(sessionId: string): CopilotEventSource {
    return new FileWatcherEventSource(sessionId);
  }
}

export type { CopilotEvent };
