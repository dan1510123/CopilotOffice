// Renderer for the office visualization
// Adapted from pixel-agents with improved floor tiles

import { TileType, TILE_SIZE, CharacterState } from '../types';
import type { TileType as TileTypeVal, FurnitureInstance, Character, SpriteData, Seat, FloorColor } from '../types';
import { getCachedSprite, getOutlineSprite } from '../sprites/spriteCache';
import { getCharacterSprites, BUBBLE_PERMISSION_SPRITE, BUBBLE_WAITING_SPRITE, FLOOR_TILE_WOOD, FLOOR_TILE_KITCHEN } from '../sprites/spriteData';
import { AGENTS } from '../../config/agents';
import {
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_Z_SORT_OFFSET,
  OUTLINE_Z_SORT_OFFSET,
  SELECTED_OUTLINE_ALPHA,
  HOVERED_OUTLINE_ALPHA,
  BUBBLE_FADE_DURATION_SEC,
  BUBBLE_SITTING_OFFSET_PX,
  BUBBLE_VERTICAL_OFFSET_PX,
  FALLBACK_FLOOR_COLOR,
  SEAT_OWN_COLOR,
  SEAT_AVAILABLE_COLOR,
  SEAT_BUSY_COLOR,
  GRID_LINE_COLOR,
} from '../constants';
import { Direction } from '../types';

// ── Outside/background color (light) ────────────────────────────
const OUTSIDE_COLOR = '#87CEEB'; // Light sky blue for background
const WALL_COLOR = '#5a6a7a'; // Darker wall color
const SIDEWALK_COLOR = '#c0b8a8'; // Light concrete/beige
const SIDEWALK_LINE_COLOR = '#a09888'; // Darker line for sidewalk joints
const STREET_COLOR = '#4a4a4a'; // Dark asphalt
const STREET_LINE_COLOR = '#e8e850'; // Yellow road line
const GRASS_COLOR = '#5a9a4a'; // Green grass

// ── Render functions ────────────────────────────────────────────

export function renderTileGrid(
  ctx: CanvasRenderingContext2D,
  tileMap: TileTypeVal[][],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const s = TILE_SIZE * zoom;
  const tmRows = tileMap.length;
  const tmCols = tmRows > 0 ? tileMap[0].length : 0;

  for (let r = 0; r < tmRows; r++) {
    for (let c = 0; c < tmCols; c++) {
      const tile = tileMap[r][c];
      const x = offsetX + c * s;
      const y = offsetY + r * s;

      // VOID tiles = sky/background
      if (tile === TileType.VOID) {
        ctx.fillStyle = OUTSIDE_COLOR;
        ctx.fillRect(x, y, s, s);
        continue;
      }

      // GRASS tiles
      if (tile === TileType.GRASS) {
        ctx.fillStyle = GRASS_COLOR;
        ctx.fillRect(x, y, s, s);
        // Add subtle grass texture with darker spots
        ctx.fillStyle = '#4a8a3a';
        for (let i = 0; i < 3; i++) {
          const gx = x + (((c * 7 + i * 13) % 10) / 10) * s * 0.8;
          const gy = y + (((r * 11 + i * 17) % 10) / 10) * s * 0.8;
          ctx.fillRect(gx, gy, s * 0.15, s * 0.15);
        }
        continue;
      }

      // SIDEWALK tiles
      if (tile === TileType.SIDEWALK) {
        ctx.fillStyle = SIDEWALK_COLOR;
        ctx.fillRect(x, y, s, s);
        // Draw grid lines for concrete slabs
        ctx.strokeStyle = SIDEWALK_LINE_COLOR;
        ctx.lineWidth = Math.max(1, zoom * 0.5);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + s, y);
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + s);
        ctx.stroke();
        continue;
      }

      // STREET tiles
      if (tile === TileType.STREET) {
        ctx.fillStyle = STREET_COLOR;
        ctx.fillRect(x, y, s, s);
        // Add road texture (tiny speckles)
        ctx.fillStyle = '#5a5a5a';
        for (let i = 0; i < 4; i++) {
          const sx = x + (((c * 13 + i * 7) % 10) / 10) * s * 0.9;
          const sy = y + (((r * 17 + i * 11) % 10) / 10) * s * 0.9;
          ctx.fillRect(sx, sy, s * 0.08, s * 0.08);
        }
        continue;
      }

      if (tile === TileType.WALL) {
        // Draw walls with depth effect
        ctx.fillStyle = WALL_COLOR;
        ctx.fillRect(x, y, s, s);
        // Add darker bottom for 3D effect
        ctx.fillStyle = '#4a5a6a';
        ctx.fillRect(x, y + s * 0.7, s, s * 0.3);
      } else {
        // Floor tiles - use sprite patterns
        const floorSprite = (tile === TileType.FLOOR_2) ? FLOOR_TILE_KITCHEN : FLOOR_TILE_WOOD;
        const cached = getCachedSprite(floorSprite, zoom);
        ctx.drawImage(cached, x, y);
      }
    }
  }
}

