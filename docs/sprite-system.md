# Sprite System — Visuals, Movement & Directions

## Overview

All character sprites (player + 10 NPCs) are **procedurally generated** pixel art using Phaser's Graphics API — no external image files. Each character is a **12-frame spritesheet** supporting 4 walking directions with 3 animation frames each.

## Spritesheet Layout

Each character's spritesheet is a 96×136px image (3 columns × 4 rows of 32×34px frames):

```
         Col 0 (stand)   Col 1 (step-L)   Col 2 (step-R)
Row 0:   [0] Down         [1] Down          [2] Down
Row 1:   [3] Left         [4] Left          [5] Left
Row 2:   [6] Right        [7] Right         [8] Right
Row 3:   [9] Up           [10] Up           [11] Up
```

- **Frame 0** (Down/stand) is the default idle pose — what you see when nothing is moving.
- **Right frames are mirrored Left frames** — drawn once, flipped programmatically via `MirrorD`.

## Direction Views

| Direction | What you see | Key details |
|-----------|-------------|-------------|
| **Down** (front) | Face, eyes, outfit front details (tie, lapels, shirt) | Default idle direction. Matches the original single-sprite design. |
| **Up** (back) | Back of head (hair/helmet), outfit back (seams, straps, cloaks) | No facial features. Ears peek out on sides. |
| **Left** (side) | Side profile — narrower head, one eye, nose, body turned | Accessories repositioned for side view. |
| **Right** | Horizontal mirror of Left | Automatically generated — not hand-drawn. |

## Walk Animation

The walk cycle uses a **4-frame loop** built from 3 unique frames:

```
stand → step-left → stand → step-right → (repeat)
```

- **Stand** (frame 0): Both legs centered, neutral pose
- **Step-left** (frame 1): Left leg shifted up 1px, right leg shifted down 1px
- **Step-right** (frame 2): Right leg shifted up 1px, left leg shifted down 1px
- **Frame rate**: 8 FPS (configurable via `WALK_FRAME_RATE` in `DirectionalSprite.ts`)

For body styles without visible legs (robes, cloaks), walk frames use a subtle hem/bottom-edge shift instead.

## How Movement Works (Player)

`Player.ts` handles direction tracking and animation:

1. **Every frame**, velocity is calculated from input (WASD / arrow keys)
2. `directionFromVelocity(vx, vy)` determines the facing direction:
   - Dominant axis wins (if |vx| > |vy|, face left/right)
   - Ties go to vertical (classic RPG convention)
   - Returns `null` if stationary
3. **If moving**: plays `player_walk_{direction}` animation
4. **If stopped**: animation stops, sprite shows the **stand frame of the last direction** faced
5. **If movement disabled** (terminal open, etc.): animation stops immediately

## How NPCs Work

NPCs are **stationary** but use the same spritesheet system:

- Default to frame 0 (Down/stand) — visually identical to the old single-sprite system
- `setDirection(direction)` method available for future NPC movement
- Walk animations are pre-registered and ready to use

## File Structure

```
src/sprites/
  DirectionalSprite.ts   — Direction enum, frame math, animation registration
  SpriteGenerator.ts     — All procedural drawing code (player + NPCs)

src/config/
  depths.ts              — Z-depth layer constants (see below)
```

### DirectionalSprite.ts — Key Exports

| Export | Purpose |
|--------|---------|
| `Direction` | Enum: `DOWN=0, LEFT=1, RIGHT=2, UP=3` |
| `getFrameIndex(dir, walkFrame)` | Convert direction + walk frame to spritesheet index |
| `getStandFrame(dir)` | Get the idle frame for a direction |
| `walkAnimKey(spriteKey, dir)` | Build animation key string (e.g. `"player_walk_down"`) |
| `directionFromVelocity(vx, vy)` | Determine direction from velocity vector |
| `registerWalkAnimations(anims, key)` | Register all 4 walk animations for a character |

### SpriteGenerator.ts — Key Exports

