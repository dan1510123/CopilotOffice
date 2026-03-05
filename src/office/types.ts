// Type definitions for the office visualization
// Adapted from pixel-agents

import {
  TILE_SIZE,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  MAX_COLS,
  MAX_ROWS,
  MATRIX_EFFECT_DURATION_SEC,
} from './constants';

export {
  TILE_SIZE,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  MAX_COLS,
  MAX_ROWS,
  MATRIX_EFFECT_DURATION_SEC as MATRIX_EFFECT_DURATION,
};

export const TileType = {
  WALL: 0,
  FLOOR_1: 1,
  FLOOR_2: 2,
  FLOOR_3: 3,
  FLOOR_4: 4,
  FLOOR_5: 5,
  FLOOR_6: 6,
  FLOOR_7: 7,
  VOID: 8,
  SIDEWALK: 9,
  STREET: 10,
  GRASS: 11,
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

/** Per-tile color settings for floor pattern colorization */
export interface FloorColor {
  /** Hue: 0-360 in colorize mode, -180 to +180 in adjust mode */
  h: number;
  /** Saturation: 0-100 in colorize mode, -100 to +100 in adjust mode */
  s: number;
  /** Brightness -100 to 100 */
  b: number;
  /** Contrast -100 to 100 */
  c: number;
  /** When true, use Photoshop-style Colorize (grayscale → fixed HSL). Default: adjust mode. */
  colorize?: boolean;
}

export const CharacterState = {
  IDLE: 'idle',
  WALK: 'walk',
  TYPE: 'type',
} as const;
export type CharacterState = (typeof CharacterState)[keyof typeof CharacterState];

export const Direction = {
  DOWN: 0,
  LEFT: 1,
  RIGHT: 2,
  UP: 3,
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

/** 2D array of hex color strings (or '' for transparent). [row][col] */
export type SpriteData = string[][];

export interface Seat {
  /** Chair furniture uid */
  uid: string;
  /** Tile col where agent sits */
  seatCol: number;
  /** Tile row where agent sits */
  seatRow: number;
  /** Direction character faces when sitting (toward adjacent desk) */
  facingDir: Direction;
  assigned: boolean;
}

export interface FurnitureInstance {
  sprite: SpriteData;
  /** Pixel x (top-left) */
  x: number;
  /** Pixel y (top-left) */
  y: number;
  /** Y value used for depth sorting (typically bottom edge) */
  zY: number;
}

export interface ToolActivity {
  toolId: string;
  status: string;
  done: boolean;
  permissionWait?: boolean;
}

export const FurnitureType = {
  DESK: 'desk',
  BOOKSHELF: 'bookshelf',
  PLANT: 'plant',
  COOLER: 'cooler',
  WHITEBOARD: 'whiteboard',
  CHAIR: 'chair',
  PC: 'pc',
  LAMP: 'lamp',
} as const;
export type FurnitureType = (typeof FurnitureType)[keyof typeof FurnitureType];

export interface FurnitureCatalogEntry {
  type: string;
  label: string;
  footprintW: number;
  footprintH: number;
  sprite: SpriteData;
  isDesk: boolean;
  category?: string;
  orientation?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  canPlaceOnWalls?: boolean;
}

export interface PlacedFurniture {
  uid: string;
  type: string;
  col: number;
  row: number;
  color?: FloorColor;
}

export interface OfficeLayout {
  version: 1;
  cols: number;
  rows: number;
  tiles: TileType[];
  furniture: PlacedFurniture[];
  tileColors?: Array<FloorColor | null>;
}

export interface Character {
  id: number;
  agentId: string; // Added: maps to our agent ID system
  state: CharacterState;
  dir: Direction;
  x: number;
  y: number;
  tileCol: number;
  tileRow: number;
  path: Array<{ col: number; row: number }>;
  moveProgress: number;
  currentTool: string | null;
  currentToolStatus: string | null; // Added: human-readable status
  palette: number;
  hueShift: number;
  frame: number;
  frameTimer: number;
  wanderTimer: number;
  wanderCount: number;
  wanderLimit: number;
  isActive: boolean;
  seatId: string | null;
  bubbleType: 'permission' | 'waiting' | null;
  bubbleTimer: number;
  seatTimer: number;
  isSubagent: boolean;
  parentAgentId: number | null;
  matrixEffect: 'spawn' | 'despawn' | null;
  matrixEffectTimer: number;
  matrixEffectSeeds: number[];
  folderName?: string;
}
