// Shared-host (ui-server) foreground attribution helpers.
//
// Under the ui-server backend every agent in an office shares ONE host TUI
// (`runtime.rawPty`). The TUI only ever renders the *foreground* session, but
// every agent's `onData` callback receives those same bytes. Without gating,
// the foreground session's rendered output is appended to every agent's
// scrollback (and streamed to any other active viewer), so one agent's messages
// visibly leak into another when switching between agents in the same office.
//
// To prevent that, the server:
//   1. attributes the shared stream to exactly one agent — the office
//      *foreground* — so non-foreground agents ignore the shared bytes, and
//   2. keeps exactly one agent UI-active per office by deactivating any other
//      viewer in the same office when a new agent is attached.
//
// These two decisions are pure functions so they stay testable in isolation,
// mirroring the dual-key helpers in `agent-viewers.ts`.

/** Office id embedded in a composite key (`${officeId}:${agentId}`). */
export function officeOf(ck: string): string {
  return ck.split(':')[0] ?? ck;
}

/**
 * Whether the shared host TUI stream should be forwarded/recorded for `ck`.
 *
 * Forwards only for the office foreground agent. Fails OPEN when no foreground
 * is recorded (`undefined`) so the stream is never silently blackholed — this
 * self-heals if the foreground agent's PTY was torn down before a new foreground
 * was established.
 */
export function shouldForwardSharedHostData(
  ck: string,
  foreground: string | undefined,
): boolean {
  return foreground === undefined || foreground === ck;
}

/**
 * Given the office foreground recorded before an agent starts, return who owns
 * the foreground after starting `startingCk`. An existing foreground is NEVER
 * overwritten by a starting agent — a background warm/start (e.g. cross-office
 * Teams cold-warm) of a non-viewed agent must not seize foreground from the
 * agent the user is actually viewing. Only when no foreground is recorded yet
 * does the starting agent claim it. Mirrors the `!officeForegroundCk.has(...)`
 * claim guard in server.ts.
 */
export function foregroundAfterStart(
  currentForeground: string | undefined,
  startingCk: string,
): string {
  return currentForeground ?? startingCk;
}

/**
 * Whether starting `startingCk` must re-assert the office's intended foreground.
 * Under the shared ui-server host every started agent claims the host
 * foreground, so a background start of a different agent than the viewer's
 * foreground would hijack input. Re-assert when a foreground is recorded and it
 * is a different agent than the one starting. Mirrors the re-assert guard in
 * server.ts.
 */
export function shouldReassertForeground(
  intendedForeground: string | undefined,
  startingCk: string,
): boolean {
  return intendedForeground !== undefined && intendedForeground !== startingCk;
}
export function viewersToDeactivate(
  officeId: string,
  ck: string,
  aliasKey: string | null,
  activeViewers: Iterable<string>,
): string[] {
  const result: string[] = [];
  for (const otherCk of activeViewers) {
    if (otherCk === ck || otherCk === aliasKey) continue;
    if (officeOf(otherCk) !== officeId) continue;
    result.push(otherCk);
  }
  return result;
}
