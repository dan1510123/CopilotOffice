# Dependency Risk Register

Schema matches `data-model.md` → `DependencyRisk` entity.

| risk_id | slice_id | description | severity | mitigation | status |
|---------|----------|-------------|----------|------------|--------|
| R-001 | S1-C, S1-D | Terminal renderer + PTY server changes must ship together; partial ship breaks `window.copilotBridge` contract. | high | Sequence S1-C and S1-D in one merged change; protocol + preload + server reviewed jointly. | mitigated |
| R-002 | S1-E | Fleet session transfer relies on dual-key `activeAgentViewers` invariant in `electron/terminal/server.ts`. | high | Invariant extracted into `electron/terminal/agent-viewers.ts` with documented `addAgentViewer` / `removeAgentViewer` / `hasActiveViewer` contract; covered by `tests/unit/terminal/agentViewers.test.ts` (9 cases incl. attach/detach round-trip and alias forward lookup). | mitigated |
| R-003 | S1-B | Hardcoded agent IDs in scene/layout logic may exist beyond the documented pitfall. | medium | T021 audit must grep `src/scenes/**` and `src/layouts/**` for literal agent IDs. | mitigated |
| R-004 | S1-A | Direct Phaser keyboard manipulation may exist outside `src/input/**`. | medium | T016 audit partially performed; renderer entities/scenes use the gated keyboard contract for their own key registrations. Residual risk: untested combinations. Deferred to a follow-up audit. | open |
| R-005 | S2-C | Overlay focus restoration is the recurring regression source per pitfall note. | medium | NotificationSettingsPanel now exposes onOpen/onClose hooks mirroring SettingsPanel + SpriteCustomizerPanel; OverlayFocusRestore.test.ts covers Settings + SpriteCustomizer + NotificationSettings surfaces. | mitigated |
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
