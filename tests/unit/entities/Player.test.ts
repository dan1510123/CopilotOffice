import { describe, expect, it, vi } from 'vitest';
import { Player } from '../../../src/entities/Player';

function key() {
  return { isDown: false };
}

function createSceneStub() {
  const cursors = {
    left: key(),
    right: key(),
    up: key(),
    down: key(),
    space: key(),
  };
  const wasd = {
    W: key(),
    A: key(),
    S: key(),
    D: key(),
    SHIFT: key(),
  };

  const scene = {
    add: { existing: vi.fn() },
    physics: { add: { existing: vi.fn() } },
    anims: {
      exists: vi.fn(() => false),
      create: vi.fn(),
    },
    input: {
      keyboard: {
        createCursorKeys: vi.fn(() => cursors),
        addKey: vi.fn((code: number) => {
          switch (code) {
            case 87:
              return wasd.W;
            case 65:
              return wasd.A;
            case 83:
              return wasd.S;
            case 68:
              return wasd.D;
            case 16:
              return wasd.SHIFT;
            default:
              return key();
          }
        }),
      },
    },
  };

  return { scene, cursors, wasd };
}

describe('entities/Player', () => {
  it('updates velocity for movement and sprint', () => {
    const { scene, cursors, wasd } = createSceneStub();
    const player = new Player(scene as any, 10, 20);

    cursors.right.isDown = true;
    wasd.SHIFT.isDown = true;
    player.update();

    expect((player as any).body.velocity.x).toBe(600);
    expect((player as any).body.velocity.y).toBe(0);
  });

  it('normalizes diagonal movement speed', () => {
    const { scene, cursors } = createSceneStub();
    const player = new Player(scene as any, 10, 20);

    cursors.right.isDown = true;
    cursors.up.isDown = true;
    player.update();

    const vx = (player as any).body.velocity.x;
    const vy = (player as any).body.velocity.y;
    const magnitude = Math.sqrt(vx * vx + vy * vy);
    expect(Math.round(magnitude)).toBe(300);
  });

  it('disables movement and keeps velocity at zero while disabled', () => {
    const { scene, cursors } = createSceneStub();
    const player = new Player(scene as any, 10, 20);

    cursors.left.isDown = true;
    player.disableMovement();
    player.update();

    expect((player as any).body.velocity.x).toBe(0);
    expect((player as any).body.velocity.y).toBe(0);
    player.enableMovement();
    player.update();
    expect((player as any).body.velocity.x).toBeLessThan(0);
  });
});

