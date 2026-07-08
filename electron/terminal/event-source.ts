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
