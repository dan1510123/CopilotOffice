import { describe, expect, it } from 'vitest';
import {
  PORTRAIT_RATIO_THRESHOLD,
  PORTRAIT_WIDTH_THRESHOLD_PX,
  computeResponsiveLayout,
} from '../../../src/config/responsiveLayout';

describe('config/responsiveLayout', () => {
  it('returns portrait-dashboard for narrow ratio', () => {
    expect(computeResponsiveLayout(800, 1200)).toBe('portrait-dashboard');
  });

  it('returns portrait-dashboard at ratio threshold boundary', () => {
    const height = 1000;
    const width = Math.floor(PORTRAIT_RATIO_THRESHOLD * height);
    expect(computeResponsiveLayout(width, height)).toBe('portrait-dashboard');
  });

  it('returns portrait-dashboard for narrow width', () => {
    expect(computeResponsiveLayout(PORTRAIT_WIDTH_THRESHOLD_PX, 500)).toBe('portrait-dashboard');
  });

  it('returns default for landscape dimensions above thresholds', () => {
    expect(computeResponsiveLayout(1200, 800)).toBe('default');
  });

  it('handles zero height safely', () => {
    expect(computeResponsiveLayout(1000, 0)).toBe('default');
  });

  it('remains portrait-dashboard for a typical phone-like portrait viewport', () => {
    expect(computeResponsiveLayout(430, 932)).toBe('portrait-dashboard');
  });
});
