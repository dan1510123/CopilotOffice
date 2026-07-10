// Pure helpers for translating raw Copilot tool events into agent sub-state.
//
// Extracted from `src/main.ts` so the ask_user race-guard documented in
// `.github/copilot-instructions.md` ("Guard status transitions against
// concurrent tool events in src/main.ts") can be unit-tested in isolation.
//
// Renderer-only: no DOM or Phaser dependencies.

export function normalizeToolName(toolName: string | null | undefined): string {
  return (toolName ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * True when the given tool name / status text represents an `ask_user`
 * interaction. Accepts both the canonical `ask_user` tool id and freeform
 * status strings emitted by the CLI ("Waiting for your answer", etc.).
 */
export function isAskUserTool(
  toolName: string | null | undefined,
  status: string | null | undefined
): boolean {
  const normalized = normalizeToolName(toolName);
  if (normalized === 'ask_user' || normalized === 'askuser') return true;
  const statusText = (status ?? '').toLowerCase();
  return (
    statusText.includes('waiting for your answer') ||
    statusText.includes('waiting on user input')
  );
}

export interface ToolEntry {
  readonly toolId: string;
  readonly name: string | null | undefined;
  readonly status: string | null | undefined;
}

export type NextSubState =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  | { kind: 'thinking'; detail: string };

/**
 * Compute the next agent sub-state after a tool completes.
 *
 * **Race-guard**: when an `ask_user` tool is still pending in
 * `remainingTools`, it MUST win over the most recent tool name. Otherwise an
 * unrelated tool that completes in the same tick would clobber the
 * `waiting` state with `thinking`, dropping the user-input prompt off the
 * status badge. This is the pitfall called out in
 * `.github/copilot-instructions.md` ("treat `ask_user` as a waiting-state
 * signal even when other tools complete in the same tick").
 *
 * Returns `{ kind: 'idle' }` when no tools remain — the caller decides
 * whether to flip ready or preserve thinking based on turn state.
 */
export function nextSubStateAfterToolComplete(
  remainingTools: readonly ToolEntry[]
): NextSubState {
  if (remainingTools.length === 0) return { kind: 'idle' };
  if (remainingTools.some((t) => isAskUserTool(t.name, t.status))) {
    return { kind: 'waiting' };
  }
  const last = remainingTools[remainingTools.length - 1];
  return { kind: 'thinking', detail: String(last.name ?? '') };
}

/**
 * Idempotent insert into the active-tool set (FR-004).
 *
 * A duplicate or replayed `tool_start` for a `toolId` that is already tracked
 * must NOT stack a second entry — otherwise the single matching `tool_complete`
 * would leave a phantom entry behind and the resolved status would never clear.
 * Returns a new array plus whether the entry was actually added.
 */
export function addActiveTool(
  tools: readonly ToolEntry[],
  entry: ToolEntry
): { tools: ToolEntry[]; added: boolean } {
  if (tools.some((t) => t.toolId === entry.toolId)) {
    return { tools: tools.slice(), added: false };
  }
  return { tools: [...tools, entry], added: true };
}

/**
 * Remove a completed tool from the active set (FR-004).
 *
 * A completion for a `toolId` we never tracked (stale, replayed, or
 * out-of-order) is a no-op: `completed` is `null` and the set is unchanged, so
 * the caller can safely skip phantom completion notifications / status recompute.
 */
export function removeCompletedTool(
  tools: readonly ToolEntry[],
  toolId: string
): { tools: ToolEntry[]; completed: ToolEntry | null } {
  const completed = tools.find((t) => t.toolId === toolId) ?? null;
  if (!completed) return { tools: tools.slice(), completed: null };
  return { tools: tools.filter((t) => t.toolId !== toolId), completed };
}
