// Furniture Catalog
// This file defines all available furniture types that Alice can place
// ═══════════════════════════════════════════════════════════════════════

import type { SpriteData } from '../types';
import {
  DESK_SQUARE_SPRITE,
  DESK_DARK_SPRITE,
  DESK_BRIGHT_SPRITE,
  PLANT_SPRITE,
  CHAIR_SPRITE,
  BOOKSHELF_SPRITE,
  COOLER_SPRITE,
  WHITEBOARD_SPRITE,
  PC_SPRITE,
  LAMP_SPRITE,
  DOORS_SPRITE,
  ENTRANCE_RUG_SPRITE,
} from '../sprites/spriteData';

// ── Furniture Definition ─────────────────────────────────────────────

export interface FurnitureDefinition {
  type: string;
  name: string;
  sprite: SpriteData;
  width: number;  // in tiles
  height: number; // in tiles
  category: 'desk' | 'seating' | 'storage' | 'decoration' | 'entrance';
  canSitAt?: boolean;  // Characters can sit here
  facingDirection?: 'up' | 'down' | 'left' | 'right';
}

// ── Furniture Catalog ────────────────────────────────────────────────
// Add new furniture types here for Alice to use

export const FURNITURE_CATALOG: Record<string, FurnitureDefinition> = {
  desk: {
    type: 'desk',
    name: 'Office Desk',
    sprite: DESK_SQUARE_SPRITE,
    width: 2,
    height: 2,
    category: 'desk',
  },
  
  desk_dark: {
    type: 'desk_dark',
    name: 'Dark Desk',
    sprite: DESK_DARK_SPRITE,
    width: 2,
    height: 2,
    category: 'desk',
  },
  
  desk_bright: {
    type: 'desk_bright',
    name: 'Bright Desk',
    sprite: DESK_BRIGHT_SPRITE,
    width: 2,
    height: 2,
    category: 'desk',
  },
  
  chair: {
    type: 'chair',
    name: 'Office Chair',
    sprite: CHAIR_SPRITE,
    width: 1,
    height: 1,
    category: 'seating',
    canSitAt: true,
    facingDirection: 'up',
  },
  
  bookshelf: {
    type: 'bookshelf',
    name: 'Bookshelf',
    sprite: BOOKSHELF_SPRITE,
    width: 1,
    height: 2,
    category: 'storage',
  },
  
  plant: {
    type: 'plant',
    name: 'Potted Plant',
    sprite: PLANT_SPRITE,
    width: 1,
    height: 1,
    category: 'decoration',
  },
  
  cooler: {
    type: 'cooler',
    name: 'Water Cooler',
    sprite: COOLER_SPRITE,
    width: 1,
    height: 1,
    category: 'decoration',
  },
  
  whiteboard: {
    type: 'whiteboard',
    name: 'Whiteboard',
    sprite: WHITEBOARD_SPRITE,
    width: 2,
    height: 1,
    category: 'decoration',
  },
  
  pc: {
    type: 'pc',
    name: 'Computer Monitor',
    sprite: PC_SPRITE,
    width: 1,
    height: 1,
    category: 'desk',
  },
  
  lamp: {
    type: 'lamp',
    name: 'Desk Lamp',
    sprite: LAMP_SPRITE,
    width: 1,
    height: 1,
    category: 'decoration',
  },
  
  doors: {
    type: 'doors',
    name: 'Double Doors',
    sprite: DOORS_SPRITE,
    width: 2,
    height: 1,
    category: 'entrance',
  },
  
  entrance_rug: {
    type: 'entrance_rug',
    name: 'Welcome Rug',
    sprite: ENTRANCE_RUG_SPRITE,
    width: 2,
    height: 1,
    category: 'entrance',
  },
};

// ── Helper Functions ─────────────────────────────────────────────────

export function getFurnitureDefinition(type: string): FurnitureDefinition | undefined {
  return FURNITURE_CATALOG[type];
}

export function getFurnitureSprite(type: string): SpriteData {
  const def = FURNITURE_CATALOG[type];
  return def?.sprite || PLANT_SPRITE; // Default fallback
}

export function getFurnitureSize(type: string): { w: number; h: number } {
  const def = FURNITURE_CATALOG[type];
  return { w: def?.width || 1, h: def?.height || 1 };
}

export function getFurnituresByCategory(category: FurnitureDefinition['category']): FurnitureDefinition[] {
  return Object.values(FURNITURE_CATALOG).filter(f => f.category === category);
}

export function getAllFurnitureTypes(): string[] {
  return Object.keys(FURNITURE_CATALOG);
}
