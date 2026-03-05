// Sprite data for office visualization
// Adapted from pixel-agents - with additional furniture and player support

import type { SpriteData } from '../types';

const _ = ''; // transparent

// ── Floor Tile Sprites (16x16) ───────────────────────────────────

/** Wood floor tile pattern - warm brown tones */
export const FLOOR_TILE_WOOD: SpriteData = (() => {
  const W1 = '#C4956A'; // Light wood
  const W2 = '#B8875C'; // Medium wood
  const W3 = '#A87850'; // Dark wood grain
  const W4 = '#D4A57A'; // Highlight
  return [
    [W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1],
    [W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2],
    [W1, W2, W1, W1, W3, W1, W1, W2, W1, W1, W3, W1, W1, W2, W1, W1],
    [W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1],
    [W4, W1, W1, W2, W1, W1, W4, W1, W1, W2, W1, W1, W4, W1, W1, W2],
    [W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1],
    [W2, W1, W3, W1, W1, W2, W1, W1, W3, W1, W1, W2, W1, W1, W3, W1],
    [W1, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2],
    [W1, W2, W1, W1, W2, W1, W1, W4, W1, W1, W2, W1, W1, W4, W1, W1],
    [W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2],
    [W1, W1, W2, W1, W3, W1, W1, W2, W1, W1, W3, W1, W1, W2, W1, W1],
    [W1, W2, W1, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1],
    [W4, W1, W1, W2, W1, W1, W4, W1, W1, W2, W1, W1, W4, W1, W1, W2],
    [W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1],
    [W2, W1, W2, W1, W1, W3, W1, W1, W2, W1, W1, W3, W1, W1, W2, W1],
    [W1, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2, W1, W1, W2],
  ];
})();

/** Kitchen/tile floor - light gray with grid pattern */
export const FLOOR_TILE_KITCHEN: SpriteData = (() => {
  const T1 = '#E8E0D8'; // Light tile
  const T2 = '#DDD5CC'; // Slightly darker
  const G = '#C8C0B8';  // Grout lines
  return [
    [G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G],
    [G, T1, T1, T1, T1, T1, T1, G, G, T2, T2, T2, T2, T2, T2, G],
    [G, T1, T1, T1, T1, T1, T1, G, G, T2, T2, T2, T2, T2, T2, G],
    [G, T1, T1, T1, T1, T1, T1, G, G, T2, T2, T2, T2, T2, T2, G],
    [G, T1, T1, T1, T1, T1, T1, G, G, T2, T2, T2, T2, T2, T2, G],
    [G, T1, T1, T1, T1, T1, T1, G, G, T2, T2, T2, T2, T2, T2, G],
    [G, T1, T1, T1, T1, T1, T1, G, G, T2, T2, T2, T2, T2, T2, G],
    [G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G],
    [G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G],
    [G, T2, T2, T2, T2, T2, T2, G, G, T1, T1, T1, T1, T1, T1, G],
    [G, T2, T2, T2, T2, T2, T2, G, G, T1, T1, T1, T1, T1, T1, G],
    [G, T2, T2, T2, T2, T2, T2, G, G, T1, T1, T1, T1, T1, T1, G],
    [G, T2, T2, T2, T2, T2, T2, G, G, T1, T1, T1, T1, T1, T1, G],
    [G, T2, T2, T2, T2, T2, T2, G, G, T1, T1, T1, T1, T1, T1, G],
    [G, T2, T2, T2, T2, T2, T2, G, G, T1, T1, T1, T1, T1, T1, G],
    [G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G],
  ];
})();

// ── Furniture Sprites ───────────────────────────────────────────

/** Square desk: 32x32 pixels (2x2 tiles) */
export const DESK_SQUARE_SPRITE: SpriteData = (() => {
  const W = '#8B6914';
  const L = '#A07828';
  const S = '#B8922E';
  const D = '#6B4E0A';
  const rows: string[][] = [];
  rows.push(new Array(32).fill(_));
  rows.push([_, ...new Array(30).fill(W), _]);
  for (let r = 0; r < 4; r++) rows.push([_, W, ...new Array(28).fill(r < 1 ? L : S), W, _]);
  rows.push([_, D, ...new Array(28).fill(W), D, _]);
  for (let r = 0; r < 6; r++) rows.push([_, W, ...new Array(28).fill(S), W, _]);
  rows.push([_, W, ...new Array(28).fill(L), W, _]);
  for (let r = 0; r < 6; r++) rows.push([_, W, ...new Array(28).fill(S), W, _]);
  rows.push([_, D, ...new Array(28).fill(W), D, _]);
  for (let r = 0; r < 4; r++) rows.push([_, W, ...new Array(28).fill(r > 2 ? L : S), W, _]);
  rows.push([_, ...new Array(30).fill(W), _]);
  for (let r = 0; r < 4; r++) {
    const row = new Array(32).fill(_) as string[];
    row[1] = D; row[2] = D; row[29] = D; row[30] = D;
    rows.push(row);
  }
  rows.push(new Array(32).fill(_));
  rows.push(new Array(32).fill(_));
  return rows;
})();

