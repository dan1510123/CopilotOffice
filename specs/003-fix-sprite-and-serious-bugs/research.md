# Phase 0 Research: Fix Sprite-Card Stacking and Serious-Mode Open-Flow Bugs

All NEEDS CLARIFICATION items from the plan template are resolved. This document captures the option analysis behind each phase and the design templates reused from spec 002.

## R1. Sprite-card lifecycle: Option A vs Option B

### Decision

**Option A — minimal idempotent createSpriteCard + scene-owned destroy on shutdown.**

`TerminalOverlay.createSpriteCard()` will be made idempotent: before appending the new `<div id="sprite-card">`, look up any pre-existing element with that id and remove it. Each scene that constructs a `TerminalOverlay` (`OfficeScene`, `MeetingScene`) will call `this.terminalOverlay?.destroy()` from its `shutdown()` hook so the DOM node is removed when the scene tears down.

### Rationale

- The user's framing names both options and recommends Option A explicitly for blast-radius reasons. The fix lives in three files (`TerminalOverlay.ts`, `OfficeScene.ts`, `MeetingScene.ts`) and changes no public interface.
- Spec FR-002 explicitly requires that the scene's shutdown path remove the sprite-card DOM node "rather than relying on garbage collection of the Phaser scene". A scene-owned `destroy()` call matches this requirement directly.
- The idempotent-create guard is defense in depth for the edge case spelled out in spec L80: "A scene shutdown runs while the terminal overlay is mid-construction... the shutdown path must still leave the DOM clean and must not throw on a partially constructed overlay." If for any reason a stale sprite card survives, the next constructor will mop it up.
- Option A preserves the existing ownership model: each scene owns its overlay, which owns its sprite card. No new lifetime contracts to learn.

### Alternatives considered

