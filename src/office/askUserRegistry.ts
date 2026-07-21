// Renderer-side pending `ask_user` registry (spec 017 — US3/US4).
//
// The terminal server relays every `ask_user` interaction to the renderer as a
// `copilot-ask-user` event carrying the REAL question text, the offered options,
// and whether freeform input is allowed. We capture that here, keyed by agentId,
// so the orchestrator can:
//   - US3: report the actual question an agent is waiting on (not a generic label).
//   - US4: answer a waiting agent through the spec-015 submit-answer channel with
//     the correct `wasFreeform` flag, instead of typing raw text into the TUI
//     (which merely selects the highlighted option for a choice prompt).
//
// Keyed by agentId (the `copilot-ask-user` event carries no officeId), matching
// how Teams keys its own pending-question map. At most one blocking `ask_user`
// exists per agent at a time.

export interface PendingAskUser {
  toolId: string;
  requestId: string;
  question: string;
  options: string[];
  freeform: boolean;
}

const pending = new Map<string, PendingAskUser>();

/** Record the pending `ask_user` an agent is now waiting on (overwrites any prior). */
export function setPendingAskUser(agentId: string, entry: PendingAskUser): void {
  pending.set(agentId, entry);
}

/** The pending `ask_user` for an agent, or undefined when none is outstanding. */
export function getPendingAskUser(agentId: string): PendingAskUser | undefined {
  return pending.get(agentId);
}

/**
 * Clear an agent's pending `ask_user`. When `toolId` is provided, only clears if
 * it matches the recorded interaction (so a late tool-complete for a superseded
 * question cannot wipe a newer one). Returns true when an entry was removed.
 */
export function clearPendingAskUser(agentId: string, toolId?: string): boolean {
  const entry = pending.get(agentId);
  if (!entry) return false;
  if (toolId !== undefined && entry.toolId !== toolId) return false;
  return pending.delete(agentId);
}

/**
 * Decide the `wasFreeform` flag for an answer: false when it exactly matches one
 * of the offered options (case-insensitive, trimmed), true otherwise. Mirrors the
 * Teams reply-classification so both surfaces submit answers identically.
 */
export function classifyAnswer(agentId: string, answer: string): { wasFreeform: boolean; requestId?: string } {
  const entry = pending.get(agentId);
  const trimmed = answer.trim().toLowerCase();
  const matched = entry?.options.some((o) => o.trim().toLowerCase() === trimmed) ?? false;
  return { wasFreeform: !matched, requestId: entry?.requestId };
}

/** Test/diagnostics helper: drop all entries. */
export function clearAllPendingAskUser(): void {
  pending.clear();
}
