import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_COLORS,
  loadPlayerColors,
  resetPlayerColors,
  savePlayerColors,
} from '../../../src/config/playerCustomization';

describe('config/playerCustomization', () => {
  it('loads defaults when storage is empty', () => {
    localStorage.removeItem('agencyOffice:playerColors');
    expect(loadPlayerColors()).toEqual(DEFAULT_PLAYER_COLORS);
  });

  it('merges partial persisted colors with defaults', () => {
    localStorage.setItem(
      'agencyOffice:playerColors',
      JSON.stringify({ hair: 0xffffff, shoes: 0x123456 })
    );

    const colors = loadPlayerColors();
    expect(colors.hair).toBe(0xffffff);
    expect(colors.shoes).toBe(0x123456);
    expect(colors.skin).toBe(DEFAULT_PLAYER_COLORS.skin);
  });

  it('falls back to defaults on malformed JSON', () => {
    localStorage.setItem('agencyOffice:playerColors', 'not-json');
    expect(loadPlayerColors()).toEqual(DEFAULT_PLAYER_COLORS);
  });

  it('saves and resets colors', () => {
    const custom = { ...DEFAULT_PLAYER_COLORS, tie: 0xabcd12 };
    savePlayerColors(custom);
    expect(loadPlayerColors().tie).toBe(0xabcd12);

    const reset = resetPlayerColors();
    expect(reset).toEqual(DEFAULT_PLAYER_COLORS);
    expect(localStorage.getItem('agencyOffice:playerColors')).toBeNull();
  });
});

