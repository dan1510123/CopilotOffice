# Phase 1 Contracts: UI Overlay + Serious Terminal Controller Delta

This feature changes no IPC message shapes and no `protocol.ts` types. The contract delta is observational — what each renderer-side method MUST do — plus the named smoke-test invariants that gate review (spec SC-005).

## Existing IPC messages (unchanged shape)

All messages from spec 002's `contracts/terminal-protocol.md` are unchanged. Notably:

- `open { officeId, agentId, ... }` → `{ success, pid?, sessionId?, reused?, error? }`
- `terminalWrite { officeId, agentId, data }`
- `attach` / `detach` / `getSessionId` / `setSessionId` / `resetSession` / `transferSession`
- `terminal-preload-status { agentId, status }` (server → renderer event)

The Phase C change to `SeriousTerminalController.onData` modifies *which* `agentId` is bundled into a `terminalWrite` payload, not the payload schema.

## Observational contract delta (NEW expectations)

| ID | Caller | Pre-condition | Post-condition |
|----|--------|---------------|----------------|
| **C6** | `TerminalOverlay.createSpriteCard()` | A `TerminalOverlay` is being constructed for a scene. | Before appending the new node, `document.getElementById('sprite-card')` is queried and, if non-null, removed. After append, exactly one `#sprite-card` exists in the document. Idempotent on repeat calls. |
| **C7** | `OfficeScene.shutdown()` and `MeetingScene.shutdown()` | Phaser is tearing the scene down (any transition that removes the scene). | Calls `this.terminalOverlay?.destroy()` before super-class shutdown completes. `destroy()` removes the sprite-card DOM node and any other overlay-owned DOM nodes. MUST NOT throw if the overlay was never fully constructed. |
| **C8** | `SeriousTerminalController.openAgentTerminal(office, agent)` | Operator clicks an agent card in serious mode. | The synchronous render phase (everything between `await closeView(...)` and the first `await terminalStart(...)`) is wrapped in `try/catch`. On catch: `setStatus(human-readable message)` + write `\r\n[render error: <message>]\r\n` into `this.terminal` + still call `terminalStart(office.id, agent.id, ...)` + `terminalAttach(office.id, agent.id)`. The catch uses the *requested* ids, not `this.activeOfficeId` / `this.activeAgentId`. |
| **C8.a** | `SeriousTerminalController.openAgentTerminal` | Synchronous render phase succeeds. | No new visible state introduced; behavior matches pre-fix happy path byte-for-byte. |
| **C9** | `SeriousTerminalController.openAgentTerminal` `onData` registration site | A new agent terminal is being opened. | (1) Any previous `this.onDataDisposable?.dispose()` is called. (2) Locals `const boundOfficeId = office.id; const boundAgentId = agent.id;` are captured. (3) `this.onDataDisposable = this.terminal.onData((data) => bridge.terminalWrite({ officeId: boundOfficeId, agentId: boundAgentId, data }));` (4) The callback MUST NOT read `this.activeOfficeId` / `this.activeAgentId`. |
| **C10** | `SeriousTerminalController.closeView` (audit-only) | Closing the currently visible terminal. | If `closeView` performs synchronous DOM rendering before its IPC call, that rendering MUST be wrapped in the same `try`-around-render pattern as C8. Otherwise this contract is satisfied vacuously. |

## Named smoke-test invariants (gate for SC-005)

The extended `tests/integration/main/serious-mode.test.ts` MUST include three named tests. Each test name identifies the invariant it guards; a regression of that invariant produces a single, named failure.

| Test name | Guards | Asserts |
|-----------|--------|---------|
| `SM-001 single sprite-card across game-mode + meeting round trip` | V8, V9, V10, C6, C7 | After: boot → OfficeScene open terminal → enter MeetingScene → leave MeetingScene → reopen terminal, `document.querySelectorAll('#sprite-card').length === 1` at every measurement point (not just at the end). |
| `SM-002 serious-mode open surfaces synchronous render failures and still attaches` | V12, V12.a, C8, C8.a | Stub `updateSpriteCard` (or another synchronous render call) to throw. Invoke `openAgentTerminal(office, agent)`. Assert: `setStatus` was called with a human-readable message containing the failure, the xterm received a `[render error:` line, AND `terminalStart` + `terminalAttach` were both invoked with `office.id` / `agent.id`. |
| `SM-003 serious-mode onData routes to the agent bound at registration` | V13, V14, C9 | Open terminal for agent A. Mutate `this.activeAgentId = 'agent-B'` without going through the normal close flow. Trigger the `onData` callback with `"x"`. Assert: `bridge.terminalWrite` was called with `agentId: 'agent-A'`. Then open terminal for agent B normally; assert previous disposable was `dispose()`d and the new write goes to `'agent-B'`. |

Additionally:

- The existing `it.fails` test labeled SM-F MUST be converted to `it(...)` once Phase B lands; SC-004 forbids leaving any expected-failure marker on these invariants.
- A thin regression test in `tests/integration/terminal/SeriousTerminalController.test.ts` named `routes onData to bound agent after activeAgentId mutation` covers V13 at the controller-unit level for fast feedback.

## Contracts NOT changing

- `electron/terminal/protocol.ts` message shapes — read-only.
- `electron/terminal/preload.ts` `copilotBridge` surface — read-only.
- `electron/terminal/server.ts` PTY semantics, session ID minting, `signalReady` — read-only (spec 002 territory).
- `src/input/InputManager.ts` focus arbitration — untouched.
- `game.events` channels (`agent:interact`, `terminal:open/close`, `office:switch`, `agent:status:changed`, `agent:tool:start`, etc.) — untouched.
- `src/config/agents.ts` roster and any `src/config/*` schema — untouched.
- Persisted `.data/*.json` shapes — untouched.

## Optional additive log lines (forensic)

These do not gate behavior. They make regressions easier to bisect.

- `[TerminalOverlay] createSpriteCard removed stale #sprite-card before append` — when V9's defensive remove fires.
- `[OfficeScene] shutdown destroying terminalOverlay` / `[MeetingScene] shutdown destroying terminalOverlay` — at the C7 call site.
- `[SeriousTerminalController] openAgentTerminal render failure (officeId=<o> agentId=<a>): <message>` — at the C8 catch.
- `[SeriousTerminalController] onData rebound officeId=<o> agentId=<a>` — at the C9 registration site.
