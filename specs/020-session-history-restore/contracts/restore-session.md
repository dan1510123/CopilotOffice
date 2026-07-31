# Contract: `restore-session` (Restore/Switch Session)

This feature crosses six layers. Per FR-015 (documented recurring pitfall), the new
operation MUST be present and consistent in **every** layer below in a single
change, or a layer silently no-ops. This file is the single source of truth for
the wire shape and per-layer obligations.

---

## 1. Protocol type — `electron/terminal/protocol.ts`

Add to the `MainToServer` discriminated union:

```ts
export interface MsgRestoreSession {
  type: 'restore-session';
  requestId: string;
  officeId: string;
  agentId: string;
  /** Target archived session id to promote to current. MUST exist in this agent's history. */
  sessionId: string;
}
```

Add `| MsgRestoreSession` to the `MainToServer` union (adjacent to
`MsgSetSessionId` / `MsgResetSession`). No `ServerToMain` change — the response
travels on the existing `SrvResponse` envelope.

**Response payload shape** (carried in `SrvResponse.result`):

```ts
type RestoreSessionResult =
  | { success: true; sessionId: string; resumeContextUncertain?: boolean }
  | { success: false; error: string };
```

---

## 2. Server handler — `electron/terminal/server.ts` (`case 'restore-session'`)

Algorithm (see data-model.md for rationale). Reject paths make **no state change**:

```text
case 'restore-session': {
  officeData = getOfficeSession(msg.officeId)
  target     = msg.sessionId.trim().toLowerCase()   // match set-session-id normalization
  current    = officeData.sessionIds.get(msg.agentId)
  history    = officeData.sessionHistory.get(msg.agentId) || []

  // (1) target must exist in this agent's history
  if (!history.some(e => e.id === target)):
      respond { success:false, error:'target session not in history' }; return

  // (2) target already current → no-op success
  if (target === current):
      respond { success:true, sessionId: target }; return

  // (3) collision guard — reuse the set-session-id guard verbatim
  for [otherAgent, otherSid] of officeData.sessionIds:
      if otherAgent !== msg.agentId && otherSid === target:
          respond { success:false, error:'sessionId already in use by another agent in this office' }; return

  // (4) archive current (title snapshot BEFORE meta clear; dedupe by id — 019)
  archiveSessionId(msg.officeId, msg.agentId)

  // (5) promote: remove target from history, capture its title
  const promoted = promoteHistoryEntry(history, target)
  officeData.sessionHistory.set(msg.agentId, history)

  // (6) set current pointer
  officeData.sessionIds.set(msg.agentId, target)

  // (7) restore title into meta (legacy no-title entry clears the title)
  const restoredTitle = promoted?.title ?? ''
  if (restoredTitle) officeData.sessionMeta.set(msg.agentId, { title: restoredTitle })
  else officeData.sessionMeta.delete(msg.agentId)
  send session-meta-updated { agentId, meta: { title: restoredTitle } }

  // (8) kill + restart PTY so it relaunches copilot --session-id=<target>
  //     (reuse the kill handler's cleanup: killPtyProcess, ptyProcesses.delete,
  //      agentToTerminal.delete, clearForegroundIf, watcher.stop, ready/turn cleanup)
  //     Then let the renderer's normal attach/start flow relaunch, OR restart inline.
  //     resumeContextUncertain = best-effort determination (default: false unless
  //     the backend cannot confirm rehydration).

  // (9) persist
  await saveOfficeSessionFile(msg.officeId)

  // (10) respond
  respond { success:true, sessionId: target, resumeContextUncertain }
}
```

**Obligations**: steps 1–3 occur BEFORE any mutation (true no-op on reject).
Reuse `archiveSessionId`, `promoteHistoryEntry`, the collision-guard loop, the
`kill`-handler cleanup sequence, and `saveOfficeSessionFile` — introduce no new
persistence or spawn primitive.

---

## 3. Pure helper — `electron/terminal/session-history.ts`

```ts
export function promoteHistoryEntry(
  history: SessionHistoryEntry[],
  sessionId: string
): SessionHistoryEntry | undefined {
  const idx = history.findIndex(e => e.id === sessionId);
  if (idx < 0) return undefined;
  return history.splice(idx, 1)[0];
}
```

Pure, mutating, no `server.ts` import — unit-testable like `pushArchivedEntry`.

---

## 4. IPC relay — `electron/terminal/ipc-relay.ts` (`registerIpc()`)

```ts
ipcMain.handle('terminal-restore-session', (_event, officeId: string, agentId: string, sessionId: string) =>
  this.request({ type: 'restore-session', requestId: this.id(), officeId, agentId, sessionId })
);
```

