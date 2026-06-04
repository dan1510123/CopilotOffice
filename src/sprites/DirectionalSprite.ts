/**
 * Directional sprite system for 4-direction walking animation.
 *
 * Spritesheet layout per character (3 columns × 4 rows = 12 frames):
 *
 *        Col 0 (stand)  Col 1 (step-L)  Col 2 (step-R)
 * Row 0: Down/stand      Down/stepL       Down/stepR
 * Row 1: Left/stand      Left/stepL       Left/stepR
 * Row 2: Right/stand     Right/stepL      Right/stepR
 * Row 3: Up/stand        Up/stepL         Up/stepR
 *
 * Each frame: 32×34 px. Full sheet: 96×136 px.
 */

export const enum Direction {
  DOWN = 0,
  LEFT = 1,
  RIGHT = 2,
  UP = 3,
}

export const SPRITE_COLS = 3;
export const SPRITE_ROWS = 4;
export const FRAME_WIDTH = 32;
export const FRAME_HEIGHT = 34;
export const SHEET_WIDTH = FRAME_WIDTH * SPRITE_COLS;   // 96
export const SHEET_HEIGHT = FRAME_HEIGHT * SPRITE_ROWS; // 136

export const WALK_FRAME_RATE = 8;

/** Get the spritesheet frame index for a direction + walk frame (0=stand, 1=stepL, 2=stepR). */
export function getFrameIndex(direction: Direction, walkFrame: 0 | 1 | 2 = 0): number {
  return direction * SPRITE_COLS + walkFrame;
}

/** Get the stand (idle) frame index for a direction. */
export function getStandFrame(direction: Direction): number {
  return getFrameIndex(direction, 0);
}

/** Build the animation key string for a character + direction. */
export function walkAnimKey(spriteKey: string, direction: Direction): string {
  const dirNames: Record<Direction, string> = {
    [Direction.DOWN]: 'down',
    [Direction.LEFT]: 'left',
    [Direction.RIGHT]: 'right',
    [Direction.UP]: 'up',
  };
  return `${spriteKey}_walk_${dirNames[direction]}`;
}

/** Direction name for debugging. */
export function directionName(direction: Direction): string {
  return (['down', 'left', 'right', 'up'] as const)[direction];
}

/** Determine the Direction from a velocity vector. Returns null if stationary. */
export function directionFromVelocity(vx: number, vy: number): Direction | null {
  if (vx === 0 && vy === 0) return null;
  // Dominant axis wins; ties go to vertical (classic RPG convention)
  if (Math.abs(vx) > Math.abs(vy)) {
    return vx < 0 ? Direction.LEFT : Direction.RIGHT;
  }
  return vy < 0 ? Direction.UP : Direction.DOWN;
}

// ── Walk state reducer ──────────────────────────────────────────────────────
//
// Pure helper for the velocity-driven walk state machine used by entities that
// move under continuous physics input (Player). Centralizes the "if moving →
// play directional anim, else → stand frame at last direction" branching so
// the entity update loop stays focused on physics + intent.

export interface WalkState {
  /** Last facing direction. Used as the idle stand-frame direction. */
  direction: Direction;
  /** True if a walk animation is currently playing. */
  isWalking: boolean;
}

export type WalkAction =
  | { kind: 'idle'; direction: Direction; standFrame: number }
  | { kind: 'play'; direction: Direction; animKey: string; directionChanged: boolean };

/**
 * Compute the next walk action given a velocity sample and the current walk
 * state. The caller applies the returned action to the Phaser sprite
 * (`anims.play(animKey)` / `setFrame(standFrame)`) and updates its own state
 * (`direction`, `isWalking`). Side-effect free.
 *
 * - Stationary velocity → `idle` at the previous direction's stand frame.
 * - Moving velocity     → `play` of the appropriate directional walk anim.
 *   `directionChanged` flags transitions so callers can avoid restarting the
 *   anim on every tick.
 */
export function nextWalkAction(
  spriteKey: string,
  vx: number,
  vy: number,
  current: WalkState
): WalkAction {
  const newDir = directionFromVelocity(vx, vy);
  if (newDir === null) {
    return {
      kind: 'idle',
      direction: current.direction,
      standFrame: getStandFrame(current.direction),
    };
  }
  return {
    kind: 'play',
    direction: newDir,
    animKey: walkAnimKey(spriteKey, newDir),
    directionChanged: newDir !== current.direction,
  };
}

/**
 * Register walk animations for a character in the Phaser animation manager.
 * Creates 4 animations: {spriteKey}_walk_down, _walk_left, _walk_right, _walk_up.
 * Walk cycle: stand → stepL → stand → stepR (4-frame loop using 3 unique frames).
 */
export function registerWalkAnimations(
  anims: Phaser.Animations.AnimationManager,
  spriteKey: string,
): void {
  const directions: Direction[] = [Direction.DOWN, Direction.LEFT, Direction.RIGHT, Direction.UP];

  for (const dir of directions) {
    const key = walkAnimKey(spriteKey, dir);
    if (anims.exists(key)) continue;

    const stand = getFrameIndex(dir, 0);
    const stepL = getFrameIndex(dir, 1);
    const stepR = getFrameIndex(dir, 2);

    anims.create({
      key,
      frames: [
        { key: spriteKey, frame: stand },
        { key: spriteKey, frame: stepL },
        { key: spriteKey, frame: stand },
        { key: spriteKey, frame: stepR },
      ],
      frameRate: WALK_FRAME_RATE,
      repeat: -1,
    });
  }
}
