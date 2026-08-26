# Implementation Plan: Orchestrator Session Handoff + Approval/Bring-Online Fixes

**Branch**: `021-orchestrator-handoff` | **Date**: 2026-08-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/021-orchestrator-handoff/spec.md`

## Summary

Two parts, both entirely within the existing orchestrator seams:

**Part A — Handoff.** Add one gated orchestrator tool — `handoff_session` — that composes three sanctioned
per-agent operations already shipped in spec 017 into a single approved action:

1. **Doc authoring (source-written).** Deliver a doc-writing prompt to the *source*
   agent's session (`deliverText`) instructing it to write a Markdown handoff document at
   a deterministic path (`./.copilot-handoffs/handoff-<agentId>-<ISO8601>.md`) in its own
   working directory, capturing state, decisions, open questions, and next steps.
2. **Target provisioning.** Resolve the target: `same` ⇒ restart the source into a fresh
   session (`restartSession`); a distinct `targetAgentId` ⇒ bring it online
   (`bringOnline`, which handles idle-seated + reserve scene spawn and waits for ready).
   `targetAgentId === source` collapses to the same-agent path.
3. **Pickup delivery.** Deliver a "Pick up from this handoff" prompt to the *target*
   session (`deliverText`) naming the doc path and instructing it to read the doc first
   (waiting/retrying briefly if the source's async write hasn't landed).

**Technical approach:** Extend the existing orchestrator seam, do not invent a new one.
Register `handoff_session` in `electron/orchestrator/tools.ts`, add a
`requestHandoff`/`respondHandoff` round-trip on `OrchestratorSessionManager` +
`orchestrator:handoff:request/respond` IPC, and resolve it late in the renderer where
`OfficeManager` and the per-agent session ops live. The handler is a thin orchestration
over the existing `ActOnDeps` operations (`deliverText`, `restartSession`, `bringOnline`)
plus the FR-020 orchestrator-identity guard and the FR-019 execution-time target
re-validation already implemented in `src/office/orchestratorActOn.ts`.

The orchestrator does **not** poll for the source's file write (FR-008); write→read
ordering is enforced by the pickup prompt's "read the doc first, retry if absent"
instruction (FR-007), which the target — a full Copilot session with file tools — honors.

**Part B — Bug fixes** (all orchestrator gating/bring-online/status):

- **B1 approval-timeout retry loop** — In `electron/teams/teamsService.ts`,
  `onApprovalTimeout` currently resolves the gate as a plain `deny`, which the model retries.
  Introduce a distinct **timeout/lapsed** disposition (vs. explicit user deny) carried
  through `respondPermission` → the orchestrator gate result, and give the timeout relay
  message + tool guidance a terminal "not approved — wait for the user" framing so the model
  stops instead of re-arming a new 5-min gate. Preserve the existing supersede path in
  `onPermissionRequestEvent` (single pending gate per agent).
- **B2 custom-office reserve `invalid-target`** — In `src/office/orchestratorCandidates.ts`,
  `computeBringOnlineCandidates` must derive idle-seated + reserve candidates from the
  **effective office roster** (honor `config.customAgents` / `config.customReserveAgents`,
  mirroring `isKnownDormantAgent` in `orchestratorActOn.ts`). Add a specific
  seat-unavailable message in `executeBringOnline` instead of generic `invalid-target`.
- **B3 deny-as-error** — Make an explicit user deny a first-class `outcome:'denied'` framed
  as a deliberate decision, and update the gated-tool descriptions in
  `electron/orchestrator/tools.ts` to instruct the orchestrator not to auto-retry a
  user-denied action. Keep timeout (B1) and deny (B3) distinguishable end-to-end.
- **B4 status-read accuracy** — Route the read-only status tools' roster resolution through
  the same custom-aware effective roster (shared with B2). B4's remaining "wrong read" is
  P3 and gated on a concrete repro (FR-B08) — do not block A/B1–B3 on it.

## Technical Context

**Language/Version**: TypeScript 5.x (strict), Node (Electron main) + browser (renderer)
**Primary Dependencies**: Electron, `@github/copilot-sdk` (`defineTool`), existing
orchestrator stack (spec 016/017), existing per-agent session ops (`warmAgentSession`,
submit-prompt, `terminalKill`/restart), reserve activation via `game.events`
**Storage**: Handoff documents are plain Markdown files under the source agent's working
directory (`./.copilot-handoffs/`); no new `.data/` store. Outcomes recorded in the
existing orchestrator transcript (spec 017).
**Testing**: Vitest unit suites under `tests/unit/orchestrator/**` (existing suites MUST
stay green); reuse the `ActOnDeps` mocking pattern from `sendPromptToAgent.test.ts` /
`bringOnlineExecute.test.ts` / `stopRestartAgent.test.ts`.
**Target Platform**: Electron desktop app (Windows-first dev; cross-platform runtime)
**Project Type**: Desktop app — Electron main + Phaser/DOM renderer, split by IPC
**Performance Goals**: The tool returns after delivering the two prompts + provisioning;
it does not block on the source's async write.
**Constraints**: Orchestrator session is ALWAYS gated (never consults `isYoloEnabled()`);
the handoff MUST re-validate office-qualified source/target at execution time and MUST NOT
target the synthetic orchestrator identity; MUST preserve real Copilot CLI session
semantics and the `agent-viewers.ts` dual-key invariants (no direct `activeAgentViewers`
mutation); TypeScript strictness preserved (no `any` across the IPC seam).
**Scale/Scope**: 1 new gated tool + 1 new `requestX`/`respondX` pair + 1 new
`orchestrator:handoff:*` IPC channel + 1 renderer resolver (`performHandoff` in
`orchestratorActOn.ts`) + `HandoffResult` type + unit coverage. No UI/panel changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Phaser-first constraint respected** — No new in-canvas renderer. Cross-agent target
  bring-online reuses the existing `game.events` reserve-spawn round-trip via `bringOnline`.
- [x] **Event-driven boundaries preserved** — New tool flows over a single new
  `orchestrator:handoff:request/respond` pair correlated by `requestId`, resolved in the
  renderer. No hidden cross-layer coupling; no new persistence port.
- [x] **Input focus transitions routed through `InputManager`** — Unchanged; no new
  keyboard capture path, no panel edits.
- [x] **Session lifecycle integrity maintained** — Reuses `restartSession` / `bringOnline` /
  `deliverText`; never mutates `activeAgentViewers` outside its helpers; refuses the
  orchestrator identity as source or target; same-agent handoff is a real restart, not a
  detach.
- [x] **Configuration-first approach used** — No hardcoded agent IDs; source/target resolve
  via `OfficeManager` + `src/config/agents.ts`; the tool registers through the existing
  typed orchestrator tool registry.
- [x] **Regression validation scope defined** — Unit coverage for every `HandoffResult`
  outcome across same-agent and cross-agent targets; existing orchestrator/Teams suites stay
  green; `npx tsc --noEmit` + targeted vitest + e2e smoke.

**Principle VI (xterm selection/clipboard):** No copy-path change; the orchestrator panel
is untouched.

**Principle VII (worktree-aware verification):** Builds `dist/electron/*.js` +
`dist/game.bundle.js`. Before claiming it works, confirm the launched bundle contains the
new `handoff_session` tool name.

**Result:** PASS — extends existing gating/IPC/act-on seams; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/021-orchestrator-handoff/
├── plan.md              # This file
├── spec.md              # Feature specification
└── contracts/
    └── orchestrator-handoff-tool.md   # handoff_session tool + IPC contract
```

### Source Code (repository root)

Brownfield extension — touches existing modules only:

```text
electron/
├── orchestrator/
│   ├── tools.ts                     # EXTEND: register handoff_session (gated);
│   │                                #         B3 — deny-no-retry guidance in gated-tool descriptions
│   ├── types.ts                     # EXTEND: HandoffArgs, HandoffResult, HandoffTarget;
│   │                                #         B1/B3 — timeout-vs-deny disposition on the gate result
│   ├── orchestratorSessionManager.ts# EXTEND: requestHandoff/respondHandoff round-trip;
│   │                                #         B1/B3 — thread timeout/deny disposition into the tool result
│   └── orchestratorIpc.ts           # EXTEND: orchestrator:handoff:request/respond channels
├── teams/
│   └── teamsService.ts              # B1 — onApprovalTimeout emits a terminal "lapsed" (not plain deny);
│                                    #      preserve onPermissionRequestEvent supersede path
└── terminal/
    └── preload.ts                   # EXTEND: expose the handoff invoke/on bridge

src/
├── office/
│   ├── orchestratorActOn.ts         # EXTEND: performHandoff() composing deliverText +
│   │                                #         restartSession/bringOnline + identity/target guards
│   ├── orchestratorCandidates.ts    # B2/B4 — derive candidates from the effective (custom-aware) roster
│   └── orchestratorExecute.ts       # B2 — specific seat-unavailable message vs generic invalid-target
└── main.ts                          # EXTEND: renderer resolver wiring for the handoff channel

tests/
└── unit/
    ├── orchestrator/
    │   ├── handoffSession.test.ts   # NEW: handoff outcome matrix (A)
    │   └── candidateSelection.test.ts # EXTEND: custom-roster candidates (B2/B4)
    └── teams/
        └── (approval relay tests)   # EXTEND: timeout-vs-deny signal (B1/B3), supersede-not-duplicate
```

**Structure Decision**: Single desktop-app codebase split by process. The main process
owns the SDK session, tool registry, and permission gate; the renderer owns `OfficeManager`
and the per-agent session ops. The handoff stays entirely within the established
`orchestrator:*` IPC contract and the `ActOnDeps` seam — no new top-level structure.

## Phased Delivery

- **Phase 0 — Research**: Confirm `deliverText` submit-prompt reliability for the
  doc-writing prompt on both backends (node-pty + ui-server), and confirm `restartSession`
  yields a genuinely fresh session (context reset) for the same identity/working dir.
  For Part B, confirm the SDK `PermissionRequestResult` shape can carry a timeout-vs-deny
  distinction (or add a wrapper disposition) without breaking the always-gated invariant.
- **Phase 1 — Contract + types**: Land `HandoffArgs`/`HandoffResult`/`HandoffTarget` in
  `types.ts` and the tool/IPC contract (`contracts/orchestrator-handoff-tool.md`). Add the
  B1/B3 gate-disposition type.
- **Phase 2 — Implementation**: (A) `performHandoff` in `orchestratorActOn.ts`; register
  `handoff_session`; wire the `requestHandoff`/`respondHandoff` round-trip + IPC + preload.
  (B) B1 timeout disposition in `teamsService`; B2 custom-roster candidates +
  seat-unavailable message; B3 deny framing + tool-description guidance; B4 status-tool
  roster routing.
- **Phase 3 — Tests + verification**: Handoff outcome matrix; Part B tests (timeout-vs-deny,
  custom-roster candidates, deny-no-retry); `tsc --noEmit`; `npm run test`; e2e smoke;
  worktree bundle-marker check.

## Complexity Tracking

> No Constitution Check violations — this feature composes existing gated act-on operations
> behind one new tool + one IPC round-trip. Nothing to justify.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_  | —          | —                                    |
