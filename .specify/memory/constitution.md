<!--
Sync Impact Report
- Version change: template-placeholder -> 1.0.0
- Modified principles:
  - Template Principle 1 -> I. Phaser-First Rendering
  - Template Principle 2 -> II. Event-Driven Boundaries
  - Template Principle 3 -> III. Real-Agent Session Integrity
  - Template Principle 4 -> IV. Regression-Safe Delivery
  - Template Principle 5 -> V. Configuration-First Extensibility
- Added sections:
  - Technical Constraints & Invariants
  - Delivery Workflow & Review Gates
- Removed sections: None
- Templates requiring updates:
  - ✅ .specify/templates/plan-template.md
  - ✅ .specify/templates/spec-template.md
  - ✅ .specify/templates/tasks-template.md
  - ✅ .specify/templates/commands/*.md (no files present)
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

**Version**: 1.0.0 | **Ratified**: 2026-04-27 | **Last Amended**: 2026-04-27
