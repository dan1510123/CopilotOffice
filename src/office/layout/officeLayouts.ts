// Office Layout Configuration
// This file can be edited by Alice (office admin) to customize the office
// ═══════════════════════════════════════════════════════════════════════

import { TileType } from '../types';
import type { SpriteData } from '../types';

// ── Layout Types ─────────────────────────────────────────────────────

export interface PlacedFurniture {
  uid: string;
  type: string;
  col: number;
  row: number;
}

export interface OfficeLayout {
  version: number;
  name: string;
  cols: number;
  rows: number;
  tiles: TileType[];
  furniture: PlacedFurniture[];
}

// ── Default Office Layout ────────────────────────────────────────────
// Edit this function to change the default office appearance

export function createDefaultLayout(): OfficeLayout {
  const cols = 24;
  const rows = 16;
  const tiles: TileType[] = [];
  
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Outside/void areas (corners and entrance path)
      if (r === 0 || r === rows - 1) {
        // Top and bottom are outside
        if (c >= 10 && c <= 13 && r === rows - 1) {
          tiles.push(TileType.FLOOR_2); // Entrance path
        } else {
          tiles.push(TileType.VOID);
        }
      } else if (c === 0 || c === cols - 1) {
        // Left and right edges are outside
        tiles.push(TileType.VOID);
      } else if (r === 1) {
        // Top wall row
        tiles.push(TileType.WALL);
      } else if (r === rows - 2) {
        // Bottom wall row - with door opening in center
        if (c >= 10 && c <= 13) {
          tiles.push(TileType.FLOOR_1); // Door opening
        } else {
          tiles.push(TileType.WALL);
        }
      } else if (c === 1 || c === cols - 2) {
        // Wall columns
        tiles.push(TileType.WALL);
      } else if (r >= 8 && r <= 10 && c >= 10 && c <= 13) {
        // Kitchen/break area (light tiles)
        tiles.push(TileType.FLOOR_2);
      } else {
        // Main office floor (wood)
        tiles.push(TileType.FLOOR_1);
      }
    }
  }
  
  // Office furniture layout
  const furniture: PlacedFurniture[] = [
    // ─── Left Work Area ───────────────────────────────
    { uid: 'bookshelf-1', type: 'bookshelf', col: 2, row: 2 },
    { uid: 'bookshelf-2', type: 'bookshelf', col: 3, row: 2 },
    { uid: 'desk-1', type: 'desk', col: 2, row: 5 },
    { uid: 'chair-1', type: 'chair', col: 3, row: 7 },
    { uid: 'pc-1', type: 'pc', col: 2, row: 5 },
    
    { uid: 'desk-2', type: 'desk', col: 6, row: 5 },
    { uid: 'chair-2', type: 'chair', col: 7, row: 7 },
    { uid: 'pc-2', type: 'pc', col: 6, row: 5 },
    
    // ─── Right Work Area ──────────────────────────────
    { uid: 'desk-3', type: 'desk', col: 16, row: 5 },
    { uid: 'chair-3', type: 'chair', col: 17, row: 7 },
    { uid: 'pc-3', type: 'pc', col: 16, row: 5 },
    
    { uid: 'desk-4', type: 'desk', col: 20, row: 5 },
    { uid: 'chair-4', type: 'chair', col: 21, row: 7 },
    { uid: 'pc-4', type: 'pc', col: 20, row: 5 },
    
    // ─── Break Area ───────────────────────────────────
    { uid: 'cooler-1', type: 'cooler', col: 14, row: 8 },
    { uid: 'plant-3', type: 'plant', col: 14, row: 10 },
    
    // ─── Decoration ───────────────────────────────────
    { uid: 'plant-1', type: 'plant', col: 2, row: 10 },
    { uid: 'plant-2', type: 'plant', col: 21, row: 2 },
    { uid: 'whiteboard-1', type: 'whiteboard', col: 10, row: 2 },
    
    // ─── Lamps ────────────────────────────────────────
    { uid: 'lamp-1', type: 'lamp', col: 4, row: 5 },
    { uid: 'lamp-2', type: 'lamp', col: 8, row: 5 },
    { uid: 'lamp-3', type: 'lamp', col: 18, row: 5 },
    
    // ─── The Architect - Bottom Left ───────────────────
    { uid: 'desk-architect', type: 'desk_dark', col: 2, row: 12 },
    { uid: 'chair-architect', type: 'chair', col: 3, row: 13 },
    { uid: 'pc-architect', type: 'pc', col: 2, row: 12 },
    
    // ─── Alice (Office Admin) - Bottom Right ──────────
    { uid: 'desk-alice', type: 'desk_bright', col: 19, row: 12 },
    { uid: 'chair-alice', type: 'chair', col: 20, row: 13 },
    { uid: 'pc-alice', type: 'pc', col: 19, row: 12 },
    
    // ─── Entrance (at bottom wall) ────────────────────
    { uid: 'doors-1', type: 'doors', col: 11, row: 14 },
    { uid: 'entrance-rug', type: 'entrance_rug', col: 11, row: 13 },
  ];
  
  return { 
    version: 1, 
    name: 'Default Office',
    cols, 
    rows, 
    tiles, 
    furniture 
  };
}