| Export | Purpose |
|--------|---------|
| `generatePlayerSpritesheet(scene)` | Generate the player's 12-frame spritesheet |
| `generateHeroSpritesheet(scene, name, config)` | Generate an NPC's 12-frame spritesheet |
| `HeroConfig` | Interface for NPC appearance (skin, hair, body, accessory) |

## Drawing Architecture

### DrawCtx / MirrorD

All sprite drawing uses a `DrawCtx` interface with two implementations:

- **`D`** (normal) — Offsets all coordinates to a frame position in the spritesheet
- **`MirrorD`** — Same API, but flips X coordinates horizontally. Used to draw Right frames by calling the Left drawing functions with mirrored output.

This means **Left-facing art is only drawn once** — Right frames are automatic.

### Modular NPC System

NPCs are composed from interchangeable parts, each with per-direction drawing:

| Component | Styles | What varies by direction |
|-----------|--------|--------------------------|
| **Head** | 1 (universal) | Front: eyes + face. Back: no face, ears visible. Side: one eye, nose profile. |
| **Hair** | 6 (spiky, helmet, goggles, short, long, bun) | Coverage changes per angle. Helmet shows visor only from front/side. |
| **Body** | 7 (robe, armor, pilot, coat, cloak, vest) | Front details (lapels, tie, shirt) not shown from behind. Side view narrower. Walk frames adjust legs. |
| **Accessory** | 9 (staff, shield, rocket, stethoscope, binoculars, coins, meta, book, blueprint) | Position shifts per direction. Some hidden from certain angles. |

### Spritesheet Finalization

The generation pipeline:

1. Create a Phaser Graphics object
2. Draw all 12 frames at their grid positions (using `D` for down/left/up, `MirrorD` for right)
3. `generateTexture()` to create a temporary full-sheet texture
4. **Clone the canvas** (critical — prevents Phaser's CanvasPool from recycling the data)
5. Remove the temp texture, re-register as a spritesheet with `addSpriteSheet()`

## Z-Depth Layers

All game objects use named depth constants from `src/config/depths.ts`:

| Depth | Constant | Objects |
|-------|----------|---------|
| -10 | `BACKGROUND` | Floor tiles, background fill |
| 0 | `FLOOR_DETAIL` | Welcome mat, rug, floor decorations |
| 1 | `WALLS` | Wall tiles, windows, door |
| 2 | `FURNITURE` | Desks, chairs, computers, shelves |
| 5 | `GAME_OBJECTS` | Pong table, basketball hoop |
| 10 | `NPC_EFFECTS` | Highlight ring, highlight glow |
| 20 | `NPC_SPRITES` | NPC character sprites |
| 25 | `NPC_LABELS` | Name/description labels |
| 50 | `PLAYER` | Player character sprite |
| 55 | `BADGES` | Session badges, session text |
| 100 | `UI_OVERLAY` | Prompts, title/instruction text |
| 200 | `MINI_GAMES` | Pong, Basketball containers |
| 1000 | `DIALOG` | Dialog box (deprecated) |

**Rule**: Never use hardcoded `setDepth(number)` — always import from `Depths`.

## Adding a New Character

1. Define the `HeroConfig` in `src/config/agents.ts` (skin, hair style, body style, accessory, colors)
2. Call `generateHeroSpritesheet(this, 'npc_myname', config)` in `BootScene.ts`
3. The sprite key `'npc_myname'` is now a 12-frame spritesheet ready for use
4. Walk animations are auto-registered when the NPC is constructed

## Modifying Sprite Art

To change how a specific direction looks:

- **Player**: Edit `drawPlayerDown/Up/Left()` in `SpriteGenerator.ts`
- **NPC hair**: Edit the relevant case in `drawHeroHair()` for the direction
- **NPC body**: Edit the relevant case in `drawRobe/Armor/Coat/etc.()` for the direction
- **NPC accessory**: Edit the relevant case in `drawStaff/Shield/Book/etc.()` for the direction

Right-facing views update automatically when you change the Left-facing art.
