// T009 — Persisted store for online-agent bindings + known-thread ids.
//
// Mirrors the OfficePersistencePort pattern: a port interface with a file-backed prod impl
// and an in-memory impl for tests. NEVER persists tokens (secrets stay in memory only).

import * as fs from 'fs';
import * as path from 'path';
import type { TeamsStoreState, OnlineAgentBinding } from './types';
import { terror } from './log';

/** Persistence port. */
export interface TeamsOnlineStore {
  load(): Promise<TeamsStoreState>;
  save(state: TeamsStoreState): Promise<void>;
}

const STORE_VERSION = 1;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function emptyState(): TeamsStoreState {
  return { bindings: [], knownThreads: [] };
}

/**
 * Drop bindings whose `lastConnected` is older than `maxAgeMs` (default 30 days).
 * Pure — returns the kept + removed partitions so callers can toast a summary.
 */
export function gcStale(
  bindings: OnlineAgentBinding[],
  nowMs: number,
  maxAgeMs: number = THIRTY_DAYS_MS,
): { kept: OnlineAgentBinding[]; removed: OnlineAgentBinding[] } {
  const kept: OnlineAgentBinding[] = [];
  const removed: OnlineAgentBinding[] = [];
  for (const b of bindings) {
    if (nowMs - (b.lastConnected || 0) > maxAgeMs) removed.push(b);
    else kept.push(b);
  }
  return { kept, removed };
}

/** File-backed store at `.data/teams-online-agents.json`. */
export class FileTeamsOnlineStore implements TeamsOnlineStore {
  constructor(private readonly filePath: string) {}

  static defaultPath(dataDir: string): string {
    return path.join(dataDir, 'teams-online-agents.json');
  }

  async load(): Promise<TeamsStoreState> {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<TeamsStoreState> & { version?: number };
      return {
        bindings: Array.isArray(parsed.bindings) ? parsed.bindings : [],
        knownThreads: Array.isArray(parsed.knownThreads) ? parsed.knownThreads : [],
      };
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return emptyState();
      terror('Failed to load online store — starting empty:', e);
      return emptyState();
    }
  }

  async save(state: TeamsStoreState): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const payload = JSON.stringify(
      { version: STORE_VERSION, bindings: state.bindings, knownThreads: state.knownThreads },
      null,
      2,
    );
    await fs.promises.writeFile(this.filePath, payload, 'utf-8');
  }
}

/** In-memory store for tests. */
export class InMemoryTeamsOnlineStore implements TeamsOnlineStore {
  private state: TeamsStoreState;
  constructor(initial?: TeamsStoreState) {
    this.state = initial ?? emptyState();
  }
  async load(): Promise<TeamsStoreState> {
    return JSON.parse(JSON.stringify(this.state));
  }
  async save(state: TeamsStoreState): Promise<void> {
    this.state = JSON.parse(JSON.stringify(state));
  }
}
