import { describe, expect, it, vi } from 'vitest';
import {
  Direction,
  directionFromVelocity,
  directionName,
  getFrameIndex,
  getStandFrame,
  nextWalkAction,
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

describe('sprites/DirectionalSprite.nextWalkAction (walk-state reducer)', () => {
  it('returns idle with the last direction when velocity is zero', () => {
    const action = nextWalkAction('player', 0, 0, {
      direction: Direction.UP,
      isWalking: true,
    });
    expect(action.kind).toBe('idle');
    if (action.kind === 'idle') {
      expect(action.direction).toBe(Direction.UP);
      expect(action.standFrame).toBe(getStandFrame(Direction.UP));
    }
  });

  it('returns play with the correct animKey for moving velocity', () => {
    const action = nextWalkAction('player', 5, 0, {
      direction: Direction.DOWN,
      isWalking: false,
    });
    expect(action.kind).toBe('play');
    if (action.kind === 'play') {
      expect(action.direction).toBe(Direction.RIGHT);
      expect(action.animKey).toBe('player_walk_right');
      expect(action.directionChanged).toBe(true);
    }
  });

  it('flags directionChanged=false when continuing in the same direction', () => {
    const action = nextWalkAction('player', 5, 0, {
      direction: Direction.RIGHT,
      isWalking: true,
    });
    expect(action.kind).toBe('play');
    if (action.kind === 'play') {
      expect(action.directionChanged).toBe(false);
    }
  });

  it('honors the dominant-axis tie-breaker (vertical wins)', () => {
    const action = nextWalkAction('npc', 3, -3, {
      direction: Direction.DOWN,
      isWalking: false,
    });
    expect(action.kind).toBe('play');
    if (action.kind === 'play') {
      expect(action.direction).toBe(Direction.UP);
      expect(action.animKey).toBe('npc_walk_up');
    }
  });

  it('uses the supplied spriteKey for the animKey (not hardcoded)', () => {
    const action = nextWalkAction('custom_hero', 0, 5, {
      direction: Direction.UP,
      isWalking: false,
    });
    expect(action.kind).toBe('play');
    if (action.kind === 'play') {
      expect(action.animKey).toBe('custom_hero_walk_down');
    }
  });
});

