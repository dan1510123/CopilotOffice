export type ResponsiveLayoutKey = 'default' | 'portrait-dashboard';

export const PORTRAIT_RATIO_THRESHOLD = 0.9;
export const PORTRAIT_WIDTH_THRESHOLD_PX = 600;

export function computeResponsiveLayout(width: number, height: number): ResponsiveLayoutKey {
  const safeHeight = Math.max(1, height);
  const ratio = width / safeHeight;
  return ratio <= PORTRAIT_RATIO_THRESHOLD || width <= PORTRAIT_WIDTH_THRESHOLD_PX
    ? 'portrait-dashboard'
    : 'default';
}