// ── Alternative Layouts ──────────────────────────────────────────────
// Add more layout presets here that Alice can choose from

export function createSmallOfficeLayout(): OfficeLayout {
  const cols = 16;
  const rows = 12;
  const tiles: TileType[] = [];
  
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
        if (c >= 6 && c <= 9 && r === rows - 1) {
          tiles.push(TileType.FLOOR_1);
        } else if (r === 0 || c === 0 || c === cols - 1) {
          tiles.push(TileType.VOID);
        } else {
          tiles.push(TileType.WALL);
        }
      } else if (r === 1 || c === 1 || c === cols - 2) {
        if (c >= 6 && c <= 9 && r === rows - 2) {
          tiles.push(TileType.FLOOR_1);
        } else {
          tiles.push(TileType.WALL);
        }
      } else {
        tiles.push(TileType.FLOOR_1);
      }
    }
  }
  
  const furniture: PlacedFurniture[] = [
    { uid: 'desk-1', type: 'desk', col: 2, row: 3 },
    { uid: 'chair-1', type: 'chair', col: 3, row: 5 },
    { uid: 'pc-1', type: 'pc', col: 2, row: 3 },
    
    { uid: 'desk-2', type: 'desk', col: 10, row: 3 },
    { uid: 'chair-2', type: 'chair', col: 11, row: 5 },
    { uid: 'pc-2', type: 'pc', col: 10, row: 3 },
    
    { uid: 'plant-1', type: 'plant', col: 2, row: 7 },
    { uid: 'cooler-1', type: 'cooler', col: 13, row: 3 },
    
    { uid: 'doors-1', type: 'doors', col: 7, row: 10 },
    { uid: 'entrance-rug', type: 'entrance_rug', col: 7, row: 9 },
  ];
  
  return {
    version: 1,
    name: 'Small Office',
    cols,
    rows,
    tiles,
    furniture
  };
}

export function createOpenPlanLayout(): OfficeLayout {
  const cols = 32;
  const rows = 20;
  const tiles: TileType[] = [];
  
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
        tiles.push(TileType.VOID);
      } else if (r === 1 || r === rows - 2 || c === 1 || c === cols - 2) {
        if (c >= 14 && c <= 17 && r === rows - 2) {
          tiles.push(TileType.FLOOR_1);
        } else {
          tiles.push(TileType.WALL);
        }
      } else {
        tiles.push(TileType.FLOOR_1);
      }
    }
  }
  
  const furniture: PlacedFurniture[] = [];
  
  // Create a grid of desks
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const baseCol = 3 + col * 7;
      const baseRow = 3 + row * 5;
      const idx = row * 4 + col + 1;
      
      furniture.push({ uid: `desk-${idx}`, type: 'desk', col: baseCol, row: baseRow });
      furniture.push({ uid: `chair-${idx}`, type: 'chair', col: baseCol + 1, row: baseRow + 2 });
      furniture.push({ uid: `pc-${idx}`, type: 'pc', col: baseCol, row: baseRow });
    }
  }
  
  // Add decorations
  furniture.push({ uid: 'plant-1', type: 'plant', col: 2, row: 2 });
  furniture.push({ uid: 'plant-2', type: 'plant', col: 29, row: 2 });
  furniture.push({ uid: 'plant-3', type: 'plant', col: 2, row: 17 });
  furniture.push({ uid: 'plant-4', type: 'plant', col: 29, row: 17 });
  furniture.push({ uid: 'cooler-1', type: 'cooler', col: 15, row: 2 });
  furniture.push({ uid: 'whiteboard-1', type: 'whiteboard', col: 10, row: 2 });
  furniture.push({ uid: 'whiteboard-2', type: 'whiteboard', col: 20, row: 2 });
  
  // Entrance
  furniture.push({ uid: 'doors-1', type: 'doors', col: 15, row: 18 });
  furniture.push({ uid: 'entrance-rug', type: 'entrance_rug', col: 15, row: 17 });
  
  return {
    version: 1,
    name: 'Open Plan Office',
    cols,
    rows,
    tiles,
    furniture
  };
}

// ── Layout Registry ──────────────────────────────────────────────────
// Available layouts that can be selected

export const AVAILABLE_LAYOUTS = {
  default: createDefaultLayout,
  small: createSmallOfficeLayout,
  openPlan: createOpenPlanLayout,
};

export type LayoutName = keyof typeof AVAILABLE_LAYOUTS;