/** Dark desk for The Architect - dark wood/black */
export const DESK_DARK_SPRITE: SpriteData = (() => {
  const W = '#2a2a3a';  // Dark charcoal
  const L = '#3a3a4a';  // Slightly lighter
  const S = '#323242';  // Surface
  const D = '#1a1a2a';  // Darkest
  const rows: string[][] = [];
  rows.push(new Array(32).fill(_));
  rows.push([_, ...new Array(30).fill(W), _]);
  for (let r = 0; r < 4; r++) rows.push([_, W, ...new Array(28).fill(r < 1 ? L : S), W, _]);
  rows.push([_, D, ...new Array(28).fill(W), D, _]);
  for (let r = 0; r < 6; r++) rows.push([_, W, ...new Array(28).fill(S), W, _]);
  rows.push([_, W, ...new Array(28).fill(L), W, _]);
  for (let r = 0; r < 6; r++) rows.push([_, W, ...new Array(28).fill(S), W, _]);
  rows.push([_, D, ...new Array(28).fill(W), D, _]);
  for (let r = 0; r < 4; r++) rows.push([_, W, ...new Array(28).fill(r > 2 ? L : S), W, _]);
  rows.push([_, ...new Array(30).fill(W), _]);
  for (let r = 0; r < 4; r++) {
    const row = new Array(32).fill(_) as string[];
    row[1] = D; row[2] = D; row[29] = D; row[30] = D;
    rows.push(row);
  }
  rows.push(new Array(32).fill(_));
  rows.push(new Array(32).fill(_));
  return rows;
})();

/** Bright desk for Alice - light pink/white */
export const DESK_BRIGHT_SPRITE: SpriteData = (() => {
  const W = '#FFB6C1';  // Light pink
  const L = '#FFC8D4';  // Lighter pink
  const S = '#FFD0DA';  // Surface pink
  const D = '#E8A0B0';  // Darker pink accent
  const rows: string[][] = [];
  rows.push(new Array(32).fill(_));
  rows.push([_, ...new Array(30).fill(W), _]);
  for (let r = 0; r < 4; r++) rows.push([_, W, ...new Array(28).fill(r < 1 ? L : S), W, _]);
  rows.push([_, D, ...new Array(28).fill(W), D, _]);
  for (let r = 0; r < 6; r++) rows.push([_, W, ...new Array(28).fill(S), W, _]);
  rows.push([_, W, ...new Array(28).fill(L), W, _]);
  for (let r = 0; r < 6; r++) rows.push([_, W, ...new Array(28).fill(S), W, _]);
  rows.push([_, D, ...new Array(28).fill(W), D, _]);
  for (let r = 0; r < 4; r++) rows.push([_, W, ...new Array(28).fill(r > 2 ? L : S), W, _]);
  rows.push([_, ...new Array(30).fill(W), _]);
  for (let r = 0; r < 4; r++) {
    const row = new Array(32).fill(_) as string[];
    row[1] = D; row[2] = D; row[29] = D; row[30] = D;
    rows.push(row);
  }
  rows.push(new Array(32).fill(_));
  rows.push(new Array(32).fill(_));
  return rows;
})();

/** Plant in pot: 16x24 */
export const PLANT_SPRITE: SpriteData = (() => {
  const G = '#3D8B37';
  const D = '#2D6B27';
  const T = '#6B4E0A';
  const P = '#B85C3A';
  const R = '#8B4422';
  return [
    [_, _, _, _, _, _, G, G, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, G, G, G, G, _, _, _, _, _, _, _],
    [_, _, _, _, G, G, D, G, G, G, _, _, _, _, _, _],
    [_, _, _, G, G, D, G, G, D, G, G, _, _, _, _, _],
    [_, _, G, G, G, G, G, G, G, G, G, G, _, _, _, _],
    [_, G, G, D, G, G, G, G, G, G, D, G, G, _, _, _],
    [_, G, G, G, G, D, G, G, D, G, G, G, G, _, _, _],
    [_, _, G, G, G, G, G, G, G, G, G, G, _, _, _, _],
    [_, _, _, G, G, G, D, G, G, G, G, _, _, _, _, _],
    [_, _, _, _, G, G, G, G, G, G, _, _, _, _, _, _],
    [_, _, _, _, _, G, G, G, G, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, T, T, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, T, T, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, T, T, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, R, R, R, R, R, _, _, _, _, _, _],
    [_, _, _, _, R, P, P, P, P, P, R, _, _, _, _, _],
    [_, _, _, _, R, P, P, P, P, P, R, _, _, _, _, _],
    [_, _, _, _, R, P, P, P, P, P, R, _, _, _, _, _],
    [_, _, _, _, R, P, P, P, P, P, R, _, _, _, _, _],
    [_, _, _, _, R, P, P, P, P, P, R, _, _, _, _, _],
    [_, _, _, _, R, P, P, P, P, P, R, _, _, _, _, _],
    [_, _, _, _, _, R, P, P, P, R, _, _, _, _, _, _],
    [_, _, _, _, _, _, R, R, R, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  ];
})();

/** Bookshelf: 16x32 (1 tile wide, 2 tiles tall) */
export const BOOKSHELF_SPRITE: SpriteData = (() => {
  const W = '#8B6914';
  const D = '#6B4E0A';
  const R = '#CC4444';
  const B = '#4477AA';
  const G = '#44AA66';
  const Y = '#CCAA33';
  const P = '#9955AA';
  return [
    [_, W, W, W, W, W, W, W, W, W, W, W, W, W, W, _],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, R, R, B, B, G, G, Y, Y, R, R, B, B, D, W],
    [W, D, R, R, B, B, G, G, Y, Y, R, R, B, B, D, W],
    [W, D, R, R, B, B, G, G, Y, Y, R, R, B, B, D, W],
    [W, D, R, R, B, B, G, G, Y, Y, R, R, B, B, D, W],
    [W, D, R, R, B, B, G, G, Y, Y, R, R, B, B, D, W],
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, P, P, Y, Y, B, B, G, G, P, P, R, R, D, W],
    [W, D, P, P, Y, Y, B, B, G, G, P, P, R, R, D, W],
    [W, D, P, P, Y, Y, B, B, G, G, P, P, R, R, D, W],
    [W, D, P, P, Y, Y, B, B, G, G, P, P, R, R, D, W],
    [W, D, P, P, Y, Y, B, B, G, G, P, P, R, R, D, W],
    [W, D, P, P, Y, Y, B, B, G, G, P, P, R, R, D, W],
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, G, G, R, R, P, P, B, B, Y, Y, G, G, D, W],
    [W, D, G, G, R, R, P, P, B, B, Y, Y, G, G, D, W],
    [W, D, G, G, R, R, P, P, B, B, Y, Y, G, G, D, W],
    [W, D, G, G, R, R, P, P, B, B, Y, Y, G, G, D, W],
    [W, D, G, G, R, R, P, P, B, B, Y, Y, G, G, D, W],
    [W, D, G, G, R, R, P, P, B, B, Y, Y, G, G, D, W],
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
    [_, W, W, W, W, W, W, W, W, W, W, W, W, W, W, _],
  ];
})();

