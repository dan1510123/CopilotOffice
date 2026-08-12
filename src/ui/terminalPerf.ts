/**
 * Terminal switch/session performance telemetry (spec 021, Phase 1).
 *
 * Debug-only, dependency-free span recorder used to measure the real cost of
 * agent switches and session actions on both terminal surfaces
 * (`TerminalOverlay` and `SeriousTerminalController`).
 *
 * Design constraints:
 * - Zero overhead when disabled: every entry point short-circuits on a single
 *   boolean check before touching the clock or the ring buffer, so it is safe
 *   to leave the `perfMark`/`perfSpan` calls on the switch hot path.
 * - No wall-clock assertions in unit tests. Tests assert *operation counts*
 *   (how many spans/marks of a given name were recorded) and ordering, never
 *   elapsed-millisecond thresholds, which are inherently flaky.
 * - Bounded memory: a fixed-size ring buffer drops the oldest entries.
 *
 * Enable at runtime via `window.__COPILOT_TERMINAL_PERF__ = true` (or set it
 * before load), then read `getTerminalPerfEntries()` from the devtools console.
 */

export type TerminalPerfPhase =
  | 'switch:request'
  | 'switch:detach-start'
  | 'switch:detach-done'
  | 'switch:meta-done'
  | 'switch:exists-done'
  | 'switch:activate-start'
  | 'switch:activate-done'
  | 'switch:scrollback-write'
  | 'switch:first-ready'
  | 'session:new-request'
  | 'session:new-done'
  | 'session:close-request'
  | 'session:close-done'
  | 'cache:hit'
  | 'cache:miss'
  | 'cache:evict';

export interface TerminalPerfEntry {
  /** Monotonic sequence number, assigned in record order. */
  seq: number;
  /** High-resolution timestamp (ms) when the entry was recorded. */
  t: number;
  /** UI surface that produced the entry. */
  surface: 'overlay' | 'serious';
  /** Coarse phase/marker name. */
  phase: TerminalPerfPhase;
  /** Composite `officeId:agentId` this entry is about, when known. */
  target?: string;
  /** Optional numeric payload (e.g. scrollback byte count). */
  value?: number;
}

const RING_CAPACITY = 512;

let enabled = false;
let seqCounter = 0;
const ring: TerminalPerfEntry[] = [];

function now(): number {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch {
    /* ignore */
  }
  return Date.now();
}

function readEnvFlag(): boolean {
  try {
    const w = globalThis as unknown as { __COPILOT_TERMINAL_PERF__?: unknown };
    return w.__COPILOT_TERMINAL_PERF__ === true;
  } catch {
    return false;
  }
}

// Resolve the initial flag from the global once at module load; callers can
// still flip it explicitly via setTerminalPerfEnabled().
enabled = readEnvFlag();

/** Enable or disable perf recording at runtime. */
export function setTerminalPerfEnabled(value: boolean): void {
  enabled = value;
}

/** Whether perf recording is currently active. */
export function isTerminalPerfEnabled(): boolean {
  return enabled;
}

/**
 * Record a single perf marker. No-op (single boolean check, no clock read)
 * when disabled, so it is safe on the switch hot path.
 */
export function perfMark(
  surface: TerminalPerfEntry['surface'],
  phase: TerminalPerfPhase,
  target?: string,
  value?: number,
): void {
  if (!enabled) return;
  const entry: TerminalPerfEntry = { seq: seqCounter++, t: now(), surface, phase, target, value };
  ring.push(entry);
  if (ring.length > RING_CAPACITY) {
    ring.splice(0, ring.length - RING_CAPACITY);
  }
}

/** Snapshot of all recorded perf entries, oldest first. */
export function getTerminalPerfEntries(): TerminalPerfEntry[] {
  return ring.slice();
}

/** Count recorded entries matching a phase (and optionally a surface/target). */
export function countTerminalPerfEntries(
  phase: TerminalPerfPhase,
  filter?: { surface?: TerminalPerfEntry['surface']; target?: string },
): number {
  let n = 0;
  for (const e of ring) {
    if (e.phase !== phase) continue;
    if (filter?.surface && e.surface !== filter.surface) continue;
    if (filter?.target && e.target !== filter.target) continue;
    n++;
  }
  return n;
}

/** Clear all recorded entries (test isolation / manual reset). */
export function resetTerminalPerf(): void {
  ring.length = 0;
  seqCounter = 0;
}

// Expose a small console handle when a DOM window is present, so operators can
// read spans without importing the module.
try {
  const w = globalThis as unknown as Record<string, unknown>;
  w.getTerminalPerfEntries = getTerminalPerfEntries;
  w.setTerminalPerfEnabled = setTerminalPerfEnabled;
} catch {
  /* ignore */
}
