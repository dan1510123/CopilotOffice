// Pure serialization + persistence boundary for office state (S2-A).
//
// `OfficeManager` is the runtime data layer; this module owns the on-disk /
// localStorage schema and the IO port abstraction so the manager has no
// hardcoded `window.copilotBridge` access. Two layers:
//
//   1. Pure functions: `serializeOffices` / `deserializeOffices` produce and
//      consume the JSON schema. Side-effect free and unit-testable in isolation.
//   2. `OfficePersistencePort`: tiny interface the manager calls to read/write
//      the JSON. Default implementation is `createBridgePersistencePort()` which
//      adapts the existing `window.copilotBridge` surface; tests pass an
//      in-memory implementation.
//
// Backward compatibility: the on-disk schema is unchanged. `deserializeOffices`
// still backfills missing `layout`, missing `seatedAgents`, and drops the legacy
// `index` field. Modern payloads (all offices have unique `office-N` ids) keep
// their stored ids; only legacy payloads (UUID / missing ids) are reindexed to
// `office-N` from array position. Preserving ids is required because per-office
// session-history files are keyed by id — positionally reindexing survivors
// after a deletion would remap later offices onto the wrong session file.

import type { OfficeConfig, OfficeLayout, SeatedAgent } from './officeManager';

/** On-disk / localStorage shape. */
export interface StoredOfficeState {
  currentOfficeId: string | null;
  offices: OfficeConfig[];
}

/** Result of normalizing a parsed payload. `null` parsed input → empty state. */
export interface NormalizedOfficeState {
  currentOfficeId: string | null;
  offices: OfficeConfig[];
}

/**
 * Serialize live office configs to the on-disk JSON shape. The manager passes
 * the runtime state; this function makes no decisions about which fields to
 * persist beyond mirroring `OfficeConfig`.
 */
export function serializeOffices(state: StoredOfficeState): string {
  return JSON.stringify(
    {
      currentOfficeId: state.currentOfficeId,
      offices: state.offices,
    },
    null,
    2
  );
}

/**
 * Parse and normalize a stored payload. Returns an empty state for null /
 * malformed input rather than throwing — callers (manager init) tolerate
 * partial data and a warning is logged on parse failure.
 */
export function deserializeOffices(stored: string | null): NormalizedOfficeState {
  if (!stored) return { currentOfficeId: null, offices: [] };

  let data: unknown;
  try {
    data = JSON.parse(stored);
  } catch {
    return { currentOfficeId: null, offices: [] };
  }

  if (data === null || typeof data !== 'object') {
    return { currentOfficeId: null, offices: [] };
  }

  const record = data as Record<string, unknown>;
  const rawOffices = Array.isArray(record.offices) ? record.offices : [];

  // Preserve stored `office-N` ids when the payload is already in the modern
  // scheme (every entry is a well-formed object with a unique `office-N` id).
  // Per-office session-history files are keyed by office id, so positionally
  // reindexing the survivors after a deletion would silently remap every office
  // *after* the deleted one onto the wrong session file — wiping their visible
  // history. Legacy payloads (UUID / missing ids, or any malformed entry) still
  // fall back to positional assignment so the original migration behaviour holds.
  const officeIdPattern = /^office-\d+$/;
  const objectOffices = rawOffices.filter(
    (o): o is Record<string, unknown> => o !== null && typeof o === 'object'
  );
  const storedIds = objectOffices.map((o) => o.id);
  const preserveIds =
    objectOffices.length === rawOffices.length &&
    storedIds.every((id) => typeof id === 'string' && officeIdPattern.test(id)) &&
    new Set(storedIds).size === storedIds.length;

  const offices: OfficeConfig[] = [];
  for (let i = 0; i < rawOffices.length; i++) {
    const raw = rawOffices[i];
    if (raw === null || typeof raw !== 'object') continue;
    const cfg = raw as Record<string, unknown>;

    const name = typeof cfg.name === 'string' ? cfg.name : `Office ${i}`;
    const workingDirectory =
      typeof cfg.workingDirectory === 'string' ? cfg.workingDirectory : '.';
    const createdAt = typeof cfg.createdAt === 'number' ? cfg.createdAt : Date.now();
    const layout: OfficeLayout =
      cfg.layout === 'fleet-vteam' ? 'fleet-vteam' : 'default';
    const seatedAgents: SeatedAgent[] = Array.isArray(cfg.seatedAgents)
      ? (cfg.seatedAgents.filter(
          (s): s is SeatedAgent =>
            !!s && typeof s === 'object' &&
            typeof (s as SeatedAgent).deskId === 'string' &&
            typeof (s as SeatedAgent).agentId === 'string'
        ))
      : [];

    const normalized: OfficeConfig = {
      // Keep the stored id in the modern scheme; otherwise reindex from array
      // position (legacy migration — replaces UUID-style / missing ids).
      id: preserveIds ? (cfg.id as string) : `office-${i}`,
      name,
      workingDirectory,
      createdAt,
      layout,
      seatedAgents,
    };
    // Carry custom agent definitions verbatim when present.
    if (cfg.customAgents !== undefined) {
      (normalized as Record<string, unknown>).customAgents = cfg.customAgents;
    }
    if (cfg.customReserveAgents !== undefined) {
      (normalized as Record<string, unknown>).customReserveAgents = cfg.customReserveAgents;
    }
    offices.push(normalized);
  }

  let currentOfficeId: string | null = null;
  if (record.currentOfficeId !== undefined && record.currentOfficeId !== null) {
    currentOfficeId = String(record.currentOfficeId);
  }
  if (!currentOfficeId || !offices.some((o) => o.id === currentOfficeId)) {
    currentOfficeId = offices.length > 0 ? offices[0].id : null;
  }

  return { currentOfficeId, offices };
}

