import { describe, expect, it } from 'vitest';
import { ZIndex } from '../../../src/config/zIndex';

describe('config/zIndex — DOM layer registry', () => {
  it('defines every named layer as a non-negative integer', () => {
    for (const [name, value] of Object.entries(ZIndex)) {
      expect(Number.isInteger(value), `${name} must be an integer`).toBe(true);
      expect(value, `${name} must be >= 0`).toBeGreaterThanOrEqual(0);
    }
  });

  it('orders the documented pitfall layers correctly (status bar < terminal < sprite card)', () => {
    // Mirrors the constraint in .github/copilot-instructions.md:
    //   "status bar (100), terminal overlay (10000), sprite card (10001)"
    expect(ZIndex.STATUS_BAR).toBeLessThan(ZIndex.TERMINAL_OVERLAY);
    expect(ZIndex.TERMINAL_OVERLAY).toBeLessThan(ZIndex.TERMINAL_SPRITE_CARD);
  });

  it('keeps modal surfaces above terminal surfaces', () => {
    expect(ZIndex.SETTINGS).toBeGreaterThan(ZIndex.TERMINAL_OVERLAY);
    expect(ZIndex.SPRITE_CUSTOMIZER).toBeGreaterThan(ZIndex.TERMINAL_OVERLAY);
    expect(ZIndex.NOTIFICATION_SETTINGS).toBeGreaterThan(ZIndex.TERMINAL_OVERLAY);
  });

  it('keeps top-level modal dialogs above every other surface', () => {
    const allOthers = Object.entries(ZIndex)
      .filter(([k]) => k !== 'MODAL_DIALOG' && k !== 'TOP_MODAL')
      .map(([, v]) => v);
    for (const v of allOthers) {
      expect(ZIndex.MODAL_DIALOG).toBeGreaterThan(v);
    }
    expect(ZIndex.TOP_MODAL).toBeGreaterThan(ZIndex.MODAL_DIALOG);
  });

  it('keeps toast notifications above the office scene overlay but below the terminal', () => {
    expect(ZIndex.TOAST).toBeGreaterThan(ZIndex.OFFICE_SCENE_OVERLAY);
    expect(ZIndex.TOAST).toBeLessThan(ZIndex.TERMINAL_OVERLAY);
  });

  it('treats SETTINGS and NOTIFICATION_SETTINGS as siblings (same layer)', () => {
    // Documented invariant: the two settings overlays are never open
    // simultaneously, so they intentionally share a layer. If this test fails,
    // either the invariant changed (allow simultaneous open?) or the values
    // drifted apart — re-verify against the registry header before splitting.
    expect(ZIndex.SETTINGS).toBe(ZIndex.NOTIFICATION_SETTINGS);
  });

  it('SERIOUS_TERMINAL sits above the standard terminal overlay so its chrome stays on top', () => {
    expect(ZIndex.SERIOUS_TERMINAL).toBeGreaterThan(ZIndex.TERMINAL_OVERLAY);
    expect(ZIndex.SERIOUS_TERMINAL).toBeGreaterThan(ZIndex.TERMINAL_SPRITE_CARD);
  });
});
