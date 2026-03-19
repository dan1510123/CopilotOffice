import { vi } from 'vitest';

export const MOCK_KEY_CODES = {
  UP: 38,
  DOWN: 40,
  LEFT: 37,
  RIGHT: 39,
  SPACE: 32,
};

export interface MockSceneKeyboard {
  enabled: boolean;
  addCapture: ReturnType<typeof vi.fn>;
  clearCaptures: ReturnType<typeof vi.fn>;
}

export interface MockScene {
  input: {
    keyboard: MockSceneKeyboard;
  };
  game: {
    canvas: HTMLCanvasElement;
  };
}

export function createMockScene(): MockScene {
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  document.body.appendChild(canvas);

  return {
    input: {
      keyboard: {
        enabled: true,
        addCapture: vi.fn(),
        clearCaptures: vi.fn(),
      },
    },
    game: {
      canvas,
    },
  };
}