/**
 * Storage port the OfficeManager calls instead of touching `window` directly.
 * Methods are intentionally narrow — anything the manager needs to mutate
 * persisted state goes through here. All are async / best-effort.
 */
export interface OfficePersistencePort {
  /** Read the durable JSON payload (file-backed). Null when no payload exists. */
  loadDurable(): Promise<string | null>;
  /** Write the durable JSON payload (file-backed). Best-effort. */
  saveDurable(json: string): Promise<void>;
  /** Notify the host that a new office session file should be created. */
  createOfficeSession(officeId: string): Promise<void>;
  /** Notify the host that an office's session file should be removed. */
  deleteOfficeSession(officeId: string): Promise<void>;
}

/**
 * In-memory port — default fallback when no host bridge is available
 * (Vitest / SSR). All methods are no-ops; manager still uses localStorage
 * directly for fast synchronous restore.
 */
export function createNoopPersistencePort(): OfficePersistencePort {
  return {
    loadDurable: async () => null,
    saveDurable: async () => {},
    createOfficeSession: async () => {},
    deleteOfficeSession: async () => {},
  };
}

/**
 * Adapter over the existing `window.copilotBridge` surface. Preserves the
 * exact behaviour the inline `loadFromStorage` / `saveToStorage` calls used:
 * fire-and-forget, swallow errors, log a warning.
 */
export function createBridgePersistencePort(): OfficePersistencePort {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getBridge = (): any =>
    typeof window !== 'undefined' ? (window as any).copilotBridge : undefined;

  return {
    async loadDurable(): Promise<string | null> {
      const bridge = getBridge();
      if (!bridge?.loadOffices) return null;
      try {
        const result = await bridge.loadOffices();
        if (result?.success && typeof result.data === 'string') {
          return result.data;
        }
      } catch (e) {
        console.warn('[OfficePersistence] loadOffices failed:', e);
      }
      return null;
    },
    async saveDurable(json: string): Promise<void> {
      const bridge = getBridge();
      if (!bridge?.saveOffices) return;
      try {
        await bridge.saveOffices(json);
      } catch (e) {
        console.warn('[OfficePersistence] saveOffices failed:', e);
      }
    },
    async createOfficeSession(officeId: string): Promise<void> {
      const bridge = getBridge();
      if (!bridge?.createOfficeSession) return;
      try {
        await bridge.createOfficeSession(officeId);
      } catch (e) {
        console.warn('[OfficePersistence] createOfficeSession failed:', e);
      }
    },
    async deleteOfficeSession(officeId: string): Promise<void> {
      const bridge = getBridge();
      if (!bridge?.deleteOfficeSession) return;
      try {
        await bridge.deleteOfficeSession(officeId);
      } catch (e) {
        console.warn('[OfficePersistence] deleteOfficeSession failed:', e);
      }
    },
  };
}
