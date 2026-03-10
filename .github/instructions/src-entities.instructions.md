---
applyTo: "src/entities/**"
---

# Entity Classes — Player & NPC

## Purpose

Game entity classes for the two character types in the office world.
Both extend `Phaser.Physics.Arcade.Sprite` and use procedurally generated
spritesheets (no external image assets).

## Player.ts

- Movement via **WASD / Arrow keys**; hold **Shift** to sprint (2× `baseSpeed`).
- Uses Phaser Arcade Physics body with a tight hitbox (`setSize(16, 13)`,
  offset lowered for better desk overlap).
- Diagonal movement is normalized to prevent faster diagonal speed.
- Direction detected from velocity via `directionFromVelocity()`.
- Walk animations play per-direction using `walkAnimKey('player', dir)`;
  standing frame set via `getStandFrame(dir)` when idle.
- `enableMovement()` / `disableMovement()` toggled by InputManager when
  terminal gains or loses focus. Never call these directly from NPC or UI code.

## NPC.ts

- Constructed from an `AgentConfig` (see `src/config/agents.ts`).
- **Immovable** physics body — player collides but NPC doesn't move.
- `walkTo(x, y, speed)` provides tween-based scripted movement with walk
  animation and automatic y-sort depth updates.
- Attached child objects (all positioned relative to sprite):
  - **Name label** — bold monospace text above sprite.
  - **Description label** — italic text just below name.
  - **Session badge** — colored circle + emoji/text icon at top-right.
  - **Interaction indicator** — bouncing arrow when player is nearby.
  - **Highlight glow** — yellow glow on pointer hover.
  - **Highlight ring** — pulsing blue ring when terminal is open.
- `updateAgentStatus(status)` drives the badge; status states:
  | State | Color | Icon | Pulse |
  |-----------|--------|------|-------|
  | slacking  | gray   | 💤   | no    |
  | starting  | yellow | 🚀   | yes   |
  | ready     | blue   | ✓    | no    |
  | waiting   | orange | ⏳   | no    |
  | thinking  | green  | 🧠   | yes   |
  | error     | red    | ❌   | no    |
- `destroy()` cleans up all child GameObjects to avoid leaks.

## Sprite System

Both entities use `DirectionalSprite` helpers from `src/sprites/`:
- 4-direction animation: DOWN (row 0), LEFT (row 1), RIGHT (row 2), UP (row 3).
- `registerWalkAnimations(anims, spriteKey)` creates walk anims per direction.
- Spritesheets are procedurally generated in `BootScene.ts` / `SpriteGenerator`.

## Depth Sorting

- Use `ySortDepth(y, worldBottom)` from `src/config/depths.ts` for y-based
  render order. NPC updates depth on `walkTo` movement.
- Child graphics (glow, ring) use `Depths.NPC_EFFECTS`; badges use `Depths.BADGES`.
- **Never set depth with a raw number** — always use `Depths.*` constants or `ySortDepth()`.

## Key Rules

1. **No input handling here.** `InputManager` owns all focus transitions;
   Player only reads key state in `update()`.
2. **Status updates flow through `game.events`** (`agent:status:changed`,
   `agent:tool:start`), not direct mutation on the NPC.
3. Physics body dimensions must match sprite size — update `setSize`/`setOffset`
   if sprite dimensions change.

## Common Pitfalls

- NPC badge state must go through `updateBadgeForState()` which guards against
  duplicate updates and manages pulse tweens. Don't set `currentBadgeState` directly.
- The valid state machine lives in `officeManager.ts` (`AgentStatus`).
- Forgetting to call `updateAttachedPositions()` after moving an NPC will leave
  labels and badges floating at the old position.
- `destroy()` must clean up every child object — add new children there too.