interface ZDrawable {
  zY: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

function getCharacterSprite(ch: Character): SpriteData {
  const sprites = getCharacterSprites(ch.palette, ch.hueShift, ch.agentId);
  
  if (ch.state === CharacterState.TYPE) {
    return sprites.type[ch.frame % sprites.type.length];
  }
  
  if (ch.state === CharacterState.WALK) {
    const dir = ch.dir;
    if (dir === Direction.DOWN) return sprites.walk.down[ch.frame % sprites.walk.down.length];
    if (dir === Direction.UP) return sprites.walk.up[ch.frame % sprites.walk.up.length];
    if (dir === Direction.LEFT) return sprites.walk.left[ch.frame % sprites.walk.left.length];
    if (dir === Direction.RIGHT) return sprites.walk.right[ch.frame % sprites.walk.right.length];
  }
  
  // Idle
  const dir = ch.dir;
  if (dir === Direction.DOWN) return sprites.idle.down;
  if (dir === Direction.UP) return sprites.idle.up;
  if (dir === Direction.LEFT) return sprites.idle.left;
  if (dir === Direction.RIGHT) return sprites.idle.right;
  
  return sprites.idle.down;
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  furniture: FurnitureInstance[],
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  selectedAgentId: string | null,
  hoveredAgentId: string | null,
): void {
  const drawables: ZDrawable[] = [];

  // Furniture
  for (const f of furniture) {
    const cached = getCachedSprite(f.sprite, zoom);
    const fx = offsetX + f.x * zoom;
    const fy = offsetY + f.y * zoom;
    drawables.push({
      zY: f.zY,
      draw: (c) => {
        c.drawImage(cached, fx, fy);
      },
    });
  }

  // Characters
  for (const ch of characters) {
    const spriteData = getCharacterSprite(ch);
    const cached = getCachedSprite(spriteData, zoom);
    const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
    const drawX = Math.round(offsetX + ch.x * zoom - cached.width / 2);
    const drawY = Math.round(offsetY + (ch.y + sittingOffset) * zoom - cached.height);

    const charZY = ch.y + TILE_SIZE / 2 + CHARACTER_Z_SORT_OFFSET;

    // Selection outline
    const isSelected = selectedAgentId !== null && ch.agentId === selectedAgentId;
    const isHovered = hoveredAgentId !== null && ch.agentId === hoveredAgentId;
    if (isSelected || isHovered) {
      const outlineAlpha = isSelected ? SELECTED_OUTLINE_ALPHA : HOVERED_OUTLINE_ALPHA;
      const outlineData = getOutlineSprite(spriteData);
      const outlineCached = getCachedSprite(outlineData, zoom);
      const olDrawX = drawX - zoom;
      const olDrawY = drawY - zoom;
      drawables.push({
        zY: charZY - OUTLINE_Z_SORT_OFFSET,
        draw: (c) => {
          c.save();
          c.globalAlpha = outlineAlpha;
          c.drawImage(outlineCached, olDrawX, olDrawY);
          c.restore();
        },
      });
    }

    drawables.push({
      zY: charZY,
      draw: (c) => {
        c.drawImage(cached, drawX, drawY);
      },
    });
  }

  // Sort by Y (lower = in front = drawn later)
  drawables.sort((a, b) => a.zY - b.zY);

  for (const d of drawables) {
    d.draw(ctx);
  }
}

// ── Seat indicators ─────────────────────────────────────────────

export function renderSeatIndicators(
  ctx: CanvasRenderingContext2D,
  seats: Map<string, Seat>,
  characters: Map<string, Character>,
  selectedAgentId: string | null,
  hoveredTile: { col: number; row: number } | null,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  if (selectedAgentId === null || !hoveredTile) return;
  const selectedChar = characters.get(selectedAgentId);
  if (!selectedChar) return;

  for (const [uid, seat] of seats) {
    if (seat.seatCol !== hoveredTile.col || seat.seatRow !== hoveredTile.row) continue;

    const s = TILE_SIZE * zoom;
    const x = offsetX + seat.seatCol * s;
    const y = offsetY + seat.seatRow * s;

    if (selectedChar.seatId === uid) {
      ctx.fillStyle = SEAT_OWN_COLOR;
    } else if (!seat.assigned) {
      ctx.fillStyle = SEAT_AVAILABLE_COLOR;
    } else {
      ctx.fillStyle = SEAT_BUSY_COLOR;
    }
    ctx.fillRect(x, y, s, s);
    break;
  }
}

// ── Speech bubbles ──────────────────────────────────────────────

export function renderBubbles(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  for (const ch of characters) {
    if (!ch.bubbleType) continue;

    const sprite = ch.bubbleType === 'permission'
      ? BUBBLE_PERMISSION_SPRITE
      : BUBBLE_WAITING_SPRITE;

    let alpha = 1.0;
    if (ch.bubbleType === 'waiting' && ch.bubbleTimer < BUBBLE_FADE_DURATION_SEC) {
      alpha = ch.bubbleTimer / BUBBLE_FADE_DURATION_SEC;
    }

    const cached = getCachedSprite(sprite, zoom);
    const sittingOff = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0;
    const bubbleX = Math.round(offsetX + ch.x * zoom - cached.width / 2);
    const bubbleY = Math.round(offsetY + (ch.y + sittingOff - BUBBLE_VERTICAL_OFFSET_PX) * zoom - cached.height - 1 * zoom);

    ctx.save();
    if (alpha < 1.0) ctx.globalAlpha = alpha;
    ctx.drawImage(cached, bubbleX, bubbleY);
    ctx.restore();
  }
}

// ── Grid overlay ────────────────────────────────────────────────

export function renderGridOverlay(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  zoom: number,
  cols: number,
  rows: number,
): void {
  const s = TILE_SIZE * zoom;
  ctx.strokeStyle = GRID_LINE_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= cols; c++) {
    const x = offsetX + c * s + 0.5;
    ctx.moveTo(x, offsetY);
    ctx.lineTo(x, offsetY + rows * s);
  }
  for (let r = 0; r <= rows; r++) {
    const y = offsetY + r * s + 0.5;
    ctx.moveTo(offsetX, y);
    ctx.lineTo(offsetX + cols * s, y);
  }
  ctx.stroke();
}

