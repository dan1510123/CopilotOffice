// AutoStartCoordinator — single decision point for spec-009 auto-startup triggers.
// All three triggers (cold-launch, office-switch, post-New-Session) call into
// this module. See specs/009-auto-startup-known-agents/data-model.md §4.

import type { AgentAutoStartSettings } from '../config/agentAutoStart';

const WARMED_STORAGE_KEY = 'copilot-office-auto-start:warmed';

function readSessionStorage(): Storage | null {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch {
    /* ignore */
  }
  return null;
}

/** OfficeIds whose auto-startup has already run this app session.
 *  Source of truth for FR-008 / SC-007. Hydrated from sessionStorage on
 *  construction so renderer reloads do not re-warm an already-warmed office.
 *  Persisted with sessionStorage.setItem on mark. */
export class WarmedOfficeRegistry {
  private warmed: Set<string>;

  constructor() {
    const storage = readSessionStorage();
    let initial: string[] = [];
    if (storage) {
      try {
        const raw = storage.getItem(WARMED_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) initial = parsed.filter((s) => typeof s === 'string');
        }
      } catch {
        /* corrupt — start empty */
      }
    }
    this.warmed = new Set(initial);
  }

  has(officeId: string): boolean {
    return this.warmed.has(officeId);
  }

  mark(officeId: string): void {
    this.warmed.add(officeId);
    const storage = readSessionStorage();
    if (!storage) return;
    try {
      storage.setItem(WARMED_STORAGE_KEY, JSON.stringify(Array.from(this.warmed)));
    } catch {
      /* ignore */
    }
  }

  /** @internal — test helper. */
  snapshot(): string[] {
    return Array.from(this.warmed);
  }

  /** @internal — e2e helper for spec 009 A4 (Settings OFF gate). */
  clearAll(): void {
    this.warmed.clear();
    const storage = readSessionStorage();
    if (storage) {
      try {
        storage.removeItem(WARMED_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Per-agent in-flight "New Session" replacement promises.
 *  Source of truth for FR-014 / SC-005 / SC-008 coalescing. */
export class AgentReplaceTracker {
  private inFlight = new Map<string, Promise<ReplaceSessionResult>>();

  has(agentId: string): boolean {
    return this.inFlight.has(agentId);
  }

  get(agentId: string): Promise<ReplaceSessionResult> | undefined {
    return this.inFlight.get(agentId);
  }

  set(agentId: string, p: Promise<ReplaceSessionResult>): void {
    this.inFlight.set(agentId, p);
  }

  delete(agentId: string): void {
    this.inFlight.delete(agentId);
  }
}

/**
 * Result of {@link AutoStartCoordinator.replaceSession}. Carries the
 * freshly-minted session id that `resetSession` already returned, so callers
 * (New Session handlers) can update the session-id display WITHOUT a redundant
 * follow-up `getSessionId` round-trip (spec 021 session-action budget). `null`
 * when the reset dep could not surface an id (e.g. bridge unavailable).
 */
export interface ReplaceSessionResult {
  sessionId: string | null;
}

export interface AutoStartCoordinatorDeps {
  /** Returns the current office id, or null. */
  getCurrentOfficeId(): string | null;
  /** Returns the agent IDs configured for the given office (rosters +
   *  customAgents, EXCLUDING fleet sub-agents — FR-020). */
  getCanonicalAgentIds(officeId: string): string[];
  /** Returns the session-meta cache for the given office. Async so we can
   *  fetch fresh from the bridge (cachedSessionMeta in main.ts is hydrated
   *  by an unawaited fetchSessionMeta() that races our cold-launch trigger). */
  getSessionMeta(officeId: string): Promise<Record<string, { title: string }>>;
  /** Returns the persisted current[agentId] uuid, or null. Async to allow
   *  the renderer to delegate to `copilotBridge.getSessionId` without a new
   *  bridge surface (Principle V). */
  getCurrentSessionId(officeId: string, agentId: string): Promise<string | null>;
  /** Returns the agent's working dir + launch mode for terminalStart. */
  getAgentLaunchConfig(
    officeId: string,
    agentId: string,
  ): { workingDir: string; launchMode: 'copilot' | 'shell' };
  /** Per-agent close (reset) — wraps copilotBridge.resetSession. Returns the
   *  freshly-minted session id the server mints on reset (or null when
   *  unavailable) so `replaceSession` can surface it without an extra
   *  `getSessionId` round-trip. */
  resetSession(officeId: string, agentId: string): Promise<string | null>;
  /** Spawn (or reattach to) the PTY for the agent. Server-side dedup ensures
   *  no second PTY if one is already alive (R5 / FR-006). */
  warmAgentSession(officeId: string, agentId: string): Promise<void>;
  /** Settings getter (read at trigger time per FR-018). */
  getSettings(): AgentAutoStartSettings;
}

export class AutoStartCoordinator {
  private readonly deps: AutoStartCoordinatorDeps;
  /** @internal — exposed for testing. */
  readonly warmedOffices: WarmedOfficeRegistry;
  /** @internal — exposed for testing. */
  readonly replaceTracker: AgentReplaceTracker;

  constructor(deps: AutoStartCoordinatorDeps) {
    this.deps = deps;
    this.warmedOffices = new WarmedOfficeRegistry();
    this.replaceTracker = new AgentReplaceTracker();
  }

  /** Rule #1 + #2 trigger. Idempotent: no-op if office already warmed or
   *  setting is OFF. Returns the agents it kicked off (for testing). */
  async tryWarmCurrentOffice(): Promise<string[]> {
    // 1. Setting gate (FR-016 / FR-018).
    if (!this.deps.getSettings().autoStartKnownAgents) return [];
    // 2. Current office known?
    const oid = this.deps.getCurrentOfficeId();
    if (!oid) return [];
    // 3. Already warmed this session (FR-008)?
    if (this.warmedOffices.has(oid)) return [];
    // 4. Mark BEFORE spawn loop to prevent re-entry from a simultaneous
    //    onOfficesUpdated callback (research.md §R4).
    this.warmedOffices.mark(oid);
    // 5. Roster (FR-020 — fleet sub-agents excluded by caller).
    let roster: string[];
    try {
      roster = this.deps.getCanonicalAgentIds(oid) || [];
    } catch {
      roster = [];
    }
    // 6. Session meta cache (async — fetch fresh from bridge to avoid the
    //    race with main.ts's fire-and-forget fetchSessionMeta).
    let meta: Record<string, { title: string }>;
    try {
      meta = (await this.deps.getSessionMeta(oid)) || {};
    } catch {
      meta = {};
    }
    // 7. Qualifying filter (FR-005): non-empty trimmed title AND a current
    //    persisted session uuid. Resolve session ids in parallel.
    const titled: string[] = [];
    for (const id of roster) {
      const entry = meta[id];
      const title = entry && typeof entry.title === 'string' ? entry.title.trim() : '';
      if (title) titled.push(id);
    }
    const sids = await Promise.all(
      titled.map((id) =>
        Promise.resolve()
          .then(() => this.deps.getCurrentSessionId(oid, id))
          .catch(() => null),
      ),
    );
    const qualifying: string[] = [];
    for (let i = 0; i < titled.length; i++) {
      if (sids[i]) qualifying.push(titled[i]);
    }
    // 8. Kick off in parallel; each call is individually try/caught so one
    //    failure does not abort the others (FR-007).
    for (const id of qualifying) {
      void Promise.resolve()
        .then(() => this.deps.warmAgentSession(oid, id))
        .catch((err) => {
          try {
            console.warn(
              `[AutoStartCoordinator] warmAgentSession failed for ${oid}/${id}:`,
              err,
            );
          } catch {
            /* ignore */
          }
        });
    }
    return qualifying;
  }

  /** Rule #3 trigger. Returns the in-flight promise for an existing replace,
   *  otherwise starts and tracks a new one. Setting OFF short-circuits to
   *  just resetSession (acts like Close Session, per FR-017). Resolves with the
   *  freshly-minted session id from the reset (spec 021 — lets the New Session
   *  UI update the id display without a redundant getSessionId round-trip). */
  replaceSession(officeId: string, agentId: string): Promise<ReplaceSessionResult> {
    const existing = this.replaceTracker.get(agentId);
    if (existing) return existing;
    const p = (async (): Promise<ReplaceSessionResult> => {
      const sessionId = (await this.deps.resetSession(officeId, agentId)) ?? null;
      if (this.deps.getSettings().autoStartKnownAgents) {
        await this.deps.warmAgentSession(officeId, agentId);
      }
      return { sessionId };
    })().finally(() => {
      this.replaceTracker.delete(agentId);
    });
    this.replaceTracker.set(agentId, p);
    return p;
  }
}

// ── Singleton registry ───────────────────────────────────────────
// main.ts owns construction; UI files (TerminalOverlay, SeriousTerminalController)
// read the coordinator via getAutoStartCoordinator() to avoid threading a
// dependency through Phaser scene constructors. T503/T504 delegation sites.

let _instance: AutoStartCoordinator | null = null;

export function setAutoStartCoordinator(c: AutoStartCoordinator): void {
  _instance = c;
}

export function getAutoStartCoordinator(): AutoStartCoordinator | null {
  return _instance;
}
