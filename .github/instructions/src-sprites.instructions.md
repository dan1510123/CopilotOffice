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

- Called by `BootScene` during asset loading to generate every character texture.
- Each agent has a unique color palette derived from their hex color in `src/config/agents.ts`.
- Uses `DrawCtx` abstraction with normal (`D`) and mirror (`MirrorD`) contexts.
  RIGHT-facing frames are auto-mirrored from LEFT — draw LEFT only.

## DirectionalSprite.ts

Animation utilities for the 4-direction sprite system.

- **`Direction` enum**: `DOWN` (0), `LEFT` (1), `RIGHT` (2), `UP` (3).
- **`getFrameIndex(direction, frame)`** — Returns spritesheet frame index (`row * 3 + col`).
- **`getStandFrame(direction)`** — Returns the idle/stand frame for a direction.
- **`directionFromVelocity(vx, vy)`** — Resolves velocity to a `Direction` (ties → vertical, RPG convention).
- **`walkAnimKey(spriteKey, direction)`** — Builds animation key string: `{spriteKey}_walk_{dir}`.
- **`registerWalkAnimations(anims, spriteKey)`** — Registers 4 walk animations per character.
  Walk cycle: stand → stepL → stand → stepR (4-frame loop, 3 unique frames, 8 fps).

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

1. Add a generation block in `SpriteGenerator.ts` (follow the existing 8-bit hero pattern).
2. Register the new sprite in `BootScene.ts` so it gets generated during boot.
3. Add agent config in `src/config/agents.ts` with matching `sprite` key and hex `color`.
4. Six reserve sprites already exist (azure, validator, deployer, doctor, scout, accountant) — activate before creating new ones.
