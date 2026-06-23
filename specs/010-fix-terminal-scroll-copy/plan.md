# Implementation Plan: Fix Terminal Scrolling & Scrollbar Copy Interference

**Branch**: `010-fix-terminal-scroll-copy` | **Date**: 2026-06-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/010-fix-terminal-scroll-copy/spec.md`

## Summary

Fix two related terminal bugs: (1) scrolling is broken because the `.xterm-viewport` in `TerminalOverlay` never receives `overflow-y: auto` and the shared `xterm-styles` element race means only one surface's styles win; (2) the native browser scrollbar leaks content into `window.getSelection()` which corrupts clipboard copies. The fix unifies the `xterm-styles` injection into a single shared module, ensures `overflow-y: auto` on `.xterm-viewport` for both surfaces, and hides the native scrollbar via CSS (`::-webkit-scrollbar` + `scrollbar-width: none`) so it cannot pollute text selections while preserving programmatic scroll.

## Technical Context

**Language/Version**: TypeScript 5 (strict), targeting Electron 40 (Chromium renderer)  
**Primary Dependencies**: xterm.js 5.5 (terminal), FitAddon, Phaser 3 (game canvas — untouched)  
**Storage**: N/A (no persistence changes)  
**Testing**: vitest (`tests/unit/**`) + Playwright (`tests/e2e/**`)  
**Target Platform**: Electron 40 desktop (Windows-primary, cross-platform)  
**Project Type**: Desktop app — renderer-process CSS/DOM scope only  
**Performance Goals**: Smooth 60fps scroll through 10,000-line scrollback  
**Constraints**: Must not regress any clipboard behavior per Constitution VI; both terminal surfaces updated in same change per Constitution VI rule 4  
**Scale/Scope**: Two files modified (`TerminalOverlay.ts`, `SeriousTerminalController.ts`), one new shared module extracted

## Constitution Check

*GATE: Must pass before implementation.*

- [x] **Phaser-first constraint respected** — all changes are in DOM overlays (terminal containers). No Phaser canvas or scene changes.
- [x] **Event-driven boundaries preserved** — no new events, no cross-layer coupling. Scroll is handled internally by xterm.js. Clipboard events unchanged.
- [x] **Input focus transitions routed through `InputManager`** — no focus changes. Scroll does not affect focus state.
- [x] **Session lifecycle integrity maintained** — no PTY, IPC, or session attach/detach changes.
- [x] **Configuration-first approach used** — no new config. CSS-only fix within existing terminal setup code.
- [x] **Regression validation scope defined** — run full test suite; manual verification of scroll + clipboard in both terminal surfaces.

## Root Cause Analysis

### Bug A: Scroll broken

**Direct cause**: The element xterm.js opens into (`this.terminalDiv` in TerminalOverlay, `this.terminalDivEl` in SeriousTerminalController) has `overflow: hidden` set inline (line 746/140 respectively). xterm.js creates its own `.xterm-viewport` child with `overflow-y: scroll` as a default, but the parent's `overflow: hidden` clips the viewport's scroll area.

Additionally, a style injection race exists:
- `TerminalOverlay.injectStyles()` (line 1194): creates `<style id="xterm-styles">` with NO `overflow-y` rule on `.xterm-viewport`.
- `SeriousTerminalController.ensureXtermStyles()` (line 910): creates `<style id="xterm-styles">` WITH `.xterm-viewport { overflow-y: auto !important; }`.
- Both check `if (document.getElementById('xterm-styles')) return;` — whichever runs first wins. If TerminalOverlay runs first, the serious-mode scroll fix never applies.

**Fix**: 
1. Extract shared xterm styles into a single module that both surfaces import.
2. Include `overflow-y: auto !important` for `.xterm-viewport` in the shared styles.
3. Remove `overflow: hidden` from the inner terminal div (the element xterm opens into). Keep `overflow: hidden` on the outer wrapper which provides padding/flex layout — xterm's viewport handles its own scroll clipping.

### Bug B: Scrollbar leaks into clipboard

**Direct cause**: The native Chromium scrollbar rendered inside `.xterm-viewport` (visible as a bar on the right side) participates in DOM text selection. When the user drags to select near the right edge, `window.getSelection()` can include nodes adjacent to the scrollbar. The Constitution VI copy cascade falls through to `window.getSelection().toString()` when `cachedSelection` and `terminal.getSelection()` are empty (e.g., after certain drag interactions on the accessibility layer).

**Fix**: Hide the native scrollbar entirely via CSS while preserving scroll functionality:
```css
.xterm-viewport::-webkit-scrollbar { width: 0; height: 0; }
.xterm-viewport { scrollbar-width: none; }
```
This removes the scrollbar from the rendering tree so it cannot participate in selection. xterm's scroll still works via `wheel` events and programmatic `scrollTop` manipulation.

## Project Structure

### Documentation (this feature)

```text
specs/010-fix-terminal-scroll-copy/
├── spec.md              # Pre-existing — problem statement + acceptance criteria
└── plan.md              # This file
```

### Source Code (repository root)

```text
src/
├── ui/
│   ├── xtermStyles.ts                 # NEW — shared xterm CSS injection (single source of truth)
│   ├── TerminalOverlay.ts             # MODIFY — replace injectStyles() with import from xtermStyles
│   └── SeriousTerminalController.ts   # MODIFY — replace ensureXtermStyles() with import from xtermStyles
└── [no other files touched]

tests/
├── unit/
│   └── ui/xtermStyles.test.ts         # NEW — verify style content + idempotent injection
└── e2e/
    └── [existing tests — verify no regression]
```

**Structure Decision**: Minimal extraction — one new ~30-line module (`xtermStyles.ts`) that both terminal surfaces call. No new directories needed.

## Implementation Phases

### Phase 1: Extract shared xterm styles module

Create `src/ui/xtermStyles.ts`:
```typescript
// Shared xterm.js CSS injection — single source of truth for both
// TerminalOverlay and SeriousTerminalController.
// Constitution VI rule 4: both surfaces must be updated in the same change.

const STYLE_ID = 'copilot-office-xterm-styles';

export function ensureXtermStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .xterm { height: 100%; }
    .xterm-viewport {
      overflow-y: auto !important;
      scrollbar-width: none;
    }
    .xterm-viewport::-webkit-scrollbar {
      width: 0;
      height: 0;
    }
    #terminal-container .xterm { height: 100%; }
    #serious-terminal-container .xterm { height: 100%; }
  `;
  document.head.appendChild(style);
}
```

### Phase 2: Update TerminalOverlay

1. Replace `injectStyles()` body with a call to the shared `ensureXtermStyles()`.
2. Change the inner terminal div (`this.terminalDiv`) from `overflow: hidden` to `overflow: visible` (or remove the overflow property entirely — xterm manages its own viewport clipping).
3. Remove the old `.xterm-viewport { background-color: ... }` rule if it conflicts, or move it to the shared module.

### Phase 3: Update SeriousTerminalController

1. Replace `ensureXtermStyles()` body with a call to the shared `ensureXtermStyles()`.
2. Change `this.terminalDivEl` from `overflow: hidden` to remove the overflow restriction.
3. Keep the xterm background color override if needed (can go in shared module).

### Phase 4: Verify clipboard integrity

- Run existing clipboard unit tests.
- Manually verify:
  - `cachedSelection` path still works (Ctrl+C with xterm selection).
  - `window.getSelection()` fallback path no longer picks up scrollbar artifacts.
  - Context menu Copy/Paste works in both surfaces.
  - Toast messages appear correctly.

### Phase 5: Test

- `npm run test` — all unit tests pass.
- `npm run test:e2e` — all e2e tests pass.
- Manual scroll verification in both terminal modes.
- Manual clipboard verification near the right edge of terminal.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Removing `overflow: hidden` from inner div causes xterm content to visually bleed past container boundary | Low | Medium | The outer wrapper still has `overflow: hidden` + padding. xterm's own `.xterm` div constrains rendering. |
| Hiding scrollbar removes scroll affordance for users who expect a visible track | Low | Low | xterm.js supports mouse wheel and trackpad scroll natively. Most modern terminals hide scrollbars (iTerm2, Windows Terminal). |
| Style element ID change (`xterm-styles` → `copilot-office-xterm-styles`) orphans old elements on hot reload | Low | Low | Old element from a previous dev session won't conflict — the new one just adds alongside. Clear on full reload. |
| xterm.js `background-color` on `.xterm-viewport` was set for visual reasons; removing it causes flash of wrong color | Low | Low | Move the background override into the shared module rather than removing it. |

## Complexity Tracking

No constitution violations. No new complexity introduced — this is a net simplification (two competing style injectors → one shared module).
