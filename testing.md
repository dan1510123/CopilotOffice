# AgencyOffice Testing Plan

## Goal

Add thorough automated backend and UI test coverage for the main AgencyOffice experience while explicitly excluding Meeting Mode and fleet features for now.

This plan focuses on the highest-value major features and use cases first, especially session/status tracking, office management, notifications, terminal UI behavior, and core input/gameplay behavior. Mock data should be used heavily so tests stay deterministic and fast.

## Current State

- There is currently no automated test framework or test suite in the repository.
- `package.json` has build and run scripts only; there are no test scripts or test dependencies.
- The current build baseline is healthy: `npm run build` succeeds.
- The codebase has a mix of:
  - pure or mostly-pure state logic that is straightforward to unit test
  - DOM/UI modules that are suitable for `jsdom` testing
  - Phaser/Electron-integrated modules that need focused mocks and a thinner integration strategy

## Recommended Test Stack

### Primary stack

- **Vitest**
  - main test runner
  - good TypeScript ergonomics
  - fast feedback loop
- **jsdom**
  - browser-like environment for DOM/UI tests
- **Testing Library**
  - behavior-oriented DOM assertions
- **`@vitest/coverage-v8`**
  - simple coverage reporting

### Electron end-to-end layer

- **Playwright**
  - used only for a thin Electron smoke suite
  - verifies top-level user flows that are difficult to trust through mocks alone

### Mocking strategy

Create reusable test doubles for:

- `window.copilotBridge`
- Phaser scene/input/physics/tweens surfaces
- xterm APIs used by `TerminalOverlay`
- `ResizeObserver`
- `localStorage`
- timers and delayed focus helpers

## Why This Stack

- Vitest fits the current TypeScript setup well and keeps the main suite fast.
- Most of the value in this app comes from state management and UI behavior rather than deep rendering assertions.
- Playwright should be reserved for a small number of realistic end-user smoke tests, not the whole test surface.

## Test Phases

### Phase 1: test harness and pure logic

Set up the tooling and cover the most stable logic first.

Targets:

- `src/office/officeManager.ts`
  - office CRUD
  - switching active office
  - persistence load/save behavior
  - agent status transition rules
  - unread count/task summary/session-related state updates
- `src/config/notifications.ts`
  - default config loading
  - merge behavior with partial persisted settings
- `src/config/playerCustomization.ts`
  - load/save/reset
  - fallback to defaults
- `src/sprites/DirectionalSprite.ts`
  - frame selection helpers
  - direction resolution from velocity
  - animation key helpers
- `src/ui/NotificationService.ts`
  - dedupe behavior
  - formatting
  - routing boundaries through mocks

### Phase 2: DOM/UI module tests

Cover the major UI behavior with `jsdom`.

Targets:

- `src/ui/ToastNotification.ts`
  - queueing
  - rate limiting
  - auto-dismiss timing
  - max visible toast behavior
- `src/ui/NotificationSettingsPanel.ts`
  - rendering from saved settings
  - toggling settings
  - persistence behavior
- `src/input/TerminalInputListener.ts`
  - F10
  - Ctrl+Shift+N
  - Ctrl+F
  - propagation suppression rules
- `src/input/GlobalInputListener.ts`
  - reload shortcut interception
  - non-blocking observation of normal keys
- `src/input/InputManager.ts`
  - game/terminal mode switching
  - idempotency
  - terminal focus helpers

### Phase 3: mock-backed integration tests for major flows

Focus on the main office experience without involving Meeting Mode or fleet.

Targets:

- `src/main.ts`
  - initial DOM layout
  - office tab rendering
  - dashboard vs terminal panel switching
  - bridge wiring through mocked `window.copilotBridge`
- `src/ui/TerminalOverlay.ts`
  - show/hide lifecycle
  - session metadata rendering
  - fullscreen state persistence
  - attach/detach behavior through mocks
  - focus coordination
- `src/office/officeManager.ts` + `src/main.ts`
  - create office
  - switch office
  - delete office
- notification pipeline
  - mocked agent events to visible toast behavior

### Phase 4: selective gameplay behavior tests

Keep this focused and avoid trying to fully simulate Phaser scenes.

Targets:

- `src/entities/Player.ts`
  - movement enable/disable
  - sprint behavior
  - idle vs walking animation decisions
- `src/entities/NPC.ts`
  - status badge updates
  - highlight/open-terminal visual state changes
  - destroy cleanup
- `src/ui/CameraDragController.ts`
  - click vs drag threshold
  - clamping
  - lerp-back behavior

### Phase 5: Playwright Electron smoke tests

Use Playwright for a very small number of top-level critical flows.

Targets:

- app boots into the default office successfully
- office tabs render and office switching works
- opening an agent terminal shows the terminal UI
- closing the terminal restores the expected focus/state
- mocked notification activity produces visible feedback
- persisted UI preferences survive reload where practical

## Major Use Cases to Cover

### 1. Session and status tracking

This is the top priority and should use mock data extensively.

Scenarios:

- a new office starts with the expected default agent states
- an agent progresses through typical states:
  - `slacking -> starting -> ready -> thinking -> waiting -> ready`
- invalid transitions preserve current compatibility behavior
- unread counts increase on incoming activity
- unread counts clear when the relevant agent terminal is opened
- tool/task summary fields update correctly
- session metadata updates persist correctly
- session exit/error resets visible state appropriately

### 2. Office management

Scenarios:

- create office
- switch between offices
- delete current or non-current office
- office persistence reload restores config correctly
- transient state does not leak across offices

### 3. Notifications

Scenarios:

- turn start / turn end / tool start / tool complete produce the expected output
- duplicate events inside the dedupe window are suppressed
- disabled notification types do not render
- burst activity respects toast rate limiting

### 4. Terminal UI behavior

Scenarios:

- opening an agent terminal shows the expected UI state
- closing the terminal returns focus to the game
- fullscreen preference persists
- terminal-only shortcuts work only in terminal focus
- terminal exit/error states surface correctly

### 5. Input behavior

Scenarios:

- game focus enables game controls and disables terminal shortcuts
- terminal focus disables game controls and enables terminal shortcuts
- F10 closes the terminal while visible
- global reload shortcuts continue to work correctly

### 6. Basic gameplay/UI behavior

Scenarios:

- player movement maps to expected directional animation behavior
- NPC status badges reflect agent state changes
- camera drag distinguishes click from drag

## Recommended Test Layout

```text
tests/
  setup/
    vitest.setup.ts
    browser-mocks.ts
    phaser-mocks.ts
    copilot-bridge-mock.ts
    xterm-mock.ts
  unit/
    config/
    office/
    sprites/
    ui/
    input/
  integration/
    main/
    terminal/
    notifications/
    office/
    gameplay/
  e2e/
    electron/
```

## Implementation Notes

- Exclude `src/meeting/**` and fleet-specific flows from the initial scope.
- Prefer factory helpers for mock office data, agent status payloads, and Copilot event payloads.
- Use fake timers for delayed focus, notification dismissal, and debounce logic.
- Keep Electron E2E deterministic by running against mocked bridge/data where possible rather than live Copilot/PTY behavior.
- Keep the Playwright suite intentionally small; the detailed assertions should live in Vitest.

## Deliverables

1. Test tooling and scripts added to the repo
2. Shared mocks and setup utilities
3. Unit tests for pure state/config modules
4. DOM/UI tests for major overlays and input behavior
5. Integration tests for office/session/status flows
6. Selective gameplay behavior tests
7. Playwright Electron smoke tests
8. Test documentation and coverage guidance
