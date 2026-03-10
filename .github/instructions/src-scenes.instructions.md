---
applyTo: "src/scenes/**"
---

# Scenes — Phaser 3 Scene Layer

See the root `copilot-instructions.md` for full project context.

## Purpose

This directory contains Phaser 3 scenes that make up the game's visual layer:

- **BootScene** — Procedural asset generation and loading. Runs first, then transitions to OfficeScene.
- **OfficeScene** — Main gameplay: office layout, NPCs, player movement, interactions, mini-games.
- **MeetingScene** — Private meeting room with Arthur (architect). Handles plan parsing, approval, and revision loops.

## Scene Lifecycle

Phaser scenes follow `preload()` → `create()` → `update()`:

1. `BootScene.create()` generates all sprites procedurally, then calls `scene.start('OfficeScene')`.
2. `OfficeScene.create()` builds the tile grid, places furniture/NPCs, wires events. `update()` runs every frame for movement, proximity checks, and y-depth sorting.
3. `MeetingScene` is launched from OfficeScene. On exit, it stops itself and wakes OfficeScene with optional plan data.

## BootScene Patterns

- **All sprites are procedural** — generated via Phaser Graphics and `SpriteGenerator`. No external image files.
- Character spritesheets use `generatePlayerSpritesheet()` / `generateHeroSpritesheet()` with 4 directions × 3 walk frames.
- Named NPC sprites (e.g. `npc_generalist`, `npc_architect`) are generated with customizable skin/hair/body/accessory colors.
- Furniture, props, and meeting room items are all drawn inline with `Graphics` primitives.
- After generation, `scene.start('OfficeScene')` transitions to gameplay.

## OfficeScene Patterns

- **Tile grid**: 20×12 tiles, 64px default tile size (scales 48–64px based on screen).
- **Feature flags** at top of file control optional content:
  ```ts
  const ENABLE_PING_PONG = false;
  const ENABLE_DECORATIONS = false;
  const ENABLE_BASKETBALL = false;
  ```
- **NPCs** created from `AGENTS` array in `src/config/agents.ts`. Each gets a desk, laptop, and status badge.
- **Player** instantiated with collision against walls, furniture, and NPCs.
- **`createOfficeLayout()`** places all floor tiles, walls, doors, desks, and decorative items.
- **Exit system**: Player walks off-screen downward to leave; re-enters via Space/Enter.
- **Y-depth sorting**: Every frame updates depth for player and NPCs via `ySortDepth()` from `src/config/depths.ts`.
- **Wake handler**: Listens for `wake` event to resume from MeetingScene with plan data and trigger agent walk-in animations.

## MeetingScene Patterns

- Small 6×5 tile room (zoom 3×) with Arthur and the player seated at a meeting table.
- Arthur's terminal auto-opens; terminal output is buffered and checked for plans (500ms debounce).
- `parsePlanFromOutput()` extracts structured `MeetingPlan` data from terminal output.
- `PlanApprovalOverlay` lets the player approve, revise (sends feedback back to Arthur's terminal), or cancel.
- Exit choreography: player walks to door → Arthur follows → camera fade → `scene.stop()` + `scene.wake('OfficeScene', { plan })`.

## Event Communication

Scenes communicate with DOM via `game.events`. Key events:

| Event | Direction | Purpose |
|-------|-----------|---------|
| `agent:interact` | Scene→DOM | Player started talking to an NPC |
| `terminal:open` / `terminal:close` | DOM→Scene | Disable/enable player movement |
| `office:switch` | DOM→Scene | User switched office tab |
| `open:agent:terminal` | DOM→Scene | Dashboard requests opening an agent terminal |
| `agent:status:changed` | Both | NPC badge updates |
| `agent:tool:start` | DOM→Scene | NPC tool activity indicator |
| `npc:highlight` / `npc:clear-highlight` | DOM→Scene | Visual feedback for active terminal |
| `game:panel:clicked` | DOM→Scene | Blur terminal, return focus to game |
| `bgm:volume` / `bgm:mute` | DOM→Scene | Audio control from settings |

## Key Rules

1. **Phaser is the sole renderer** — never add DOM rendering logic inside scenes.
2. **Use `Depths.*` constants** from `src/config/depths.ts` for all z-ordering. Use `ySortDepth()` for objects that need perspective-correct depth.
3. **Feature flags** for optional content — add new flags at the top of `OfficeScene.ts`.
4. **All focus transitions** go through `InputManager` — never enable/disable Phaser keyboard directly.
5. **NPC interactions** are proximity-based (`tileSize * 2` distance threshold).

## Common Pitfalls

- **Don't add DOM elements in scenes** — DOM UI belongs in `src/ui/` or `src/main.ts`. Scenes only manage Phaser GameObjects (exception: MeetingScene's leave button, which is a known pattern).
- **Don't hardcode depth values** — always use `Depths.*` constants for consistency.
- **Don't manipulate `input.keyboard` directly** — use `InputManager.switchToGame()` / `switchToTerminal()`.
- **Don't forget y-sort updates** — any new sortable object needs `ySortDepth()` calls in `update()`.
- **Don't skip cleanup** — MeetingScene's `shutdown()` removes all listeners and DOM elements. Follow this pattern for any new scene.