/** Water cooler: 16x24 */
export const COOLER_SPRITE: SpriteData = (() => {
  const W = '#CCDDEE';
  const L = '#88BBDD';
  const D = '#999999';
  const B = '#666666';
  return [
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, D, D, D, D, D, D, _, _, _, _, _],
    [_, _, _, _, D, L, L, L, L, L, L, D, _, _, _, _],
    [_, _, _, _, D, L, L, L, L, L, L, D, _, _, _, _],
    [_, _, _, _, D, L, L, L, L, L, L, D, _, _, _, _],
    [_, _, _, _, D, L, L, L, L, L, L, D, _, _, _, _],
    [_, _, _, _, D, L, L, L, L, L, L, D, _, _, _, _],
    [_, _, _, _, _, D, D, D, D, D, D, _, _, _, _, _],
    [_, _, _, _, _, D, W, W, W, W, D, _, _, _, _, _],
    [_, _, _, _, _, D, W, W, W, W, D, _, _, _, _, _],
    [_, _, _, _, _, D, W, W, W, W, D, _, _, _, _, _],
    [_, _, _, _, _, D, W, W, W, W, D, _, _, _, _, _],
    [_, _, _, _, _, D, W, W, W, W, D, _, _, _, _, _],
    [_, _, _, _, D, D, W, W, W, W, D, D, _, _, _, _],
    [_, _, _, _, D, W, W, W, W, W, W, D, _, _, _, _],
    [_, _, _, _, D, W, W, W, W, W, W, D, _, _, _, _],
    [_, _, _, _, D, D, D, D, D, D, D, D, _, _, _, _],
    [_, _, _, _, _, D, B, B, B, B, D, _, _, _, _, _],
    [_, _, _, _, _, D, B, B, B, B, D, _, _, _, _, _],
    [_, _, _, _, _, D, B, B, B, B, D, _, _, _, _, _],
    [_, _, _, _, D, D, B, B, B, B, D, D, _, _, _, _],
    [_, _, _, _, D, B, B, B, B, B, B, D, _, _, _, _],
    [_, _, _, _, D, D, D, D, D, D, D, D, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  ];
})();

/** Whiteboard: 32x16 (2 tiles wide, 1 tile tall) */
export const WHITEBOARD_SPRITE: SpriteData = (() => {
  const F = '#AAAAAA';
  const W = '#EEEEFF';
  const M = '#CC4444';
  const B = '#4477AA';
  return [
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, _],
    [_, F, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, F, _],
    [_, F, W, W, M, M, M, W, W, W, W, W, B, B, B, B, W, W, W, W, W, W, W, M, W, W, W, W, W, W, F, _],
    [_, F, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, B, B, W, W, M, W, W, W, W, W, W, F, _],
    [_, F, W, W, W, W, M, M, M, M, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, B, B, W, W, F, _],
    [_, F, W, W, W, W, W, W, W, W, W, W, W, B, B, B, W, W, W, W, W, W, W, W, W, W, W, W, W, W, F, _],
    [_, F, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, M, M, M, W, W, W, W, W, W, W, F, _],
    [_, F, W, M, M, W, W, W, W, W, W, W, W, W, W, W, B, B, W, W, W, W, W, W, W, W, W, W, W, W, F, _],
    [_, F, W, W, W, W, W, W, B, B, B, W, W, W, W, W, W, W, W, W, W, W, W, W, M, M, M, M, W, W, F, _],
    [_, F, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, F, _],
    [_, F, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, F, _],
    [_, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  ];
})();

