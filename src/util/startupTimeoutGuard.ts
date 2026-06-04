// Pure decision helper for the "starting agent past timeout" branch of
// `src/main.ts` `syncAgentStatuses` (feature 002, V4 / C4 / US2).
//
// The renderer's status sync loop must not flip an agent to
// `error: 'Startup timed out'` when the underlying PTY is still alive — the
// ready signal may simply not have arrived yet (e.g. because of the shared-
// session-id symptom this feature also fixes). When alive, we instead force
// a transition to `ready` and log the recovery for forensics.

export type StartupTimeoutDecision =
  | { kind: 'no-transition' }
  | { kind: 'recover-to-ready' }
  | { kind: 'transition-to-error'; reason: 'Startup timed out' };

export interface StartupTimeoutInputs {
  subState: string | undefined;
  activityStartTime: number | null | undefined;
  now: number;
  timeoutMs: number;
  serverAlive: boolean | undefined;
}

/**
 * Decide what to do with an agent whose renderer state is `subState === 'starting'`
 * during a status-sync tick.
 *
 * Returns:
 *   - `no-transition` when the agent is not in `starting` or has not yet
 *     exceeded `timeoutMs`.
 *   - `recover-to-ready` when starting + past timeout + PTY alive (V4 guard).
 *   - `transition-to-error` when starting + past timeout + PTY dead/unknown
 *     (the original error path).
 */
export function decideStartupTimeoutTransition(
  inputs: StartupTimeoutInputs,
): StartupTimeoutDecision {
  if (inputs.subState !== 'starting') return { kind: 'no-transition' };
  if (!inputs.activityStartTime) return { kind: 'no-transition' };
  if (inputs.now - inputs.activityStartTime <= inputs.timeoutMs) {
    return { kind: 'no-transition' };
  }
  if (inputs.serverAlive === true) {
    return { kind: 'recover-to-ready' };
  }
  return { kind: 'transition-to-error', reason: 'Startup timed out' };
}
