<!--
Sync Impact Report
- Version change: 1.1.0 -> 1.2.0
- Modified principles: None
- Added sections:
  - VII. Worktree-Aware Verification Discipline (new principle)
- Removed sections: None
- Templates requiring updates: None
- Follow-up TODOs: None
-->
# Copilot Office Constitution

## Core Principles

### I. Phaser-First Rendering
Phaser 3 MUST remain the sole in-canvas renderer. Visual gameplay behavior MUST be implemented
through Phaser scenes/entities/sprites, while DOM usage is limited to overlays and shell UI
containers that are already part of the split layout model. This prevents rendering divergence
and keeps frame behavior deterministic.

### II. Event-Driven Boundaries
Renderer and DOM coordination MUST flow through explicit events (for example, `game.events`)
and documented IPC channels; direct hidden coupling across layers is not allowed. Input focus
transitions MUST pass through `InputManager` rather than ad hoc keyboard handling. This keeps
interactive state transitions inspectable and prevents focus regressions.

### III. Real-Agent Session Integrity
Agent interactions MUST preserve real Copilot CLI session semantics end-to-end (renderer ->
preload bridge -> Electron main -> terminal server -> PTY). Changes to terminal/session
lifecycle MUST preserve event forwarding and session continuity across office switches and
meeting/fleet transitions. This protects the core product promise of authentic multi-agent
terminal orchestration.

### IV. Regression-Safe Delivery
Changes MUST include verification at the smallest useful scope and MUST run existing repository
test scripts before merge for impacted areas. Bug fixes in high-risk flows (terminal lifecycle,
fleet orchestration, input focus, office switching) MUST include tests or explicit guard logic
that prevents recurrence. This ensures quality as interactive complexity grows.

### V. Configuration-First Extensibility
Agent rosters, layouts, feature flags, and notification behavior MUST be driven by typed
configuration rather than hardcoded scene logic. New NPCs, office variants, and optional
features SHOULD be added by extending config and existing registries before introducing new
special-case code paths. This keeps expansion predictable and minimizes brittle branching.

### VI. xterm.js Selection & Clipboard Discipline
Terminal selection lives in **two independent places** that MUST both be honored on every
copy path: (a) xterm's internal selection (`terminal.getSelection()` / `onSelectionChange`),
populated when the user drags using xterm's mouse handlers; and (b) the browser's DOM
selection (`window.getSelection()`), populated when the user drags over xterm's accessibility
text layer (`xterm-accessibility` div) or any other rendered DOM text inside the terminal
container. Either source can be non-empty while the other is empty, and **which one the user
hits depends on subtle factors** (renderer choice, screen-reader mode, focus, drag origin) —
so code MUST NOT assume one is authoritative.

Mandatory rules for any code that copies from the terminal:
1. Selection lookups MUST cascade `cachedSelection` → `terminal.getSelection()` →
   `window.getSelection().toString()` scoped to the terminal container (anchor or focus node
   inside the terminal element). Never stop at xterm's selection alone.
2. Any `document`-level `copy` event preempt added to beat browser races MUST populate
   `event.clipboardData.setData('text/plain', text)` with our best-effort selection BEFORE
   calling `preventDefault()`. A bare `preventDefault()` silently destroys valid DOM
   selections the user can see highlighted on screen and is forbidden.
3. Every clipboard write path MUST emit a user-visible diagnostic toast with an instance tag
   (`[O0]`, `[S0]`, etc.) covering success, empty selection, verify-fail, and bridge-error
   outcomes. Silent clipboard failures are a Principle IV violation and a recurring
   regression vector.
4. Clipboard plumbing changes MUST mirror across both `TerminalOverlay` and
   `SeriousTerminalController` in the same change; divergence between the two surfaces has
   produced shipped regressions repeatedly (specs 002, 004, 005, 006, 008).

This principle exists because the same class of clipboard bug has recurred across five
specs. Treat it as a required regression checklist for every terminal change.