/** Chair: 16x16 — top-down desk chair */
export const CHAIR_SPRITE: SpriteData = (() => {
  const W = '#8B6914';
  const D = '#6B4E0A';
  const B = '#5C3D0A';
  const S = '#A07828';
  return [
    [_, _, _, _, _, D, D, D, D, D, D, _, _, _, _, _],
    [_, _, _, _, D, B, B, B, B, B, B, D, _, _, _, _],
    [_, _, _, _, D, B, S, S, S, S, B, D, _, _, _, _],
    [_, _, _, _, D, B, S, S, S, S, B, D, _, _, _, _],
    [_, _, _, _, D, B, S, S, S, S, B, D, _, _, _, _],
    [_, _, _, _, D, B, S, S, S, S, B, D, _, _, _, _],
    [_, _, _, _, D, B, S, S, S, S, B, D, _, _, _, _],
    [_, _, _, _, D, B, S, S, S, S, B, D, _, _, _, _],
    [_, _, _, _, D, B, S, S, S, S, B, D, _, _, _, _],
    [_, _, _, _, D, B, B, B, B, B, B, D, _, _, _, _],
    [_, _, _, _, _, D, D, D, D, D, D, _, _, _, _, _],
    [_, _, _, _, _, _, D, W, W, D, _, _, _, _, _, _],
    [_, _, _, _, _, _, D, W, W, D, _, _, _, _, _, _],
    [_, _, _, _, _, D, D, D, D, D, D, _, _, _, _, _],
    [_, _, _, _, _, D, _, _, _, _, D, _, _, _, _, _],
    [_, _, _, _, _, D, _, _, _, _, D, _, _, _, _, _],
  ];
})();