Placed alongside `set-session-id` / `terminal-reset-session` handlers.

---

## 5. Preload bridge — `electron/terminal/preload.ts`

Add the method (next to `setSessionId` / `resetSession`):

```ts
restoreSession: (
  officeId: string, agentId: string, sessionId: string
): Promise<{ success: boolean; sessionId?: string; resumeContextUncertain?: boolean; error?: string }> => {
  return ipcRenderer.invoke('terminal-restore-session', officeId, agentId, sessionId);
},
```

And the matching entry in the `Window.copilotBridge` type block (~line 472):

```ts
restoreSession: (officeId: string, agentId: string, sessionId: string) =>
  Promise<{ success: boolean; sessionId?: string; resumeContextUncertain?: boolean; error?: string }>;
```

---

## 6. Shared renderer — `src/ui/sessionHistoryRender.ts`

Extend the builders with an options bag (backward-compatible — both optional):

```ts
export interface SessionHistoryRowOptions {
  onSelect?: (entry: SessionHistoryEntry) => void;  // omit/undefined ⇒ non-actionable
  readOnly?: boolean;                               // true ⇒ never clickable (FR-017)
}

createSessionHistoryRow(entry, displayNumber, options?)
renderSessionHistoryList(entries, options?)
```

Row obligations:
- When `onSelect` is provided AND `!readOnly`: attach a click handler on the row
  that calls `onSelect(entry)`; add hover affordance (cursor/pointer).
- The `user-select: all` **id span MUST call `e.stopPropagation()`** on
  `mousedown` + `click` so selecting/copying the id never triggers `onSelect`
  (FR-007 / FR-012). Title still rendered via `textContent` (XSS-safe, FR-010).
- When `readOnly` or no `onSelect`: no click handler, no pointer affordance.

---

## 7. Both renderer surfaces (parity — FR-011)

`src/ui/TerminalOverlay.ts` `toggleSessionHistory()` (~1234) and
`src/ui/SeriousTerminalController.ts` `toggleSessionHistory()` (~754) BOTH call
`renderSessionHistoryList(history, { readOnly, onSelect })` with the same onSelect:

```text
onSelect(entry):
  if readOnly: return                               // FR-017
  if restoreInFlight: return                        // FR-010 latch
  midTurn = officeManager.getAgentStatus(officeId, agentId)?.subState === 'thinking'
  msg = midTurn
    ? 'This agent is MID-TURN. Switching to session "<title>" will interrupt in-progress work and archive the current session. Continue?'
    : 'Switch to session "<title>"? The current session will be archived into history.'
  if (!confirm(msg)): return                        // FR-002 / FR-004 no-op on cancel
  restoreInFlight = true
  try:
    res = await window.copilotBridge.restoreSession(officeId, agentId, entry.id)
    if (!res.success): showError(res.error)         // FR-009 graceful
    else if (res.resumeContextUncertain): showAdvisory('context may not be restored')  // FR-013
    // refresh popover/history + reattach terminal to reflect the new current session
  finally:
    restoreInFlight = false
```

- `TerminalOverlay` gates on its existing `isReadOnly`; `SeriousTerminalController`
  gates on its read-only/open-option state.
- After success, refresh the history list and re-render the terminal so the swapped
  session is reflected (FR-003).

---

## 8. Test bridge mock — `tests/setup/copilot-bridge-mock.ts` (FR-015)

Add to the mock object (next to `setSessionId` / `resetSession`):

```ts
restoreSession: vi.fn().mockResolvedValue({ success: true, sessionId: 'session-1' }),
```

Without this, every renderer test that touches the bridge would fail to type-check
or would call an `undefined` method — the exact silent-no-op class FR-015 guards.

---

## Verification checklist (maps to spec Regression Plan)

| # | Scenario | Layer(s) |
|---|----------|----------|
| a | confirm-switch swaps current↔archived | server handler + `promoteHistoryEntry` |
| b | cancel is a verified no-op | renderer (no IPC) |
| c | round-trip switch-back returns to original | server + helper (SC-003) |
| d | no entry lost/duplicated across repeated switches | `promoteHistoryEntry` unit tests (SC-004) |
| e | collision with another agent's active id fails gracefully | server guard (FR-009) |
| f | id text copyable, does NOT trigger switch | `sessionHistoryRender` stopPropagation (FR-007) |
| g | mapping persists across restart | `saveOfficeSessionFile` (SC-005) |
| h | resume-with-context unavailable → explicit advisory | `resumeContextUncertain` (FR-013/SC-006) |
| i | parity across both surfaces via shared mock | both `toggleSessionHistory` + mock |
| j | new op present in ALL layers (FR-015) | protocol/server/relay/preload/renderer/mock |