### VII. Worktree-Aware Verification Discipline
This repository commonly uses git worktrees for parallel feature work
(`CopilotOffice-worktree-*` siblings of the main checkout). The Phaser bundle
(`dist/game.bundle.js`) and the Electron main/preload bundles
(`dist/electron/*.js`) are **per-worktree build artifacts** that are NOT shared
between worktrees. A fix committed inside one worktree's branch produces a new
`dist/` only inside that worktree. The main checkout (or any other worktree)
keeps its own stale `dist/` until it is rebuilt against the same code.

This has caused a "fix doesn't fix it" regression once: clipboard fixes shipped
in spec 008 on a worktree branch, but the user kept running `npm start` from
the main checkout, whose `dist/` was rebuilt from older uncommitted hand-fixes.
Three consecutive rounds of "still broken" reports were caused entirely by
running the wrong bundle, not by any code defect.

Mandatory rules:
1. Before claiming a fix works, the agent MUST confirm the path the user is
   actually launching from. Acceptable evidence: matching timestamps on
   `dist/game.bundle.js` AND a `grep`/`Select-String` for a distinctive marker
   from the new code (e.g., a new toast string, a new symbol name) in the
   bundle the user is running.
2. When making changes inside a worktree, the agent SHOULD warn explicitly
   that those changes are only live in that worktree's `dist/`, and either
   (a) offer to merge the branch into the user's primary checkout, or
   (b) tell the user the exact path they must `cd` into to verify the fix.
3. Constitution-level fixes (new principles, version bumps, instructions
   under `.github/`) MUST land in the primary checkout (typically `main`),
   not only in a feature worktree, or they will not influence future work in
   any other worktree.
4. When debugging "still broken" reports following a shipped fix, the FIRST
   investigation step MUST be to confirm the user is running the rebuilt
   bundle (timestamps + distinctive-symbol grep). Skipping this step risks
   chasing phantom code paths in code the user is not running.

## Technical Constraints & Invariants

- TypeScript strictness MUST be preserved; avoid `any` and unsafe casts unless a typed boundary
  is impossible and justified inline.
- Procedural sprite generation is the default asset model; external sprite assets require explicit
  architectural justification.
- Depth ordering MUST use shared depth constants and y-sort helpers where applicable.
- Multi-office state management MUST remain data-driven and separate from rendering concerns.
- Error handling MUST surface failures through established channels; silent failure paths are not
  acceptable in agent lifecycle, IPC, or persistence flows.

## Delivery Workflow & Review Gates

- Implementations MUST align with repository guidance in `.github/copilot-instructions.md` and
  applicable scoped instruction files under `.github/instructions/`.
- Work MUST remain minimal in blast radius: touch only relevant files while fully wiring all
  affected behavior surfaces.
- For behavior changes, reviews MUST confirm parity across default office and fleet/meeting modes
  when those flows are impacted.
- Documentation updates are REQUIRED when architecture, controls, configuration, or operator
  workflows change.
- Temporary or deferred decisions MUST be recorded explicitly in the relevant design artifacts.

## Governance

This constitution is the highest-priority engineering policy for this repository. In conflicts,
this document overrides ad hoc local practices.

Amendment process:
1. Propose a change with explicit rationale and affected principles/sections.
2. Update dependent templates and guidance docs in the same change when required.
3. Record a Sync Impact Report at the top of this constitution describing propagation status.
4. Obtain maintainer approval before merge.

Versioning policy:
- MAJOR: Backward-incompatible governance changes, principle removals, or principle
  redefinitions that alter expected development behavior.
- MINOR: New principle/section or materially expanded mandatory guidance.
- PATCH: Clarifications, wording improvements, and non-semantic refinements.

Compliance review expectations:
- Every plan/spec/tasks artifact MUST include constitution alignment checks.
- Code reviews MUST verify touched areas satisfy applicable principles.
- Non-compliance MUST be resolved before merge or explicitly waived by maintainers with
  documented justification.

**Version**: 1.2.0 | **Ratified**: 2026-04-27 | **Last Amended**: 2026-06-11
