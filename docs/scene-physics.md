# Scene & Physics System Guide

## Coordinate System

- **Grid**: 20×12 tiles, base tile size 64px (dynamically scaled: `tileSize = max(48, floor(min(screenW/20, screenH/12)))`)
- **Sprite scale**: `spriteScale = tileSize / 32` (all base sprites are 32px)
- **Grid → World**: `worldX = col * tileSize + tileSize/2`, `worldY = row * tileSize + tileSize/2`
- **Origin**: All sprites use default origin (0.5, 0.5) — position is the center

## Physics Bodies

### Dynamic Bodies (Player, NPCs)

Phaser syncs dynamic body position each frame using:
```
body.x = gameObject.x + scaleX * (offset.x - displayOriginX)
body.y = gameObject.y + scaleY * (offset.y - displayOriginY)
```

**Critical rules:**
- `setSize(w, h)` — **world pixels** (multiply base size by scale)
- `setOffset(x, y)` — **frame coordinates** (do NOT multiply by scale — Phaser applies scale internally)
- To center a body of size `bw×bh` in a `32×34` sprite frame: `setOffset((32-bw)/2, (34-bh)/2)`

Example (Player):
```ts
this.setScale(spriteScale);
this.setSize(16, 13);          // body size in pixels
this.setOffset(8, 13);         // frame coords: lowered hitbox for better desk overlap
```

Example (NPC — immovable dynamic body):
```ts
scene.physics.add.existing(this, false); // dynamic, not static
(this.body as Phaser.Physics.Arcade.Body).setImmovable(true);
(this.body as Phaser.Physics.Arcade.Body).moves = false;
this.setSize(8 * spriteScale, 8 * spriteScale);  // world pixels
this.setOffset(12, 13);  // frame coords: (32-8)/2=12, (34-8)/2=13
```

### Static Bodies (Furniture, Walls)

Static bodies do NOT auto-sync with the game object. Use `body.reset(worldX, worldY)` for precise positioning.

**Critical rules:**
- `setSize(w, h)` — **world pixels**
- `body.reset(x, y)` — positions body top-left at **(x, y) in world coordinates**
- After `setScale()`, calculate the sprite's top-left manually:
  ```ts
  const topLeftX = spriteX - displayWidth * originX;
  const topLeftY = spriteY - displayHeight * originY;
  body.reset(topLeftX + offsetX, topLeftY + offsetY);
  ```

The `addFurniture` helper in `OfficeScene.ts` handles this correctly.

## Y-Based Depth Sorting (Pokemon-style)

Objects that should sort visually by screen position use `ySortDepth()` from `src/config/depths.ts`.

```ts
import { ySortDepth } from '../config/depths';

// Higher y = higher depth = renders in front of objects with lower y
sprite.setDepth(ySortDepth(sortY, worldHeight));
```

### Depth sort anchor points

The `depthSortY` should be the y-coordinate where the object "touches the ground":

| Object | Sort point | Why |
|--------|-----------|-----|
| Player | `player.y` (updated each frame) | Center of sprite ≈ feet |
| NPC | `npc.y` (updated each frame) | Same as player |
| Desk | `deskY` (sprite center, = tabletop level) | NOT bottom of legs — so player in front when approaching from below |
| Chair | Bottom of sprite | Decorative, no collision |
| Game tables | Bottom of sprite | Default behavior |

### "Walk behind" effect

For desks, the depth sort anchor is at the tabletop level (`deskY`), not at the bottom of the legs. This means:
- Player above desk (lower y) → player depth < desk depth → desk renders in front → player's lower body hidden by desk legs ✓
- Player below desk (higher y) → player depth > desk depth → player renders in front ✓

The desk collision body covers only the tabletop surface area. The legs extend below without collision, allowing visual overlap when the player walks behind.

### Fixed depth layers (non-sortable)

```
BACKGROUND (-10) → FLOOR_DETAIL (0) → WALLS (1) → NPC_EFFECTS (9)
→ [Y-SORTED: 10–50] →
NPC_LABELS (55) → BADGES (60) → UI_OVERLAY (100) → MINI_GAMES (200) → DIALOG (1000)
```

## Desk Sprite Anatomy (32×30 base)

```
y=0..3   — Front lip/edge of tabletop (dark brown)
y=4..21  — Desk surface from above (wood grain, highlights)
y=22..23 — Front edge of tabletop thickness (2px)
y=24..29 — Legs + under-desk darkness (8px total, ≈1/4 player height)
```

Collision body: 28×14 base, offset (2, 5) — covers the tabletop surface only.

## Collider Setup (OfficeScene.ts)

```ts
this.physics.add.collider(this.player, this.walls);       // world boundaries
this.physics.add.collider(this.player, this.furniture);    // desks, game tables
this.physics.add.collider(this.player, this.npcs, cb);     // NPCs with bump feedback
```

- `this.walls` — StaticGroup for boundary walls
- `this.furniture` — StaticGroup for desks, chairs, game tables
- `this.npcs` — Array of NPC (dynamic immovable bodies)
- NPCs do NOT collide with each other or with furniture

## Common Pitfalls

1. **Don't multiply `setOffset` by scale for dynamic bodies** — Phaser applies scale internally via `(offset - displayOrigin) * scale`
2. **Don't use `refreshBody()` then `setSize/setOffset` for static bodies** — `refreshBody` resets to full sprite dimensions. Use `setSize` then `body.reset()` instead.
3. **Don't use `updateFromGameObject()` with custom offsets on static bodies** — it ignores the offset. Use `body.reset()` for precise positioning.
4. **Player depth must update every frame** in `update()` since the player moves. NPC depths also update each frame (future-proofing for NPC movement).
5. **Desk depth sort anchor must be at tabletop level**, not sprite bottom — otherwise the "walk behind" effect is inverted.
