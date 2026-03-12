# Player Sprite Color Customizer — Implementation Plan

## Problem
Players currently have a hardcoded appearance (dark blue suit, red tie, dark brown hair, peach skin). We want to add a 🎨 button to the top-right bar that opens a dropdown panel where players can customize their character's colors via preset swatches, with live preview and localStorage persistence.

## Codebase Context

This is a **Phaser 3 + Electron** 2D pixel-art RPG. Key architecture:
- **All sprites are procedural** — drawn via `Phaser.GameObjects.Graphics` in code, no external images
- **`src/sprites/SpriteGenerator.ts`** generates 12-frame spritesheets (4 directions × 3 walk frames, each 32×34px)
- **`src/sprites/DirectionalSprite.ts`** provides `registerWalkAnimations(anims, spriteKey)` to register walk anims per character
- **`src/scenes/BootScene.ts`** calls `generatePlayerSpritesheet(this)` during boot to create the `'player'` texture
- **`src/main.ts`** creates the DOM layout: top tabs bar (72px) | left panel (Phaser canvas) | right panel (terminal/dashboard) | bottom status bar
- **Top bar right side** already has: zoom controls, debug toggle (🐛), notification bell (🔔), BGM controls — new button goes here
- **DOM overlays** use z-index layering: status bar (100), toasts (9000), terminal (10000), sprite card (10001), notification settings (20000)
- **`src/ui/NotificationSettingsPanel.ts`** is the best reference for a DOM overlay panel (modal with dark theme, backdrop, escape-to-close)
- **`src/config/notifications.ts`** is the best reference for a config module (localStorage load/save with `structuredClone` + merge pattern)

### Player sprite color regions (currently hardcoded in `SpriteGenerator.ts`)
| Region | Used in | Hardcoded Value |
|--------|---------|-----------------|
| Hair | `drawPlayerDown/Up/Left` | `0x2a1a0a` |
| Skin (face, hands, ears) | all 3 draw functions | `0xffdbac` |
| Nose highlight (LEFT only) | `drawPlayerLeft` | `0xeec89a` (derived from skin — warmer/darker) |
| Eyes/Smile | all | `0x000000` (keep hardcoded) |
| Collar | DOWN, LEFT | `0xffffff` (keep hardcoded) |
| Suit/Jacket | all 3 draw functions | `0x1a2a4a` |
| Back seam (UP only) | `drawPlayerUp` | `0x141e38` (derived — `darken(suit)`) |
| Tie | `drawPlayerDown` | `0xcc2222` |
| Pants | all 3 draw functions | `0x1a1a2a` |
| Shoes | all 3 draw functions | `0x111111` |

The file already has a `darken(color)` helper that subtracts 30 from each RGB channel.

### NPC sprites already use parameterized colors via `HeroConfig`
```typescript
interface HeroConfig {
  skinColor: number; hairColor: number; hairStyle: string;
  helmetColor?: number; bodyColor: number; bodyStyle: string;
  accessory: string; accessoryColor: number;
}
```
This proves the pattern works. We just need to do the same for the player.

## Todos

### Todo 1: Create `src/config/playerCustomization.ts` (no dependencies) — ✅ DONE

**This file now exists** with all planned exports implemented:
- `PlayerColors` interface: `{ hair, skin, suit, tie, pants, shoes }` (all `number`)
- `DEFAULT_PLAYER_COLORS` — the current hardcoded values from SpriteGenerator
- `COLOR_REGION_LABELS`: display names (`hair→"Hair"`, `suit→"Jacket"`, etc.)
- `PLAYER_COLOR_PRESETS`: 8-9 curated hex swatches per region (hair: blonde→black; skin: inclusive range; suit: professional tones; etc.)
- `loadPlayerColors()` — reads localStorage `agencyOffice:playerColors`, merges with defaults
- `savePlayerColors(colors)` — writes to localStorage
- `resetPlayerColors()` — removes key, returns default clone

Uses `structuredClone` + try/catch pattern matching `src/config/notifications.ts`.

### Todo 2: Parameterize `src/sprites/SpriteGenerator.ts` (no dependencies)

**Goal:** Make `generatePlayerSpritesheet` accept optional `PlayerColors` and add a `regeneratePlayerSprite` helper.