/** PC monitor: 16x16 */
export const PC_SPRITE: SpriteData = (() => {
  const F = '#555555';
  const S = '#3A3A5C';
  const B = '#6688CC';
  const D = '#444444';
  return [
    [_, _, _, F, F, F, F, F, F, F, F, F, F, _, _, _],
    [_, _, _, F, S, S, S, S, S, S, S, S, F, _, _, _],
    [_, _, _, F, S, B, B, B, B, B, B, S, F, _, _, _],
    [_, _, _, F, S, B, B, B, B, B, B, S, F, _, _, _],
    [_, _, _, F, S, B, B, B, B, B, B, S, F, _, _, _],
    [_, _, _, F, S, B, B, B, B, B, B, S, F, _, _, _],
    [_, _, _, F, S, B, B, B, B, B, B, S, F, _, _, _],
    [_, _, _, F, S, B, B, B, B, B, B, S, F, _, _, _],
    [_, _, _, F, S, S, S, S, S, S, S, S, F, _, _, _],
    [_, _, _, F, F, F, F, F, F, F, F, F, F, _, _, _],
    [_, _, _, _, _, _, _, D, D, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, D, D, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, D, D, D, D, _, _, _, _, _, _],
    [_, _, _, _, _, D, D, D, D, D, D, _, _, _, _, _],
    [_, _, _, _, _, D, D, D, D, D, D, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  ];
})();

/** Desk lamp: 16x16 */
export const LAMP_SPRITE: SpriteData = (() => {
  const Y = '#FFDD55';
  const L = '#FFEE88';
  const D = '#888888';
  const B = '#555555';
  const G = '#FFFFCC';
  return [
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, G, G, G, G, _, _, _, _, _, _],
    [_, _, _, _, _, G, Y, Y, Y, Y, G, _, _, _, _, _],
    [_, _, _, _, G, Y, Y, L, L, Y, Y, G, _, _, _, _],
    [_, _, _, _, Y, Y, L, L, L, L, Y, Y, _, _, _, _],
    [_, _, _, _, Y, Y, L, L, L, L, Y, Y, _, _, _, _],
    [_, _, _, _, _, Y, Y, Y, Y, Y, Y, _, _, _, _, _],
    [_, _, _, _, _, _, D, D, D, D, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, D, D, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, D, D, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, D, D, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, D, D, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, D, D, D, D, _, _, _, _, _, _],
    [_, _, _, _, _, B, B, B, B, B, B, _, _, _, _, _],
    [_, _, _, _, _, B, B, B, B, B, B, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  ];
})();

/** Double doors: 32x16 (2 tiles wide) */
export const DOORS_SPRITE: SpriteData = (() => {
  const W = '#5C4033'; // wood frame
  const D = '#8B6914'; // door surface
  const H = '#CCAA44'; // handle
  const L = '#A07828'; // lighter wood
  return [
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, W, W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, L, L, L, L, L, L, L, L, L, L, L, D, W, W, D, L, L, L, L, L, L, L, L, L, L, L, L, L, D, W],
    [W, D, L, D, D, D, D, D, D, D, D, D, L, D, W, W, D, L, D, D, D, D, D, D, D, D, D, D, D, L, D, W],
    [W, D, L, D, D, D, D, D, D, D, D, D, L, D, W, W, D, L, D, D, D, D, D, D, D, D, D, D, D, L, D, W],
    [W, D, L, D, D, D, D, D, D, D, D, D, L, D, W, W, D, L, D, D, D, D, D, D, D, D, D, D, D, L, D, W],
    [W, D, L, D, D, D, D, D, D, D, H, D, L, D, W, W, D, L, D, H, D, D, D, D, D, D, D, D, D, L, D, W],
    [W, D, L, D, D, D, D, D, D, D, H, D, L, D, W, W, D, L, D, H, D, D, D, D, D, D, D, D, D, L, D, W],
    [W, D, L, D, D, D, D, D, D, D, D, D, L, D, W, W, D, L, D, D, D, D, D, D, D, D, D, D, D, L, D, W],
    [W, D, L, D, D, D, D, D, D, D, D, D, L, D, W, W, D, L, D, D, D, D, D, D, D, D, D, D, D, L, D, W],
    [W, D, L, D, D, D, D, D, D, D, D, D, L, D, W, W, D, L, D, D, D, D, D, D, D, D, D, D, D, L, D, W],
    [W, D, L, L, L, L, L, L, L, L, L, L, L, D, W, W, D, L, L, L, L, L, L, L, L, L, L, L, L, L, D, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, W, W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  ];
})();

/** Welcome mat / entrance rug: 32x16 (2 tiles wide) */
export const ENTRANCE_RUG_SPRITE: SpriteData = (() => {
  const R = '#8B4513'; // rug border
  const M = '#CD853F'; // rug middle
  const T = '#FFFFFF'; // text (ENTER)
  return [
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, _],
    [_, R, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, R, _],
    [_, R, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, R, _],
    [_, R, M, M, M, T, T, T, M, T, M, M, T, M, T, T, T, T, M, T, T, T, M, T, T, T, M, M, M, M, R, _],
    [_, R, M, M, M, T, M, M, M, T, T, M, T, M, M, M, T, M, M, T, M, M, M, T, M, T, M, M, M, M, R, _],
    [_, R, M, M, M, T, T, M, M, T, M, T, T, M, M, M, T, M, M, T, T, M, M, T, T, T, M, M, M, M, R, _],
    [_, R, M, M, M, T, M, M, M, T, M, M, T, M, M, M, T, M, M, T, M, M, M, T, M, T, M, M, M, M, R, _],
    [_, R, M, M, M, T, T, T, M, T, M, M, T, M, M, M, T, M, M, T, T, T, M, T, M, T, M, M, M, M, R, _],
    [_, R, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, R, _],
    [_, R, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, M, R, _],
    [_, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, R, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  ];
})();

// ── Speech Bubbles ────────────────────────────────────────────

/** Permission needed bubble (dots) */
export const BUBBLE_PERMISSION_SPRITE: SpriteData = (() => {
  const B = '#555566';
  const F = '#EEEEFF';
  const A = '#CCA700';
  return [
    [_, B, B, B, B, B, B, B, B, B, _],
    [B, F, F, F, F, F, F, F, F, F, B],
    [B, F, F, F, F, F, F, F, F, F, B],
    [B, F, F, F, F, F, F, F, F, F, B],
    [B, F, F, F, F, F, F, F, F, F, B],
    [B, F, F, A, F, A, F, A, F, F, B],
    [B, F, F, F, F, F, F, F, F, F, B],
    [B, F, F, F, F, F, F, F, F, F, B],
    [B, F, F, F, F, F, F, F, F, F, B],
    [_, B, B, B, B, B, B, B, B, B, _],
    [_, _, _, _, B, B, B, _, _, _, _],
    [_, _, _, _, _, B, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _],
  ];
})();

/** Waiting/done bubble (checkmark) */
export const BUBBLE_WAITING_SPRITE: SpriteData = (() => {
  const B = '#555566';
  const F = '#EEEEFF';
  const G = '#44BB66';
  return [
    [_, B, B, B, B, B, B, B, B, B, _],
    [B, F, F, F, F, F, F, F, F, F, B],
    [B, F, F, F, F, F, F, F, F, F, B],
    [B, F, F, F, F, F, F, F, G, F, B],
    [B, F, F, F, F, F, F, G, F, F, B],
    [B, F, F, G, F, F, G, F, F, F, B],
    [B, F, F, F, G, G, F, F, F, F, B],
    [B, F, F, F, F, F, F, F, F, F, B],
    [B, F, F, F, F, F, F, F, F, F, B],
    [_, B, B, B, B, B, B, B, B, B, _],
    [_, _, _, _, B, B, B, _, _, _, _],
    [_, _, _, _, _, B, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _],
  ];
})();

// ── Character Sprites ───────────────────────────────────────────

/** Palette colors for 6 distinct agent characters */
export const CHARACTER_PALETTES = [
  { skin: '#FFCC99', shirt: '#4488CC', pants: '#334466', hair: '#553322', shoes: '#222222' },
  { skin: '#FFCC99', shirt: '#CC4444', pants: '#333333', hair: '#FFD700', shoes: '#222222' },
  { skin: '#DEB887', shirt: '#44AA66', pants: '#334444', hair: '#222222', shoes: '#333333' },
  { skin: '#FFCC99', shirt: '#AA55CC', pants: '#443355', hair: '#AA4422', shoes: '#222222' },
  { skin: '#DEB887', shirt: '#CCAA33', pants: '#444433', hair: '#553322', shoes: '#333333' },
  { skin: '#FFCC99', shirt: '#FF8844', pants: '#443322', hair: '#111111', shoes: '#222222' },
] as const;

/** Named palettes for specific agents */
export const NAMED_PALETTES: Record<string, { skin: string; shirt: string; pants: string; hair: string; shoes: string }> = {
  // Alice - pink shirt, dark brown long hair
  'admin': { skin: '#FFCC99', shirt: '#FF69B4', pants: '#4A4A5A', hair: '#3D2314', shoes: '#333333' },
  // Arthur the Architect - dark mysterious look
  'architect': { skin: '#E8D4C4', shirt: '#1a1a2e', pants: '#0f0f1a', hair: '#0a0a0a', shoes: '#111111' },
  // Gene the Generalist - friendly blue shirt, brown hair
  'generalist': { skin: '#FFCC99', shirt: '#4488CC', pants: '#334455', hair: '#6B4423', shoes: '#222222' },
};

/** Player character palette - distinct green shirt */
export const PLAYER_PALETTE = {
  skin: '#FFCC99',
  shirt: '#22AA55',
  pants: '#2244AA',
  hair: '#8B4513',
  shoes: '#333333',
};

interface CharPalette {
  skin: string;
  shirt: string;
  pants: string;
  hair: string;
  shoes: string;
}

// Template keys for character pixel data
const H = 'hair';
const K = 'skin';
const S = 'shirt';
const P = 'pants';
const O = 'shoes';
const E = '#FFFFFF'; // eyes

type TemplateCell = typeof H | typeof K | typeof S | typeof P | typeof O | typeof E | typeof _;

/** Resolve a template to SpriteData using a palette */
function resolveTemplate(template: TemplateCell[][], palette: CharPalette): SpriteData {
  return template.map((row) =>
    row.map((cell) => {
      if (cell === _) return '';
      if (cell === E) return E;
      if (cell === H) return palette.hair;
      if (cell === K) return palette.skin;
      if (cell === S) return palette.shirt;
      if (cell === P) return palette.pants;
      if (cell === O) return palette.shoes;
      return cell;
    }),
  );
}

/** Flip a template horizontally */
function flipHorizontal(template: TemplateCell[][]): TemplateCell[][] {
  return template.map((row) => [...row].reverse());
}

// ── Character Templates ────────────────────────────────────────

// Standing/idle down
const CHAR_IDLE_DOWN: TemplateCell[][] = [
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, H, H, H, H, _, _, _, _, _, _],
  [_, _, _, _, _, H, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, H, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, E, K, K, E, K, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, _, S, S, S, S, _, _, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, S, _, _, _, _, _],
  [_, _, _, _, S, S, S, S, S, S, S, S, _, _, _, _],
  [_, _, _, _, S, S, S, S, S, S, S, S, _, _, _, _],
  [_, _, _, _, K, S, S, S, S, S, S, K, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, S, _, _, _, _, _],
  [_, _, _, _, _, _, P, P, P, P, _, _, _, _, _, _],
  [_, _, _, _, _, P, P, P, P, P, P, _, _, _, _, _],
  [_, _, _, _, _, P, P, _, _, P, P, _, _, _, _, _],
  [_, _, _, _, _, P, P, _, _, P, P, _, _, _, _, _],
  [_, _, _, _, _, P, P, _, _, P, P, _, _, _, _, _],
  [_, _, _, _, _, O, O, _, _, O, O, _, _, _, _, _],
  [_, _, _, _, _, O, O, _, _, O, O, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
];

// Walk down frame 1 (left foot forward)
const CHAR_WALK_DOWN_1: TemplateCell[][] = [
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, H, H, H, H, _, _, _, _, _, _],
  [_, _, _, _, _, H, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, H, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, E, K, K, E, K, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, _, S, S, S, S, _, _, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, S, _, _, _, _, _],
  [_, _, _, _, S, S, S, S, S, S, S, S, _, _, _, _],
  [_, _, _, _, S, S, S, S, S, S, S, S, _, _, _, _],
  [_, _, _, _, K, S, S, S, S, S, S, K, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, S, _, _, _, _, _],
  [_, _, _, _, _, _, P, P, P, P, _, _, _, _, _, _],
  [_, _, _, _, _, P, P, P, P, P, P, _, _, _, _, _],
  [_, _, _, _, _, P, P, P, P, P, P, _, _, _, _, _],
  [_, _, _, _, P, P, _, _, _, _, P, P, _, _, _, _],
  [_, _, _, _, P, P, _, _, _, _, P, P, _, _, _, _],
  [_, _, _, _, O, O, _, _, _, _, _, O, O, _, _, _],
  [_, _, _, _, O, O, _, _, _, _, _, O, O, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
];

// Walk down frame 2 (right foot forward)
const CHAR_WALK_DOWN_2: TemplateCell[][] = [
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, H, H, H, H, _, _, _, _, _, _],
  [_, _, _, _, _, H, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, H, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, E, K, K, E, K, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, _, S, S, S, S, _, _, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, S, _, _, _, _, _],
  [_, _, _, _, S, S, S, S, S, S, S, S, _, _, _, _],
  [_, _, _, _, S, S, S, S, S, S, S, S, _, _, _, _],
  [_, _, _, _, K, S, S, S, S, S, S, K, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, S, _, _, _, _, _],
  [_, _, _, _, _, _, P, P, P, P, _, _, _, _, _, _],
  [_, _, _, _, _, P, P, P, P, P, P, _, _, _, _, _],
  [_, _, _, _, _, P, P, P, P, P, P, _, _, _, _, _],
  [_, _, _, O, O, _, _, _, _, _, _, P, P, _, _, _],
  [_, _, _, O, O, _, _, _, _, _, _, P, P, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, O, O, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, O, O, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
];

// Typing animation (sitting, arms moving)
const CHAR_TYPE_1: TemplateCell[][] = [
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, H, H, H, H, _, _, _, _, _, _],
  [_, _, _, _, _, H, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, H, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, E, K, K, E, K, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, _, S, S, S, S, _, _, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, S, _, _, _, _, _],
  [_, _, _, _, S, S, S, S, S, S, S, S, _, _, _, _],
  [_, _, _, K, K, S, S, S, S, S, S, K, K, _, _, _],
  [_, _, _, _, K, S, S, S, S, S, S, K, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, S, _, _, _, _, _],
  [_, _, _, _, _, _, P, P, P, P, _, _, _, _, _, _],
  [_, _, _, _, _, P, P, P, P, P, P, _, _, _, _, _],
  [_, _, _, _, _, P, P, P, P, P, P, _, _, _, _, _],
  [_, _, _, _, _, P, P, _, _, P, P, _, _, _, _, _],
  [_, _, _, _, _, O, O, _, _, O, O, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
];

const CHAR_TYPE_2: TemplateCell[][] = [
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, H, H, H, H, _, _, _, _, _, _],
  [_, _, _, _, _, H, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, H, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, E, K, K, E, K, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, _, S, S, S, S, _, _, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, S, _, _, _, _, _],
  [_, _, _, _, S, S, S, S, S, S, S, S, _, _, _, _],
  [_, _, _, _, K, S, S, S, S, S, S, K, K, _, _, _],
  [_, _, _, K, K, S, S, S, S, S, S, K, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, S, _, _, _, _, _],
  [_, _, _, _, _, _, P, P, P, P, _, _, _, _, _, _],
  [_, _, _, _, _, P, P, P, P, P, P, _, _, _, _, _],
  [_, _, _, _, _, P, P, P, P, P, P, _, _, _, _, _],
  [_, _, _, _, _, P, P, _, _, P, P, _, _, _, _, _],
  [_, _, _, _, _, O, O, _, _, O, O, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
];

// Up-facing idle
const CHAR_IDLE_UP: TemplateCell[][] = [
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, H, H, H, H, _, _, _, _, _, _],
  [_, _, _, _, _, H, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, H, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, H, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, H, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, K, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, _, S, S, S, S, _, _, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, S, _, _, _, _, _],
  [_, _, _, _, S, S, S, S, S, S, S, S, _, _, _, _],
  [_, _, _, _, S, S, S, S, S, S, S, S, _, _, _, _],
  [_, _, _, _, K, S, S, S, S, S, S, K, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, S, _, _, _, _, _],
  [_, _, _, _, _, _, P, P, P, P, _, _, _, _, _, _],
  [_, _, _, _, _, P, P, P, P, P, P, _, _, _, _, _],
  [_, _, _, _, _, P, P, _, _, P, P, _, _, _, _, _],
  [_, _, _, _, _, P, P, _, _, P, P, _, _, _, _, _],
  [_, _, _, _, _, P, P, _, _, P, P, _, _, _, _, _],
  [_, _, _, _, _, O, O, _, _, O, O, _, _, _, _, _],
  [_, _, _, _, _, O, O, _, _, O, O, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
];

// Right-facing idle
const CHAR_IDLE_RIGHT: TemplateCell[][] = [
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, H, H, H, H, _, _, _, _, _, _],
  [_, _, _, _, _, _, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, _, H, H, H, H, H, _, _, _, _, _],
  [_, _, _, _, _, _, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, _, K, K, K, E, K, _, _, _, _, _],
  [_, _, _, _, _, _, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, _, K, K, K, K, K, _, _, _, _, _],
  [_, _, _, _, _, _, S, S, S, S, _, _, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, K, _, _, _, _, _],
  [_, _, _, _, S, S, S, S, S, S, K, _, _, _, _, _],
  [_, _, _, _, S, S, S, S, S, S, S, _, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, S, _, _, _, _, _],
  [_, _, _, _, _, S, S, S, S, S, _, _, _, _, _, _],
  [_, _, _, _, _, _, P, P, P, P, _, _, _, _, _, _],
  [_, _, _, _, _, _, P, P, P, P, _, _, _, _, _, _],
  [_, _, _, _, _, _, P, P, P, P, _, _, _, _, _, _],
  [_, _, _, _, _, _, P, P, P, P, _, _, _, _, _, _],
  [_, _, _, _, _, _, P, P, P, P, _, _, _, _, _, _],
  [_, _, _, _, _, _, O, O, O, O, _, _, _, _, _, _],
  [_, _, _, _, _, _, O, O, O, O, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
];

// ── Sprite Generator ────────────────────────────────────────────

export interface CharacterSprites {
  idle: { down: SpriteData; up: SpriteData; left: SpriteData; right: SpriteData };
  walk: { down: SpriteData[]; up: SpriteData[]; left: SpriteData[]; right: SpriteData[] };
  type: SpriteData[];
}

const spriteCache = new Map<string, CharacterSprites>();

export function getCharacterSprites(paletteIndex: number, hueShift: number = 0, agentId?: string): CharacterSprites {
  // Player has palette -1 - use special player sprites
  if (paletteIndex < 0) {
    return getPlayerSprites();
  }
  
  // Check for named palette first (specific agents like Alice, Architect)
  if (agentId && NAMED_PALETTES[agentId]) {
    const key = `named-${agentId}`;
    const cached = spriteCache.get(key);
    if (cached) return cached;
    
    const palette = NAMED_PALETTES[agentId];
    const sprites = buildCharacterSprites(palette);
    spriteCache.set(key, sprites);
    return sprites;
  }
  
  const key = `${paletteIndex}-${hueShift}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;

  const basePalette = CHARACTER_PALETTES[paletteIndex % CHARACTER_PALETTES.length];
  const palette = basePalette;

  const sprites = buildCharacterSprites(palette);

  spriteCache.set(key, sprites);
  return sprites;
}

function buildCharacterSprites(palette: CharPalette): CharacterSprites {
  return {
    idle: {
      down: resolveTemplate(CHAR_IDLE_DOWN, palette),
      up: resolveTemplate(CHAR_IDLE_UP, palette),
      left: resolveTemplate(flipHorizontal(CHAR_IDLE_RIGHT), palette),
      right: resolveTemplate(CHAR_IDLE_RIGHT, palette),
    },
    walk: {
      down: [
        resolveTemplate(CHAR_WALK_DOWN_1, palette),
        resolveTemplate(CHAR_IDLE_DOWN, palette),
        resolveTemplate(CHAR_WALK_DOWN_2, palette),
        resolveTemplate(CHAR_IDLE_DOWN, palette),
      ],
      up: [
        resolveTemplate(CHAR_IDLE_UP, palette),
        resolveTemplate(CHAR_IDLE_UP, palette),
      ],
      left: [
        resolveTemplate(flipHorizontal(CHAR_IDLE_RIGHT), palette),
        resolveTemplate(flipHorizontal(CHAR_IDLE_RIGHT), palette),
      ],
      right: [
        resolveTemplate(CHAR_IDLE_RIGHT, palette),
        resolveTemplate(CHAR_IDLE_RIGHT, palette),
      ],
    },
    type: [
      resolveTemplate(CHAR_TYPE_1, palette),
      resolveTemplate(CHAR_TYPE_2, palette),
    ],
  };
}

/** Get player-specific sprites with distinct palette */
export function getPlayerSprites(): CharacterSprites {
  const key = 'player';
  const cached = spriteCache.get(key);
  if (cached) return cached;

  const sprites: CharacterSprites = {
    idle: {
      down: resolveTemplate(CHAR_IDLE_DOWN, PLAYER_PALETTE),
      up: resolveTemplate(CHAR_IDLE_UP, PLAYER_PALETTE),
      left: resolveTemplate(flipHorizontal(CHAR_IDLE_RIGHT), PLAYER_PALETTE),
      right: resolveTemplate(CHAR_IDLE_RIGHT, PLAYER_PALETTE),
    },
    walk: {
      down: [
        resolveTemplate(CHAR_WALK_DOWN_1, PLAYER_PALETTE),
        resolveTemplate(CHAR_IDLE_DOWN, PLAYER_PALETTE),
        resolveTemplate(CHAR_WALK_DOWN_2, PLAYER_PALETTE),
        resolveTemplate(CHAR_IDLE_DOWN, PLAYER_PALETTE),
      ],
      up: [
        resolveTemplate(CHAR_IDLE_UP, PLAYER_PALETTE),
        resolveTemplate(CHAR_IDLE_UP, PLAYER_PALETTE),
      ],
      left: [
        resolveTemplate(flipHorizontal(CHAR_IDLE_RIGHT), PLAYER_PALETTE),
        resolveTemplate(flipHorizontal(CHAR_IDLE_RIGHT), PLAYER_PALETTE),
      ],
      right: [
        resolveTemplate(CHAR_IDLE_RIGHT, PLAYER_PALETTE),
        resolveTemplate(CHAR_IDLE_RIGHT, PLAYER_PALETTE),
      ],
    },
    type: [
      resolveTemplate(CHAR_TYPE_1, PLAYER_PALETTE),
      resolveTemplate(CHAR_TYPE_2, PLAYER_PALETTE),
    ],
  };

  spriteCache.set(key, sprites);
  return sprites;
}
