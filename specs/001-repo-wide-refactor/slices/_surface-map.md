# Repository Surface Map

Every file under `src/`, `electron/`, and `tests/` is assigned to exactly one slice owner per
SC-001. Top-level config files are assigned where ownership is clear.

## src/

| path | slice owner |
|------|-------------|
| `src/main.ts` | S1-A (focus wiring) + S1-C (terminal wiring) — coordinated touch |
| `src/config/agents.ts` | S2-E |
| `src/config/depths.ts` | S2-E |
| `src/config/meetingPrompt.ts` | S2-E |
| `src/config/notifications.ts` | S2-E |
| `src/config/playerCustomization.ts` | S2-E |
| `src/config/responsiveLayout.ts` | S2-E |
| `src/entities/NPC.ts` | S2-D |
| `src/entities/Player.ts` | S2-D |
| `src/input/InputManager.ts` | S1-A |
| `src/input/GameInputListener.ts` | S1-A |
| `src/input/TerminalInputListener.ts` | S1-A |
| `src/input/GlobalInputListener.ts` | S1-A |
| `src/layouts/index.ts` | S2-B |
| `src/layouts/types.ts` | S2-B |
| `src/layouts/default/DefaultClickHandler.ts` | S2-B |
| `src/layouts/default/DefaultDashboard.ts` | S2-B |
| `src/layouts/fleet/FleetClickHandler.ts` | S2-B |
| `src/layouts/fleet/FleetDashboard.ts` | S2-B |
| `src/meeting/fleetOrchestrator.ts` | S1-E |
| `src/meeting/fleetTracker.ts` | S1-E |
| `src/meeting/fleetVisualizer.ts` | S1-E |
| `src/meeting/planApproval.ts` | S1-E |
| `src/meeting/planParser.ts` | S1-E |
| `src/meeting/types.ts` | S1-E |
| `src/office/officeManager.ts` | S2-A |
| `src/scenes/BootScene.ts` | S1-B |
| `src/scenes/OfficeScene.ts` | S1-B |
| `src/scenes/MeetingScene.ts` | S1-B (shell) + S1-E (plan/approval interactions) |
| `src/sprites/DirectionalSprite.ts` | S2-D |
| `src/sprites/SpriteGenerator.ts` | S2-D |
| `src/ui/TerminalOverlay.ts` | S1-C |
| `src/ui/SeriousTerminalController.ts` | S1-C |
| `src/ui/FleetDashboard.ts` | S2-C |
| `src/ui/DialogBox.ts` | S2-C |
| `src/ui/NotificationService.ts` | S2-C |
| `src/ui/NotificationSettingsPanel.ts` | S2-C |
| `src/ui/SettingsPanel.ts` | S2-C |
| `src/ui/SpriteCustomizerPanel.ts` | S2-C |
| `src/ui/ToastNotification.ts` | S2-C |
| `src/ui/CameraDragController.ts` | S2-C |
| `src/ui/BasketballGame.ts` | S2-C |
| `src/ui/GalaxianGame.ts` | S2-C |
| `src/ui/PongGame.ts` | S2-C |

## electron/

| path | slice owner |
|------|-------------|
| `electron/main.ts` | S1-D (terminal IPC handlers) + S2-F (window/dev/non-terminal) — coordinated touch |
| `electron/cli-bridge.ts` | S2-F |
| `electron/terminal/event-source.ts` | S1-D |
| `electron/terminal/events-watcher.ts` | S1-D |
| `electron/terminal/ipc-relay.ts` | S1-D |
| `electron/terminal/preload.ts` | S1-D (paired with renderer in S1-C) |
| `electron/terminal/protocol.ts` | S1-D (paired with renderer in S1-C) |
| `electron/terminal/server.ts` | S1-D |
| `electron/terminal/terminal-backend.ts` | S1-D |

## tests/

| path | slice owner |
|------|-------------|
| `tests/e2e/electron-smoke.e2e.ts` | S2-G |
| `tests/factories/agent-factory.ts` | S2-G |
| `tests/factories/notification-factory.ts` | S2-G |
| `tests/factories/office-factory.ts` | S2-G |
| `tests/integration/main/main.test.ts` | S2-G (test logic) + S1-A/S1-C (when slices add coverage) |
| `tests/integration/terminal/TerminalOverlay.test.ts` | S2-G + S1-C |
| `tests/integration/terminal/SeriousTerminalController.test.ts` | S2-G + S1-C |
| `tests/setup/**` | S2-G |
| `tests/unit/config/*.test.ts` | S2-E (config) — kept here in test surface; co-edited with S2-G |
| `tests/unit/entities/*.test.ts` | S2-D |
| `tests/unit/input/*.test.ts` | S1-A |
| `tests/unit/office/officeManager.test.ts` | S2-A |
| `tests/unit/sprites/DirectionalSprite.test.ts` | S2-D |
| `tests/unit/ui/*.test.ts` | S2-C |

## Top-level config (informational; out of slice scope unless explicitly touched)

| path | notes |
|------|-------|
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts` | tooling — touched by S2-G if test scripts/config change; otherwise out of scope |
| `.github/instructions/**` | governance — updated by US3 slices |
| `.github/copilot-instructions.md` | governance — updated by US3 |
| `MeetingMode.md` | governance — updated by US3 (T071) |
| `.specify/**`, `specs/**` | spec kit artifacts — out of refactor scope |

## Coordinated-Touch Files

These files are touched by multiple slices and require sequencing or coordinated review:

- `src/main.ts` — S1-A (focus) + S1-C (terminal) + status-badge wiring. Sequence S1-A then S1-C
  to avoid merge conflicts.
- `src/scenes/MeetingScene.ts` — S1-B (scene shell) + S1-E (plan interactions). Land S1-B first.
- `electron/main.ts` — S1-D + S2-F. Land S1-D first.
- `electron/terminal/preload.ts` + `protocol.ts` — S1-C ↔ S1-D protocol pairing; must ship in a
  single coordinated change.