- **Option B — singleton sprite card owned by `main.ts`, populated by overlay via an adapter** (rejected for this fix). Cleaner long-term but a refactor: it changes ownership, requires a new interface, and risks regressing spec 002's V5/V6 sequencing where the overlay owns its DOM. Out of scope for a bug fix.
- **Move the sprite card into the Phaser canvas** (rejected — violates the constitution's Phaser-first principle in reverse; DOM overlays are the intended pattern for shell UI).
- **Rely on Phaser scene `destroy` semantics to clean up DOM children** (rejected — Phaser does not own the document; DOM nodes appended to `document.body` are not part of the scene's display list and survive scene destruction. This is the bug.).

## R2. Serious-mode open flow: try-around-what

### Decision

Wrap the **entire** body of `SeriousTerminalController.openAgentTerminal` in a top-level `try/catch`. On catch:

1. Compose a human-readable message identifying the failure.
2. Call `this.setStatus(message)` (existing operator-visible status surface).
3. Write `\r\n[render error: <message>]\r\n` into the xterm so the failure is visible inside the terminal panel itself.
4. **Still** call `terminalStart` / `terminalAttach` for the requested agent so the PTY session is attempted.
5. If the attach itself throws, fall back to the existing attach-phase error handling (already present in the current code).

Mirror the same defensive try-around-render pattern in `closeView` if (and only if) it performs unguarded synchronous DOM rendering before its IPC call.

### Rationale

- Spec FR-005 / FR-006 require an operator-visible error AND a PTY attach attempt for *any* synchronous failure before attach. Wrapping just `updateSpriteCard` would miss `updateSessionTitle`, `refitAndResize`, or any new sync work added later. A top-level wrap is the only contract that survives future code changes.
- Spec L77 edge case: "the serious-mode open flow throws synchronously after the previous terminal has been closed (`await closeView({silent:true})` has already cleared the active agent); the resilience requirement must not cause the controller to attach the new agent's PTY to a stale or null active agent." The catch block must therefore use the *requested* `officeId`/`agentId` (the parameters to `openAgentTerminal`), not `this.activeOfficeId`/`this.activeAgentId`, when constructing the attach call.
- Spec FR-007 requires zero change to the happy path. A top-level `try/catch` whose body is the entire current implementation satisfies this trivially: when nothing throws, behavior is byte-for-byte unchanged.

### Alternatives considered

- **Try around `updateSpriteCard` only** (rejected — too narrow; `refitAndResize` and `updateSessionTitle` are the more likely throw sources given they touch xterm internals and DOM measurement).
- **Promote the synchronous render to a `Promise.resolve().then(...)` to convert sync throws to rejections handled by a single chain** (rejected — adds a microtask boundary that breaks happy-path timing assumptions tested by spec 002).
- **Surface the error only via console / log** (rejected — spec explicitly requires an *operator-visible* error in the terminal status; FR-005).

## R3. `onData` bound-at-registration: template reuse from spec 002

### Decision

Reuse `src/ui/TerminalOverlay.ts`'s `registerOnDataHandler(boundAgentId, boundOfficeId)` pattern verbatim in `SeriousTerminalController`. Specifically:

- Maintain `private onDataDisposable: { dispose(): void } | null = null` on the controller.
- On every `openAgentTerminal(office, agent)` call, after the terminal panel is ready:
  - `this.onDataDisposable?.dispose()` to drop the previous binding.
  - `const boundOfficeId = office.id; const boundAgentId = agent.id;` (locals — these are the *captured* values).
  - `this.onDataDisposable = this.terminal.onData((data) => { window.copilotBridge.terminalWrite({ officeId: boundOfficeId, agentId: boundAgentId, data }); });`
- Do **not** read `this.activeOfficeId` / `this.activeAgentId` from inside the callback.

### Rationale

- This is the V6 invariant from spec 002 (`specs/002-fix-terminal-cold-start/data-model.md`), already proven in `TerminalOverlay.ts` and covered by tests at `tests/integration/terminal/TerminalOverlay.test.ts`. Reusing the same pattern keeps game mode and serious mode on the same hardened contract.
- The user identified that today an early-return guard in the close path masks the bug. That guard is fragile — any future reorder of the close-then-open sequence reintroduces cross-agent input leak. Fixing the contract at the binding site, not at the read site, is the only durable fix.
- `MockTerminal.onData` in `tests/integration/terminal/_helpers/` already returns `{ dispose: vi.fn() }` from spec 002's harness work, so the regression test can assert `dispose` is called on re-registration with no harness changes.

### Alternatives considered

- **Read live `this.activeAgentId` but add a re-entrancy guard** (rejected — same shape as the existing fragile guard; doesn't fix the contract).
- **Extract `registerOnDataHandler` into a shared utility used by both `TerminalOverlay` and `SeriousTerminalController`** (deferred — small win, but the two controllers have different `terminal` ownership models; a shared helper would need to be parameterized in a way that obscures the binding intent. Re-evaluate if a third caller appears.).

## R4. Smoke test extension strategy

### Decision

Extend the existing `tests/integration/main/serious-mode.test.ts` (already on this branch, currently untracked) with three new named test cases:

- `SM-001 single sprite-card across game-mode + meeting round trip`
- `SM-002 serious-mode open surfaces synchronous render failures and still attaches`
- `SM-003 serious-mode onData routes to the agent bound at registration`

Convert the existing `it.fails` SM-F into a passing `it(...)` after Phase B lands. Add one additional regression test to `tests/integration/terminal/SeriousTerminalController.test.ts` named `routes onData to bound agent after activeAgentId mutation` for fast-feedback when the V6 invariant regresses in serious mode.

### Rationale

- Spec FR-010 explicitly says the smoke tests MUST extend the serious-mode integration test file already created in this branch.
- Spec SC-005 requires that each invariant regression produces a single, named failure. The `SM-001` / `SM-002` / `SM-003` naming convention satisfies this directly — the test name identifies which invariant was violated.
- Splitting the V6-style assertion into both the integration test and the controller unit-style test mirrors spec 002's coverage pattern (cheap test for the contract at the controller boundary, integration test for the full flow).

### Alternatives considered

- **One mega-test that asserts all three invariants** (rejected — violates SC-005's "single, named test fail" requirement).
- **New top-level test file per invariant** (rejected — spec FR-010 requires extending the existing file, not creating new ones).

## R5. Files NOT changed (deliberate scope guard)

- `electron/terminal/server.ts` — terminal server is correct; spec 002 verified.
- `electron/terminal/protocol.ts` — no IPC shape changes.
- `electron/terminal/preload.ts` — no bridge surface changes.
- `src/main.ts` — sprite card stays renderer-managed; no singleton refactor (Option B was rejected in R1).
- `src/input/InputManager.ts` — input focus arbitration is unchanged; `onData` payload change in Phase C does not touch focus.
- `src/scenes/BootScene.ts` — does not construct a `TerminalOverlay`.

This list is the explicit boundary of the change. Any future PR that touches these files for reasons attributed to this spec should be flagged in review.
