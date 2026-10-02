import { afterEach, beforeEach, vi } from 'vitest';
import { installBrowserMocks, resetBrowserState } from './browser-mocks';
import { installMockCopilotBridge } from './copilot-bridge-mock';
import { MOCK_KEY_CODES } from './phaser-mocks';

installBrowserMocks();

vi.mock('phaser', () => {
  class MockSprite {
    body: any;
    anims: any;

    constructor(public scene?: any, public x = 0, public y = 0) {
      const velocity = {
        x: 0,
        y: 0,
        normalize() {
          const mag = Math.sqrt(this.x * this.x + this.y * this.y);
          if (mag > 0) {
            this.x /= mag;
            this.y /= mag;
          }
          return this;
        },
        scale(speed: number) {
          this.x *= speed;
          this.y *= speed;
          return this;
        },
      };
      this.body = {
        velocity,
        setVelocity: vi.fn((vx: number, vy: number) => {
          velocity.x = vx;
          velocity.y = vy;
        }),
        setImmovable: vi.fn(),
        moves: true,
      };
      this.anims = { stop: vi.fn(), play: vi.fn() };
    }

    setCollideWorldBounds = vi.fn(() => this);
    setSize = vi.fn(() => this);
    setOffset = vi.fn(() => this);
    setScale = vi.fn(() => this);
    setDepth = vi.fn(() => this);
    setInteractive = vi.fn(() => this);
    setPosition = vi.fn(() => this);
    setAlpha = vi.fn(() => this);
    setVisible = vi.fn(() => this);
    setTint = vi.fn(() => this);
    clearTint = vi.fn(() => this);
    setFrame = vi.fn(() => this);
    setVelocity = vi.fn((vx: number, vy: number) => {
      this.body.setVelocity(vx, vy);
      return this;
    });
    play = vi.fn(() => this);
    stop = vi.fn(() => this);
    destroy = vi.fn();
    on = vi.fn(() => this);
  }

  const phaser = {
    AUTO: 0,
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    },
    Input: {
      Keyboard: {
        KeyCodes: {
          ...MOCK_KEY_CODES,
          W: 87,
          A: 65,
          S: 83,
          D: 68,
          SHIFT: 16,
        },
      },
    },
    Physics: {
      Arcade: {
        Sprite: MockSprite,
      },
    },
  };
  return {
    default: phaser,
    AUTO: phaser.AUTO,
    Math: phaser.Math,
    Input: phaser.Input,
    Physics: phaser.Physics,
  };
});

beforeEach(() => {
  resetBrowserState();
  installMockCopilotBridge();
});

afterEach(() => {
  if (vi.isFakeTimers()) {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  }
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

