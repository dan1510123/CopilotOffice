// Dual-key viewer bookkeeping for the terminal PTY server.
//
// INVARIANT (R-002 — see specs/001-repo-wide-refactor/slices/S1-D-pty-server.md):
//   When a session is transferred from a source office to a fleet office via the
//   `transfer-session` IPC handler in `server.ts`, the PTY data callback and the
//   `EventsWatcher` callback closures captured the ORIGINAL composite key
//   (e.g. `office-0:architect`). Viewers that attach later in the fleet office
//   register under a NEW composite key (e.g. `office-fleet-001:architect`).
//
//   If only the new key is tracked in `activeAgentViewers`, the closures see no
//   active viewer for their captured original key and silently drop
//   `terminal-data` and `copilot-event` payloads. The fix is the "dual-key"
//   rule: every attach/detach against a key that has an alias mapping in
//   `agentToTerminal` must mirror the change onto the aliased original key.
//
//   The three functions below own that rule. Server.ts MUST go through them
//   for every viewer mutation that may involve a transferred session (attach,
//   detach, hasActiveViewer). Direct `Set.add` / `Set.delete` calls are
//   intentionally allowed only in non-transfer code paths (PTY exit cleanup,
//   shutdown) where the dual-key contract does not apply.
//
// Sub-agent lifecycle events (`subagent.*`, `system.notification`, and
// `tool.execution_start` for the `task` tool) are forwarded unconditionally in
// `server.ts` regardless of `hasActiveViewer` — see the `isFleetCriticalEvent`
// branch — so the dual-key invariant only governs ordinary terminal-data /
// non-critical copilot-event payloads.

/**
 * Read/write surface needed by the dual-key helpers. server.ts hands its
 * top-level maps to these helpers so a single source of truth is preserved
 * while the invariant remains testable in isolation.
 */
export interface ViewerMaps {
  /** Active viewer composite keys (`${officeId}:${agentId}` or aliased keys). */
  readonly activeAgentViewers: Set<string>;
  /** Alias map: composite key → terminal key (the PTY's original composite key). */
  readonly agentToTerminal: Map<string, string>;
}

export interface DualKeyResult {
  /** The aliased terminal key that was also mutated, or `null` when ck has no alias. */
  readonly aliasKey: string | null;
}

/**
 * Mark `ck` as an active viewer. When `ck` aliases a different terminal key
 * (a transferred session), also mark the original terminal key as active so
 * data/event callbacks bound to the original key continue to forward.
 */
export function addAgentViewer(ck: string, maps: ViewerMaps): DualKeyResult {
  maps.activeAgentViewers.add(ck);
  const termKey = maps.agentToTerminal.get(ck);
  if (termKey && termKey !== ck) {
    maps.activeAgentViewers.add(termKey);
    return { aliasKey: termKey };
  }
  return { aliasKey: null };
}

/**
 * Remove `ck` from active viewers, mirroring the removal onto its aliased
 * terminal key when present. Pairs with {@link addAgentViewer} on detach.
 */
export function removeAgentViewer(ck: string, maps: ViewerMaps): DualKeyResult {
  maps.activeAgentViewers.delete(ck);
  const termKey = maps.agentToTerminal.get(ck);
  if (termKey && termKey !== ck) {
    maps.activeAgentViewers.delete(termKey);
    return { aliasKey: termKey };
  }
  return { aliasKey: null };
}

/**
 * True when ANY viewer is watching `ck`, including viewers attached under an
 * alias key that resolves to `ck` via `agentToTerminal`. Callers in `server.ts`
 * use this to gate ordinary terminal-data / non-critical copilot-event forwarding.
 */
export function hasActiveViewer(ck: string, maps: ViewerMaps): boolean {
  if (maps.activeAgentViewers.has(ck)) return true;
  for (const [alias, termKey] of maps.agentToTerminal) {
    if (termKey === ck && maps.activeAgentViewers.has(alias)) return true;
  }
  return false;
}
