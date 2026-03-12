---
applyTo: "src/sprites/**"
---

# Sprite System — Procedural Generation & Animation

## Purpose

Procedural sprite sheet generation and animation utilities for all characters.
All character sprites are **code-generated** using Phaser Graphics — no external image files.

## SpriteGenerator.ts

Creates 12-frame sprite sheets (96×136px: 3 columns × 4 rows) for the player and all agent NPCs.
Each frame is ~32×34px of 8-bit pixel art drawn via `Phaser.GameObjects.Graphics`.

- **Two exported functions:**
  - `generatePlayerSpritesheet(scene)` — generates the player sprite (key: `'player'`).
  - `generateHeroSpritesheet(scene, name, config: HeroConfig)` — generates a customizable NPC sprite with configurable skin, hair, body style, and accessory.
- **`HeroConfig` interface** controls NPC appearance:
  - `skinColor`, `hairColor`, `bodyColor`, `accessoryColor` — hex colors
  - `hairStyle` — `'spiky'` | `'helmet'` | `'goggles'` | `'short'` | `'long'` | `'bun'`
  - `bodyStyle` — `'robe'` | `'armor'` | `'pilot'` | `'coat'` | `'cloak'` | `'vest'`
  - `accessory` — `'staff'` | `'shield'` | `'rocket'` | `'stethoscope'` | `'binoculars'` | `'coins'` | `'meta'` | `'book'` | `'blueprint'`
  - `helmetColor` — optional, used only for `'helmet'` hair style
- Called by `BootScene` during asset loading to generate every character texture.
- Uses `DrawCtx` abstraction with normal (`D`) and mirror (`MirrorD`) contexts.
  RIGHT-facing frames are auto-mirrored from LEFT — draw LEFT only.

### Fleet Sprites

`BootScene` generates **14 fleet agent spritesheets** (`npc_fleet_1` through `npc_fleet_14`)
using `generateHeroSpritesheet()` with uniform `'coat'` body style, `'short'` hair, and `'book'`
accessory. Each fleet sprite has a unique color from a predefined palette matching
`FLEET_COLORS` in `src/config/agents.ts`. These sprites are used by `FLEET_AGENTS` in
fleet v-team offices.

## DirectionalSprite.ts

Animation utilities for the 4-direction sprite system.

**Exported constants:**
- `SPRITE_COLS` (3), `SPRITE_ROWS` (4) — grid dimensions
- `FRAME_WIDTH` (32), `FRAME_HEIGHT` (34) — px per frame
- `SHEET_WIDTH` (96), `SHEET_HEIGHT` (136) — full sheet dimensions
- `WALK_FRAME_RATE` (8) — fps for walk animations

**Exported functions:**
- **`Direction` enum**: `DOWN` (0), `LEFT` (1), `RIGHT` (2), `UP` (3).
- **`getFrameIndex(direction, frame)`** — Returns spritesheet frame index (`row * 3 + col`).
- **`getStandFrame(direction)`** — Returns the idle/stand frame for a direction.
- **`directionName(direction)`** — Returns direction name string: `'down'`, `'left'`, `'right'`, `'up'`.
- **`directionFromVelocity(vx, vy)`** — Resolves velocity to a `Direction` or `null` if stationary (ties → vertical, RPG convention).
- **`walkAnimKey(spriteKey, direction)`** — Builds animation key string: `{spriteKey}_walk_{dir}`.
- **`registerWalkAnimations(anims, spriteKey)`** — Registers 4 walk animations per character.
  Walk cycle: stand → stepL → stand → stepR (4-frame loop, 3 unique frames, 8 fps, infinite repeat).

## Frame Layout

```
         Col 0 (stand)   Col 1 (stepL)   Col 2 (stepR)
Row 0:   Down/stand       Down/stepL       Down/stepR
Row 1:   Left/stand       Left/stepL       Left/stepR
Row 2:   Right/stand      Right/stepL      Right/stepR
Row 3:   Up/stand         Up/stepL         Up/stepR
```

Frame index = `direction * 3 + walkFrame`. Full sheet: 96×136px (3×32 wide, 4×34 tall).

## Key Rules

- **All sprites are procedural** — never add external sprite image files to the repo.
- Sprite keys must match between `agents.ts` `sprite` field, BootScene generation, and animation registration.
- Animations are registered per-scene via `registerWalkAnimations()` — call it after the texture exists.
- Colors are derived from agent config hex values — keep palette logic in SpriteGenerator.
- RIGHT frames mirror LEFT automatically via `MirrorD` — only draw the LEFT direction.

## Common Tasks — Adding a New Character Sprite

1. Call `generateHeroSpritesheet(scene, name, config)` in `BootScene.ts` with a `HeroConfig` defining the character's appearance.
2. Add agent config in `src/config/agents.ts` with matching `sprite` key and hex `color`.
3. Six reserve sprites already exist (azure, validator, deployer, doctor, scout, accountant) — activate before creating new ones.
4. For fleet agents, sprites are batch-generated in BootScene's fleet loop — add to the loop or increase its count.
