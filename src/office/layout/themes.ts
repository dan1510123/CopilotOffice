// Office Theme Configuration
// This file defines colors and visual themes that Alice can customize
// ═══════════════════════════════════════════════════════════════════════

// ── Floor Themes ─────────────────────────────────────────────────────
// Different floor color schemes Alice can choose

export interface FloorTheme {
  name: string;
  wood: {
    light: string;
    medium: string;
    dark: string;
    highlight: string;
  };
  tile: {
    light: string;
    dark: string;
    grout: string;
  };
}

export const FLOOR_THEMES: Record<string, FloorTheme> = {
  warm: {
    name: 'Warm Wood',
    wood: {
      light: '#C4956A',
      medium: '#B8875C',
      dark: '#A87850',
      highlight: '#D4A57A',
    },
    tile: {
      light: '#E8E0D8',
      dark: '#DDD5CC',
      grout: '#C8C0B8',
    },
  },
  
  cool: {
    name: 'Cool Gray',
    wood: {
      light: '#8A9AA8',
      medium: '#7A8A98',
      dark: '#6A7A88',
      highlight: '#9AAAB8',
    },
    tile: {
      light: '#E0E4E8',
      dark: '#D0D4D8',
      grout: '#B8BCC0',
    },
  },
  
  dark: {
    name: 'Dark Mahogany',
    wood: {
      light: '#6B4A3A',
      medium: '#5B3A2A',
      dark: '#4B2A1A',
      highlight: '#7B5A4A',
    },
    tile: {
      light: '#3A3A3A',
      dark: '#2A2A2A',
      grout: '#1A1A1A',
    },
  },
  
  light: {
    name: 'Light Birch',
    wood: {
      light: '#E8D8C8',
      medium: '#D8C8B8',
      dark: '#C8B8A8',
      highlight: '#F0E8D8',
    },
    tile: {
      light: '#F8F8F8',
      dark: '#F0F0F0',
      grout: '#E0E0E0',
    },
  },
};

// ── Wall Themes ──────────────────────────────────────────────────────

export interface WallTheme {
  name: string;
  primary: string;
  shadow: string;
}

export const WALL_THEMES: Record<string, WallTheme> = {
  default: {
    name: 'Office Gray',
    primary: '#5a6a7a',
    shadow: '#4a5a6a',
  },
  
  warm: {
    name: 'Warm Beige',
    primary: '#8B7355',
    shadow: '#6B5335',
  },
  
  modern: {
    name: 'Modern White',
    primary: '#C0C0C0',
    shadow: '#A0A0A0',
  },
  
  industrial: {
    name: 'Industrial',
    primary: '#4A4A4A',
    shadow: '#2A2A2A',
  },
};

// ── Background/Outside Themes ────────────────────────────────────────

export interface BackgroundTheme {
  name: string;
  color: string;
  description: string;
}

export const BACKGROUND_THEMES: Record<string, BackgroundTheme> = {
  day: {
    name: 'Daytime',
    color: '#a8c0d0',
    description: 'Light blue sky',
  },
  
  sunset: {
    name: 'Sunset',
    color: '#e8a878',
    description: 'Warm orange glow',
  },
  
  night: {
    name: 'Night',
    color: '#2a3a4a',
    description: 'Dark blue evening',
  },
  
  overcast: {
    name: 'Overcast',
    color: '#9898a8',
    description: 'Cloudy gray sky',
  },
};

// ── Complete Office Theme ────────────────────────────────────────────

export interface OfficeTheme {
  name: string;
  floor: FloorTheme;
  wall: WallTheme;
  background: BackgroundTheme;
}

export const DEFAULT_THEME: OfficeTheme = {
  name: 'Default',
  floor: FLOOR_THEMES.warm,
  wall: WALL_THEMES.default,
  background: BACKGROUND_THEMES.day,
};

// ── Theme Presets ────────────────────────────────────────────────────
// Pre-made theme combinations Alice can choose

export const THEME_PRESETS: Record<string, OfficeTheme> = {
  default: DEFAULT_THEME,
  
  cozy: {
    name: 'Cozy Evening',
    floor: FLOOR_THEMES.dark,
    wall: WALL_THEMES.warm,
    background: BACKGROUND_THEMES.sunset,
  },
  
  modern: {
    name: 'Modern Office',
    floor: FLOOR_THEMES.light,
    wall: WALL_THEMES.modern,
    background: BACKGROUND_THEMES.day,
  },
  
  nightShift: {
    name: 'Night Shift',
    floor: FLOOR_THEMES.cool,
    wall: WALL_THEMES.industrial,
    background: BACKGROUND_THEMES.night,
  },
};