// ── Character name labels ────────────────────────────────────────

// Build a lookup map for agent names
const agentNameMap = new Map<string, string>();
for (const agent of AGENTS) {
  agentNameMap.set(agent.id, agent.name);
}

export function renderCharacterNames(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  ctx.save();
  
  const fontSize = Math.max(10, Math.round(zoom * 2.5));
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  
  for (const ch of characters) {
    // Skip player character
    if (ch.agentId === '__player__') continue;
    
    const name = agentNameMap.get(ch.agentId) || ch.agentId;
    const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
    const x = offsetX + ch.x * zoom;
    const y = offsetY + (ch.y + sittingOffset) * zoom - 24 * zoom; // Above head
    
    // Draw text shadow/outline for readability
    ctx.fillStyle = '#000000';
    ctx.fillText(name, x + 1, y + 1);
    ctx.fillText(name, x - 1, y + 1);
    ctx.fillText(name, x + 1, y - 1);
    ctx.fillText(name, x - 1, y - 1);
    
    // Draw name in white
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(name, x, y);
  }
  
  ctx.restore();
}

// ── Main render function ────────────────────────────────────────

export interface SelectionRenderState {
  selectedAgentId: string | null;
  hoveredAgentId: string | null;
  hoveredTile: { col: number; row: number } | null;
  seats: Map<string, Seat>;
  characters: Map<string, Character>;
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  tileMap: TileTypeVal[][],
  furniture: FurnitureInstance[],
  characters: Character[],
  zoom: number,
  panX: number,
  panY: number,
  selection?: SelectionRenderState,
): { offsetX: number; offsetY: number } {
  // Clear with outside/sky color (light)
  ctx.fillStyle = OUTSIDE_COLOR;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const cols = tileMap.length > 0 ? tileMap[0].length : 0;
  const rows = tileMap.length;

  // Center map in viewport + pan offset
  const mapW = cols * TILE_SIZE * zoom;
  const mapH = rows * TILE_SIZE * zoom;
  const offsetX = Math.floor((canvasWidth - mapW) / 2) + Math.round(panX);
  const offsetY = Math.floor((canvasHeight - mapH) / 2) + Math.round(panY);

  // Draw tiles
  renderTileGrid(ctx, tileMap, offsetX, offsetY, zoom);

  // Seat indicators
  if (selection) {
    renderSeatIndicators(ctx, selection.seats, selection.characters, selection.selectedAgentId, selection.hoveredTile, offsetX, offsetY, zoom);
  }

  // Draw furniture + characters (z-sorted)
  const selectedId = selection?.selectedAgentId ?? null;
  const hoveredId = selection?.hoveredAgentId ?? null;
  renderScene(ctx, furniture, characters, offsetX, offsetY, zoom, selectedId, hoveredId);

  // Character names above heads
  renderCharacterNames(ctx, characters, offsetX, offsetY, zoom);

  // Speech bubbles
  renderBubbles(ctx, characters, offsetX, offsetY, zoom);

  return { offsetX, offsetY };
}