**Changes:**
1. Import `PlayerColors` and `DEFAULT_PLAYER_COLORS` from `../config/playerCustomization`
2. Change signature: `generatePlayerSpritesheet(scene: Phaser.Scene, colors?: PlayerColors): void`
3. Default `colors` to `DEFAULT_PLAYER_COLORS` if not provided
4. Pass `colors` into `drawPlayerDown(d, ldy, rdy, colors)`, `drawPlayerUp(d, ldy, rdy, colors)`, `drawPlayerLeft(d, ldy, rdy, colors)`
5. In each draw function, replace hardcoded values:
   - `0x2a1a0a` → `colors.hair`
   - `0xffdbac` → `colors.skin` (face, hands, ears)
   - `0xeec89a` → `noseHighlight(colors.skin)` (new helper — see below)
   - `0x1a2a4a` → `colors.suit` (jacket, arm in LEFT view)
   - `0x141e38` → `darken(colors.suit)` (back seam in UP view)
   - `0xcc2222` → `colors.tie`
   - `0x1a1a2a` → `colors.pants`
   - `0x111111` → `colors.shoes`
   - Keep `0x000000` (eyes/smile) and `0xffffff` (collar) hardcoded
6. Add `noseHighlight` helper (slightly darker/warmer than base skin):
   ```typescript
   function noseHighlight(skin: number): number {
     const r = Math.max(0, ((skin >> 16) & 0xff) - 17);
     const g = Math.max(0, ((skin >> 8) & 0xff) - 19);
     const b = Math.max(0, (skin & 0xff) - 18);
     return (r << 16) | (g << 8) | b;
   }
   ```
7. Add exported `regeneratePlayerSprite`:
   ```typescript
   export function regeneratePlayerSprite(scene: Phaser.Scene, colors: PlayerColors): void {
     scene.textures.remove('player');
     generatePlayerSpritesheet(scene, colors);
     // Remove old animations and re-register
     for (const dir of ['down', 'left', 'right', 'up']) {
       const key = `player_walk_${dir}`;
       if (scene.anims.exists(key)) scene.anims.remove(key);
     }
     registerWalkAnimations(scene.anims, 'player');
   }
   ```
   Import `registerWalkAnimations` from `./DirectionalSprite`.

**Constraints:** Do NOT modify any NPC/Hero code, DrawCtx classes, finalizeSpritesheet, or WALK_LEGS.

### Todo 3: Create `src/ui/SpriteCustomizerPanel.ts` (depends on Todo 1)

**Goal:** DOM-based dropdown panel with color swatches for each body region, sprite preview, and reset button.

**Design:**
- **z-index: 15000** (above terminal 10000, below notification settings 20000)
- **Dropdown style** — fixed position, anchored below the 🎨 button, ~320px wide
- Does NOT need InputManager coordination (game stays active underneath, like a dropdown menu)
- Closes on: ✕ button, clicking outside, Escape key

**Class API:**
```typescript
export class SpriteCustomizerPanel {
  constructor(options: { onColorsChanged: (colors: PlayerColors) => void })
  show(anchorElement: HTMLElement): void   // position below anchor
  hide(): void
  toggle(anchorElement: HTMLElement): void
  isOpen(): boolean
  updatePreview(dataUrl: string): void     // called externally after sprite regen
  destroy(): void
}
```

**Internal state:** `currentColors: PlayerColors` initialized from `loadPlayerColors()` on construction.

**Panel layout:**
```
┌──────────────────────────┐
│ 🎨 Customize Player    ✕ │
├──────────────────────────┤
│   [sprite preview img]    │
├──────────────────────────┤
│ Hair                      │
│ ○ ○ ○ ● ○ ○ ○ ○ ○       │  (● = selected)
│ Skin                      │
│ ○ ● ○ ○ ○ ○ ○ ○ ○       │
│ Jacket                    │
│ ● ○ ○ ○ ○ ○ ○ ○ ○ ○     │
│ ... (Tie, Pants, Shoes)   │
├──────────────────────────┤
│ [Reset to Default]        │
└──────────────────────────┘
```

**Swatch behavior:**
- Each swatch: 28px circle, `border-radius: 50%`, `border: 2px solid #444`
- Selected: `border: 2px solid #4488ff`, `box-shadow: 0 0 8px #4488ff88`
- Hover: `border-color: #888`
- On click: update `currentColors[region]`, call `savePlayerColors(currentColors)`, call `onColorsChanged(currentColors)`, update visual selection

**Preview:** `<img>` with `image-rendering: pixelated`, ~128px wide. `updatePreview(dataUrl)` sets its `src`.

**Reset:** Calls `resetPlayerColors()`, resets `currentColors` to defaults, re-renders swatches, calls `onColorsChanged`.

**Styling** (match existing dark theme from `NotificationSettingsPanel`):
- Panel: `background: #1a1a2e`, `border: 2px solid #333`, `border-radius: 12px`, `padding: 20px`
- Font: `'Cascadia Code', Consolas, monospace`
- Text: `#dde`, section labels: `#889` at 12px
- Reset button: `background: #2a1a1a`, `border: 1px solid #633`, `color: #f88`

**Utility needed:**
```typescript
function hexToCSS(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}
```

**Imports from config:**
```typescript
import { type PlayerColors, DEFAULT_PLAYER_COLORS, PLAYER_COLOR_PRESETS, COLOR_REGION_LABELS, savePlayerColors, loadPlayerColors, resetPlayerColors } from '../config/playerCustomization';
```

