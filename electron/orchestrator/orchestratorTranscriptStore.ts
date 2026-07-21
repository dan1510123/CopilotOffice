// Persisted orchestrator transcript store (spec 017 — US1, T009).
//
// Owns the durable, retention-bounded orchestrator transcript. Mirrors the
// established persistence-port pattern (electron/teams/onlineAgentsStore.ts
// `FileTeamsOnlineStore` / src/office/officePersistence.ts): pure
// serialize/deserialize + a file-backed prod impl + an in-memory test impl.
// Node-only (fs/path) so it is unit-testable in isolation. NEVER persists secrets.
//
// See contracts/transcript-store.md for the behavior contract.

import * as fs from 'fs';
import * as path from 'path';
import type { OrchestratorTranscript, TranscriptTurn } from './types';

/** Persistence port for the orchestrator transcript. */
export interface OrchestratorTranscriptStore {
  /** Load the persisted transcript, or null if none / unreadable. */
  load(): OrchestratorTranscript | null;
  /** Persist the given transcript record (full-record write). */
  save(transcript: OrchestratorTranscript): void;
  /** Clear the active record (used on user-close so the next open starts clean). */
  clearActive(): void;
}

const STORE_VERSION = 1;

/** Pretty-serialize a transcript record to JSON (versioned). */
export function serializeTranscript(t: OrchestratorTranscript): string {
  return JSON.stringify(
    {
      version: STORE_VERSION,
      sessionId: t.sessionId,
      lifecycle: t.lifecycle,
      turns: t.turns,
      updatedAt: t.updatedAt,
    },
    null,
    2,
  );
}

function isTranscriptTurn(v: unknown): v is TranscriptTurn {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.seq === 'number' &&
    typeof t.role === 'string' &&
    typeof t.origin === 'string' &&
    typeof t.text === 'string' &&
    typeof t.at === 'number'
  );
}

/**
 * Parse a persisted transcript. Tolerant of malformed/null input: returns `null`
 * (never throws), matching deserializeOffices. A corrupt file starts fresh.
 */
export function deserializeTranscript(json: string | null): OrchestratorTranscript | null {
  if (json === null || json === undefined) return null;
  try {
    const parsed = JSON.parse(json) as Partial<OrchestratorTranscript> & { version?: number };
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.sessionId !== 'string') return null;
    if (parsed.lifecycle !== 'active' && parsed.lifecycle !== 'closed') return null;
    const rawTurns = Array.isArray(parsed.turns) ? parsed.turns : [];
    const turns = rawTurns.filter(isTranscriptTurn);
    return {
      sessionId: parsed.sessionId,
      lifecycle: parsed.lifecycle,
      turns,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Append a turn and trim oldest-first to the bounded window. Pure — returns a new
 * record; `seq` is assigned monotonically from the last existing turn (FR-006).
 */
export function appendTurn(
  t: OrchestratorTranscript,
  turn: Omit<TranscriptTurn, 'seq'>,
  bound: number,
): OrchestratorTranscript {
  const nextSeq = t.turns.length ? t.turns[t.turns.length - 1].seq + 1 : 0;
  const appended: TranscriptTurn = { ...turn, seq: nextSeq };
  let turns = [...t.turns, appended];
  if (bound > 0 && turns.length > bound) {
    turns = turns.slice(turns.length - bound); // trim oldest-first
  }
  return { ...t, turns, updatedAt: appended.at };
}

/** File-backed store at `.data/orchestrator-transcript.json`. */
export class FileOrchestratorTranscriptStore implements OrchestratorTranscriptStore {
  constructor(private readonly filePath: string) {}

  static defaultPath(dataDir: string): string {
    return path.join(dataDir, 'orchestrator-transcript.json');
  }

  load(): OrchestratorTranscript | null {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return deserializeTranscript(raw);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      // FR-025: log IO errors through the established channel; never crash.
      console.error('[Orchestrator] Failed to load transcript — starting fresh:', e);
      return null;
    }
  }

  save(transcript: OrchestratorTranscript): void {
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, serializeTranscript(transcript), 'utf-8');
    } catch (e: unknown) {
      // A failed save MUST NOT block turn processing (FR-025).
      console.error('[Orchestrator] Failed to save transcript:', e);
    }
  }

  clearActive(): void {
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch (e: unknown) {
      console.error('[Orchestrator] Failed to clear transcript:', e);
    }
  }
}

/** In-memory store for tests. */
export class InMemoryOrchestratorTranscriptStore implements OrchestratorTranscriptStore {
  private record: OrchestratorTranscript | null;
  constructor(initial?: OrchestratorTranscript | null) {
    this.record = initial ?? null;
  }
  load(): OrchestratorTranscript | null {
    return this.record ? JSON.parse(JSON.stringify(this.record)) : null;
  }
  save(transcript: OrchestratorTranscript): void {
    this.record = JSON.parse(JSON.stringify(transcript));
  }
  clearActive(): void {
    this.record = null;
  }
}
