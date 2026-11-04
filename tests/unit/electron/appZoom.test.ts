import type { Input } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { handleAppZoom } from '../../../electron/appZoom';

function keyInput(key: string, overrides: Partial<Input> = {}): Input {
  return {
    type: 'keyDown',
    key,
    code: '',
    isAutoRepeat: false,
    shift: false,
    control: true,
    alt: false,
    meta: false,
    ...overrides,
  };
}

function contents(level = 0) {
  return { getZoomLevel: () => level, setZoomLevel: vi.fn() };
}

describe('app zoom shortcuts', () => {
  it.each([
    ['-', -0.5],
    ['_', -0.5],
    ['+', 0.5],
    ['=', 0.5],
    ['0', 0],
  ])('handles Ctrl+%s and consumes the shortcut', (key, expected) => {
    const webContents = contents();
    expect(handleAppZoom(webContents, keyInput(key))).toBe(true);
    expect(webContents.setZoomLevel).toHaveBeenCalledWith(expected);
  });

  it('supports shifted plus and macOS Command shortcuts', () => {
    const webContents = contents();
    expect(handleAppZoom(webContents, keyInput('+', {
      shift: true, control: false, meta: true,
    }))).toBe(true);
    expect(webContents.setZoomLevel).toHaveBeenCalledWith(0.5);
  });

  it.each([
    keyInput('-', { control: false }),
    keyInput('-', { alt: true }),
    keyInput('-', { type: 'keyUp' }),
    keyInput('r'),
    keyInput('F10'),
  ])('leaves unrelated input untouched: %j', (input) => {
    const webContents = contents();
    expect(handleAppZoom(webContents, input)).toBe(false);
    expect(webContents.setZoomLevel).not.toHaveBeenCalled();
  });

  it.each([[-5, '-', -5], [5, '+', 5], [2, '-', 1.5], [-2, '+', -1.5], [2, '0', 0]] as const)(
    'adjusts or resets the current level %s with %s',
    (level, key, expected) => {
      const webContents = contents(level);
      handleAppZoom(webContents, keyInput(key));
      expect(webContents.setZoomLevel).toHaveBeenCalledWith(expected);
    },
  );
});
