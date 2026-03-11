export interface PlayerColors {
  hair: number;
  skin: number;
  suit: number;
  tie: number;
  pants: number;
  shoes: number;
}

export const DEFAULT_PLAYER_COLORS: PlayerColors = {
  hair: 0x2a1a0a,
  skin: 0xffdbac,
  suit: 0x1a2a4a,
  tie: 0xcc2222,
  pants: 0x1a1a2a,
  shoes: 0x111111,
};

export const COLOR_REGION_LABELS: Record<keyof PlayerColors, string> = {
  hair: 'Hair',
  skin: 'Skin',
  suit: 'Jacket',
  tie: 'Tie',
  pants: 'Pants',
  shoes: 'Shoes',
};

export const PLAYER_COLOR_PRESETS: Record<keyof PlayerColors, number[]> = {
  hair: [
    0xf5deb3, // blonde
    0xc8a258, // golden brown
    0x8b6914, // light brown
    0x5c4033, // brown
    0x2a1a0a, // dark brown
    0x8b3a2f, // auburn
    0xb03020, // red
    0x9e9e9e, // gray
    0x1a1a1a, // black
  ],
  skin: [
    0xfff0e0, // very light
    0xffdbac, // light peach
    0xf5c49c, // peach
    0xe0ac69, // light tan
    0xc68642, // tan
    0xa0724a, // medium brown
    0x8d5524, // brown
    0x6b3e26, // dark brown
    0x4a2912, // very dark
  ],
  suit: [
    0x1a2a4a, // navy
    0x2c2c2c, // charcoal
    0x111111, // black
    0x6e6e6e, // gray
    0x5c3a1e, // brown
    0x5a1a2a, // burgundy
    0x1a3a2a, // forest green
    0xf0ead6, // cream
    0xb89a6a, // tan
    0x3a3a5a, // slate blue
  ],
  tie: [
    0xcc2222, // red
    0x2244aa, // blue
    0xd4a017, // gold
    0x227744, // green
    0x6a2c8a, // purple
    0x111111, // black
    0x7a1a2a, // burgundy
    0xe07020, // orange
    0x888888, // silver gray
  ],
  pants: [
    0x1a1a2a, // very dark blue
    0x111111, // black
    0x4a4a4a, // gray
    0x2c2c2c, // charcoal
    0xb89a6a, // khaki
    0x5c3a1e, // brown
    0x1a2a4a, // navy
    0x3a3a2a, // olive
    0x6e6e6e, // light gray
  ],
  shoes: [
    0x111111, // black
    0x3a2010, // dark brown
    0x5c3a1e, // brown
    0xb89a6a, // tan
    0x2c2c2c, // dark gray
    0x5a1a2a, // burgundy
    0x1a1a3a, // navy
    0x6b3e26, // medium brown
  ],
};

const STORAGE_KEY = 'agencyOffice:playerColors';

export function loadPlayerColors(): PlayerColors {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_PLAYER_COLORS);
    const parsed = JSON.parse(raw) as Partial<PlayerColors>;
    const merged = structuredClone(DEFAULT_PLAYER_COLORS);
    for (const key of Object.keys(merged) as (keyof PlayerColors)[]) {
      if (typeof parsed[key] === 'number') {
        merged[key] = parsed[key];
      }
    }
    return merged;
  } catch {
    return structuredClone(DEFAULT_PLAYER_COLORS);
  }
}

export function savePlayerColors(colors: PlayerColors): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
}

export function resetPlayerColors(): PlayerColors {
  localStorage.removeItem(STORAGE_KEY);
  return structuredClone(DEFAULT_PLAYER_COLORS);
}
