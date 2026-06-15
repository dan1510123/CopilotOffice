// Structured lifecycle telemetry for agent status transitions.
//
// Adapted from agency-cowork pattern #5 (see
// `specs/001-repo-wide-refactor/tracking/agency-cowork-notes.md`): lifecycle
// transitions emit structured, greppable log lines that can be replayed during
// incident triage. The status graph this covers is the one in
// `.github/copilot-instructions.md`:
//
//   slacking → starting → ready ↔ waiting/thinking → slacking
//                            ↘ error
//
// The emit is intentionally additive:
//   - It runs after the OfficeManager has already mutated state, so observers
//     can't accidentally rewind the transition.
//   - Self-transitions (from === to) are suppressed at the source so subscribers
//     only see real movement.
//   - Subscriber errors are caught and logged; they never break the producer.
//   - The console line uses a stable `[lifecycle]` prefix so incident responders
//     can grep production logs without parsing JSON.
//
// Renderer-only: no DOM or Phaser dependencies; safe to import from
// `src/office/**` and `src/main.ts`.

export type LifecycleState =
  | 'slacking'
  | 'starting'
  | 'ready'
  | 'waiting'
  | 'thinking'
  | 'error';

export interface LifecycleTransition {
  readonly agentId: string;
  readonly officeId: string;
  readonly from: LifecycleState;
  readonly to: LifecycleState;
  /** Optional caller-provided cause (e.g. `ask_user`, `tool_complete`, `turn_end`). */
  readonly reason?: string;
  /** Optional contextual detail (e.g. the tool name when transitioning to `thinking`). */
  readonly detail?: string;
  /** Epoch ms; stamped by {@link logLifecycleTransition}. */
  readonly timestamp: number;
}

export type LifecycleSubscriber = (transition: LifecycleTransition) => void;

const subscribers = new Set<LifecycleSubscriber>();

/**
 * Register a subscriber that will receive every lifecycle transition. Returns
 * an unsubscribe function. Intended for tests, in-app debug overlays, or
 * structured log sinks — NOT for behavior-critical state derivation (use
 * `OfficeManager.getAgentStatus` for that).
 */
export function subscribeToLifecycle(fn: LifecycleSubscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Emit a single lifecycle transition. Called by `OfficeManager` after each
 * `setAgent*` mutation. Self-transitions are suppressed.
 */
export function logLifecycleTransition(
  t: Omit<LifecycleTransition, 'timestamp'>
): void {
  if (t.from === t.to) return;
  const full: LifecycleTransition = { ...t, timestamp: Date.now() };
  const reasonStr = full.reason ? ` reason=${full.reason}` : '';
  const detailStr = full.detail ? ` detail=${JSON.stringify(full.detail)}` : '';
  // Stable greppable prefix — see header for rationale.
  console.log(
    `[lifecycle] agent=${full.agentId} office=${full.officeId} ${full.from}→${full.to}${reasonStr}${detailStr}`
  );
  for (const fn of subscribers) {
    try {
      fn(full);
    } catch (err) {
      // A misbehaving subscriber must not break status transitions.
      console.warn('[lifecycle] subscriber threw:', err);
    }
  }
}

/** Test-only: clear all subscribers between tests. Do not call in production. */
export function _resetLifecycleSubscribersForTesting(): void {
  subscribers.clear();
}
