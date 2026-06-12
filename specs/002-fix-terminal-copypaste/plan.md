# Implementation Plan: Fix Terminal Copy/Paste

**Branch**: `002-fix-terminal-copypaste` | **Date**: 2026-06-12 | **Spec**: `specs/002-fix-terminal-copypaste/spec.md`
**Input**: Feature specification from `/specs/002-fix-terminal-copypaste/spec.md`

## Summary

Upgrade xterm.js from 5.5.0 → 6.0.0 (addon-fit 0.10.0 → 0.11.0) and replace the indirect copy event listener architecture with direct `hasSelection()`/`getSelection()` calls inside the custom key handler. The current approach defers Ctrl+C handling to a native `copy` event listener attached to the terminal div, creating a two-hop path where the key handler returns `true` → native copy event fires → listener queries selection. With xterm 5.5.0's stale `hasSelection()` bug on canvas renderer, this pattern fails. The fix consolidates clipboard operations directly into `attachCustomKeyEventHandler`, eliminating the separate copy listener infrastructure.

## Technical Context

**Language/Version**: TypeScript (strict) with Electron 40+  
**Primary Dependencies**: @xterm/xterm ^5.5.0 → ^6.0.0, @xterm/addon-fit ^0.10.0 → ^0.11.0, Phaser 3  
**Storage**: N/A (no persistence changes)  
**Testing**: Vitest (unit + integration tests exist for both terminal controllers)  
**Target Platform**: Electron desktop (Windows, macOS, Linux)  
**Project Type**: Desktop application (Electron + Phaser game)  
**Performance Goals**: Copy/paste latency <100ms from keypress to clipboard write  
**Constraints**: Must not break terminal rendering, scrolling, input, or session lifecycle  
**Scale/Scope**: Two terminal controllers (TerminalOverlay + SeriousTerminalController), ~100 lines changed per controller

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Phaser-first constraint respected — no canvas renderer changes; terminal is DOM overlay
- [x] Event-driven boundaries preserved — keyboard events still flow through registered xterm handler; no new cross-layer coupling
- [x] Input focus transitions routed through `InputManager` — terminal focus model unchanged
- [x] Session lifecycle integrity maintained — PTY pipeline unmodified; only pre-PTY keyboard interception changes
- [x] Configuration-first approach — no new configuration surface; code simplification only
- [x] Regression validation scope defined — existing clipboard tests updated; manual verification across office switches and fleet/meeting modes required

## Project Structure

### Documentation (this feature)

```text
specs/002-fix-terminal-copypaste/
├── plan.md              # This file
├── research.md          # Phase 0: xterm 6.0 migration research
├── data-model.md        # Phase 1: clipboard data flow model
├── quickstart.md        # Phase 1: developer quickstart
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (affected files)

```text
src/ui/
├── TerminalOverlay.ts           # Primary terminal (Phaser mode) — key handler + copy listener
└── SeriousTerminalController.ts # Secondary terminal (serious mode) — key handler + copy listener

tests/
├── integration/terminal/
│   ├── TerminalOverlay.test.ts
│   └── SeriousTerminalController.test.ts
└── setup/
    └── xterm-mock.ts

package.json                     # Dependency version bump
```

**Structure Decision**: Existing single-project layout. Changes are localized to two UI controllers, their tests, and package.json.

## Complexity Tracking

> No constitution violations. This is a simplification that removes code.
