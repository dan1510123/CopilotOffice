/**
 * Phaser depth layer constants for z-ordering game objects.
 *
 * Objects that need y-based depth sorting (furniture, NPCs, player) use
 * ySortDepth() which maps into the sortable range [SORTABLE_BASE, SORTABLE_BASE + SORTABLE_RANGE].
 * Higher y = higher depth = renders in front.
 *
 * | Depth   | Layer          | Objects                              |
 * |---------|----------------|--------------------------------------|
 * |  -10    | BACKGROUND     | Floor tiles, background fill         |
 * |    0    | FLOOR_DETAIL   | Welcome mat, floor decorations       |
 * |    1    | WALLS          | Wall tiles, windows, door            |
 * |    9    | NPC_EFFECTS    | Highlight ring, highlight glow       |
 * | 10–50   | (y-sorted)     | Furniture, NPCs, player via ySortDepth() |
 * |   55    | NPC_LABELS     | Name labels, description labels      |
 * |   60    | BADGES         | NPC session badges, session text     |
 * |  100    | UI_OVERLAY     | Prompts, title/instruction text      |
 * |  200    | MINI_GAMES     | Pong, Basketball game containers     |
 * | 1000    | DIALOG         | Dialog box (deprecated)              |
 */

export const Depths = {
  BACKGROUND:   -10,
  FLOOR_DETAIL:   0,
  WALLS:          1,

  // Y-sorted objects use depths in range [SORTABLE_BASE, SORTABLE_BASE + SORTABLE_RANGE]
  // depth = SORTABLE_BASE + (y / worldHeight) * SORTABLE_RANGE
  NPC_EFFECTS:    9,    // Just below sortable range (highlight rings behind everything sortable)
  SORTABLE_BASE: 10,    // Start of y-sorted depth range
  SORTABLE_RANGE: 40,   // Range for y-sorting (10 to 50)

  // Fixed layers above sortable range
  NPC_LABELS:    55,
  BADGES:        60,
  UI_OVERLAY:   100,
  MINI_GAMES:   200,
  DIALOG:      1000,
} as const;

/** Calculate depth for a y-sorted object. Higher y = higher depth = renders in front. */
export function ySortDepth(y: number, worldHeight: number): number {
  const normalized = Math.max(0, Math.min(1, y / worldHeight));
  return Depths.SORTABLE_BASE + normalized * Depths.SORTABLE_RANGE;
}
