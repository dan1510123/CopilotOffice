# Dependency Risk Register

Schema matches `data-model.md` → `DependencyRisk` entity.

| risk_id | slice_id | description | severity | mitigation | status |
|---------|----------|-------------|----------|------------|--------|
| R-001 | S1-C, S1-D | Terminal renderer + PTY server changes must ship together; partial ship breaks `window.copilotBridge` contract. | high | Sequence S1-C and S1-D in one merged change; protocol + preload + server reviewed jointly. | open |
| R-002 | S1-E | Fleet session transfer relies on dual-key `activeAgentViewers` invariant in `electron/terminal/server.ts`. | high | Preserve invariant in S1-D; add regression spec under `tests/e2e/`. | open |
| R-003 | S1-B | Hardcoded agent IDs in scene/layout logic may exist beyond the documented pitfall. | medium | T021 audit must grep `src/scenes/**` and `src/layouts/**` for literal agent IDs. | open |
| R-004 | S1-A | Direct Phaser keyboard manipulation may exist outside `src/input/**`. | medium | T016 audit must search renderer for `keyboard.on`/`addKey` outside InputManager. | open |
| R-005 | S2-C | Overlay focus restoration is the recurring regression source per pitfall note. | medium | T050 must add explicit focus-restore tests for every overlay surface. | open |
| R-006 | All | Worktree `.specify/` missing `extensions.yml` — hook automation skipped silently. | low | Document in handoff; optionally sync extensions config later. | accepted |

## Severity Definitions

- **critical**: Blocks production behavior parity if unresolved.
- **high**: Breaks a P1 critical flow unless mitigated.
- **medium**: Likely regression risk needing targeted validation.
- **low**: Tracking only; no immediate mitigation required.

## Status Definitions

- **open**: Active risk, mitigation in progress or pending.
- **mitigated**: Risk addressed via slice work or test coverage.
- **accepted**: Residual risk acknowledged; no further action planned.
