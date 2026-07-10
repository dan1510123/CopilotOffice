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
 * Given the agent being activated (`ck`, plus its optional dual-key alias) in
 * `officeId`, return the other active-viewer keys in the SAME office that must
 * be deactivated so exactly one agent is UI-active per office. Keys for other
 * offices — and the activated agent's own keys — are never returned.
 */
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
