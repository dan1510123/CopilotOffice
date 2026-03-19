import { describe, expect, it, vi } from 'vitest';
import {
  Direction,
  directionFromVelocity,
  directionName,
  getFrameIndex,
  getStandFrame,
  registerWalkAnimations,
  walkAnimKey,
  WALK_FRAME_RATE,
} from '../../../src/sprites/DirectionalSprite';

describe('sprites/DirectionalSprite', () => {
  it('computes frame indices and stand frames', () => {
    expect(getFrameIndex(Direction.DOWN, 0)).toBe(0);
    expect(getFrameIndex(Direction.LEFT, 2)).toBe(5);
    expect(getStandFrame(Direction.UP)).toBe(9);
  });

  it('derives direction from velocity with vertical tie-breaker', () => {
    expect(directionFromVelocity(0, 0)).toBeNull();
    expect(directionFromVelocity(10, 0)).toBe(Direction.RIGHT);
    expect(directionFromVelocity(-10, 2)).toBe(Direction.LEFT);
    expect(directionFromVelocity(2, -2)).toBe(Direction.UP);
    expect(directionFromVelocity(2, 2)).toBe(Direction.DOWN);
  });

  it('builds animation keys and direction names', () => {
    expect(walkAnimKey('player', Direction.RIGHT)).toBe('player_walk_right');
    expect(directionName(Direction.LEFT)).toBe('left');
  });

  it('registers walk animations only when missing', () => {
    const anims = {
      exists: vi.fn((key: string) => key === 'npc_walk_down'),
      create: vi.fn(),
    };

    registerWalkAnimations(anims as any, 'npc');

    expect(anims.exists).toHaveBeenCalledWith('npc_walk_down');
    expect(anims.create).toHaveBeenCalledTimes(3);
    const firstCall = anims.create.mock.calls[0][0];
    expect(firstCall.frameRate).toBe(WALK_FRAME_RATE);
    expect(firstCall.repeat).toBe(-1);
    expect(firstCall.frames).toHaveLength(4);
  });
});