### Todo 4: Wire `src/scenes/BootScene.ts` (depends on Todo 2)

**Goal:** Load saved player colors at boot.

**Changes:**
1. Import `loadPlayerColors` from `../config/playerCustomization`
2. Find the line calling `generatePlayerSpritesheet(this)` and change to `generatePlayerSpritesheet(this, loadPlayerColors())`

That's it — one import, one argument added.

### Todo 5: Wire `src/main.ts` — button + panel + regeneration (depends on Todos 2, 3)

**Goal:** Add the 🎨 button to the top bar and wire up the panel with live sprite regeneration.

**Changes:**

1. **Add 🎨 button to top bar** — insert before the zoom bar in the right-side area of `#office-tabs`. Follow existing button pattern:
   ```typescript
   const customizerBtn = document.createElement('div');
   customizerBtn.id = 'sprite-customizer-btn';
   customizerBtn.style.cssText = `
     padding: 8px 16px;
     background: #252538;
     border: 2px solid #444;
     border-radius: 6px;
     cursor: pointer;
     font-family: monospace;
     color: #666;
     font-size: 16px;
     user-select: none;
     transition: all 0.2s;
     margin-right: 8px;
   `;
   customizerBtn.textContent = '🎨';
   customizerBtn.title = 'Customize Player';
   ```

2. **Import and instantiate `SpriteCustomizerPanel`:**
   ```typescript
   import { SpriteCustomizerPanel } from './ui/SpriteCustomizerPanel';
   import { regeneratePlayerSprite } from './sprites/SpriteGenerator';
   ```

3. **Wire `onColorsChanged` callback:**
   ```typescript
   const customizerPanel = new SpriteCustomizerPanel({
     onColorsChanged: (colors) => {
       const scene = phaserGameRef?.scene.getScene('OfficeScene');
       if (scene) {
         regeneratePlayerSprite(scene, colors);
         // Update preview: extract first frame from regenerated spritesheet
         const base64 = scene.textures.getBase64('player');
         customizerPanel.updatePreview(base64);
       }
     },
   });
   ```

4. **Wire button click:**
   ```typescript
   customizerBtn.addEventListener('click', (e) => {
     e.stopPropagation();
     customizerPanel.toggle(customizerBtn);
   });
   ```

5. **Initial preview:** After Phaser game boots, extract player texture and call `updatePreview` so the preview is ready when the panel first opens.

**Key context for `main.ts` DOM structure:**
- The top bar (`#office-tabs`) is a flex container
- After office tabs, there's a `<div style="flex: 1;">` spacer that pushes everything after it to the right
- Right-side elements in order: zoom bar, debug toggle, notification bell, BGM controls
- Insert the 🎨 button as a child of `tabsBar`, after the spacer, before or near the zoom bar
- The `phaserGameRef` variable holds the Phaser.Game instance
- The active scene can be accessed via `phaserGameRef.scene.getScene('OfficeScene')`

### Todo 6: Build and verify (depends on Todos 4, 5)

Run `npm run build` and verify:
- No TypeScript errors
- Button appears in top bar
- Panel opens/closes correctly
- Color swatches change the player sprite live
- Colors persist across reload
- Reset button works
- Preview displays correctly

## Current Status

- **Todo 1** (Config): ✅ Done — `src/config/playerCustomization.ts` exists with all types, presets, and persistence
- **Todo 2** (SpriteGen parameterization): Pending
- **Todo 3** (UI Panel): Pending (depends on Todo 1 ✅)
- **Todo 4** (BootScene wiring): Pending (depends on Todo 2)
- **Todo 5** (main.ts button + panel): Pending (depends on Todos 2, 3)
- **Todo 6** (Build & verify): Pending (depends on Todo 5)

## Parallelization Strategy

```
Todo 1 (Config) ─────┬──→ Todo 3 (Panel UI) ──┐
                     │                         ├──→ Todo 5 (main.ts) ──→ Todo 6 (Build & Test)
Todo 2 (SpriteGen) ──┼──→ Todo 4 (BootScene) ──┘
                     │
                     └──→ Todo 5 (main.ts)
```

**Wave 1** (parallel): Todos 1 & 2
**Wave 2** (parallel, after Wave 1): Todos 3 & 4
**Wave 3** (after Wave 2): Todo 5
**Wave 4**: Todo 6

## Notes
- No new npm dependencies needed
- Player texture key `'player'` is stable — all animation refs use it
- Regenerating texture mid-game is safe: Phaser sprites auto-update when texture changes
- The `darken()` helper in SpriteGenerator correctly derives shading from new colors
- NPC sprites are unaffected (they use `generateHeroSpritesheet` with `HeroConfig`)
- The preview shows the full spritesheet scaled; cropping to a single frame is optional polish
