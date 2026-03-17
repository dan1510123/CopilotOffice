import { CopilotEvent, EventCallback, EventsWatcher } from './events-watcher';

export interface CopilotEventSource {
  start(onEvent: EventCallback): void;
  stop(): void;
  getSessionId(): string;
}

export interface CopilotEventSourceFactory {
  create(sessionId: string): CopilotEventSource;
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
