/**
 * Procedural spritesheet generator for 4-direction walking characters.
 * Generates 12-frame spritesheets (4 directions × 3 walk frames) for the player and all NPCs.
 *
 * Spritesheet layout (3 cols × 4 rows, each 32×34px):
 *   Col 0 = stand, Col 1 = step-left, Col 2 = step-right
 *   Row 0 = DOWN,  Row 1 = LEFT,  Row 2 = RIGHT (mirror), Row 3 = UP
 */

import Phaser from 'phaser';
import {
  FRAME_WIDTH, FRAME_HEIGHT, SPRITE_COLS, SPRITE_ROWS,
  SHEET_WIDTH, SHEET_HEIGHT,
} from './DirectionalSprite';

/* ------------------------------------------------------------------ */
/*  Drawing context with offset support                                */
/* ------------------------------------------------------------------ */

interface DrawCtx {
  fillStyle(color: number, alpha?: number): DrawCtx;
  rect(x: number, y: number, w: number, h: number): DrawCtx;
  circle(x: number, y: number, r: number): DrawCtx;
  tri(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): DrawCtx;
}

/** Normal draw context — offsets all coordinates to a frame position. */
class D implements DrawCtx {
  constructor(private g: Phaser.GameObjects.Graphics, private ox: number, private oy: number) {}
  fillStyle(c: number, a = 1) { this.g.fillStyle(c, a); return this; }
  rect(x: number, y: number, w: number, h: number) { this.g.fillRect(this.ox + x, this.oy + y, w, h); return this; }
  circle(x: number, y: number, r: number) { this.g.fillCircle(this.ox + x, this.oy + y, r); return this; }
  tri(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    this.g.fillTriangle(
      this.ox + x1, this.oy + y1,
      this.ox + x2, this.oy + y2,
      this.ox + x3, this.oy + y3,
    );
    return this;
  }
}

/** Mirroring draw context — flips X coordinates horizontally within a frame. Used for RIGHT = mirror of LEFT. */
class MirrorD implements DrawCtx {
  constructor(private g: Phaser.GameObjects.Graphics, private ox: number, private oy: number, private fw: number = FRAME_WIDTH) {}
  fillStyle(c: number, a = 1) { this.g.fillStyle(c, a); return this; }
  rect(x: number, y: number, w: number, h: number) {
    this.g.fillRect(this.ox + (this.fw - x - w), this.oy + y, w, h); return this;
  }
  circle(x: number, y: number, r: number) {
    this.g.fillCircle(this.ox + (this.fw - x), this.oy + y, r); return this;
  }
  tri(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    const m = (v: number) => this.fw - v;
    this.g.fillTriangle(
      this.ox + m(x1), this.oy + y1,
      this.ox + m(x2), this.oy + y2,
      this.ox + m(x3), this.oy + y3,
    );
    return this;
  }
}

/* ------------------------------------------------------------------ */
/*  Walk frame leg offsets                                             */
/* ------------------------------------------------------------------ */

// [leftLegDY, rightLegDY] — positive = down (forward for front view)
const WALK_LEGS: [number, number][] = [
  [0, 0],    // frame 0: stand
  [-1, 1],   // frame 1: left leg up, right leg down
  [1, -1],   // frame 2: left leg down, right leg up
];

/* ------------------------------------------------------------------ */
/*  Hero config type                                                   */
/* ------------------------------------------------------------------ */

export interface HeroConfig {
  skinColor: number;
  hairColor: number;
  hairStyle: string;
  helmetColor?: number;
  bodyColor: number;
  bodyStyle: string;
  accessory: string;
  accessoryColor: number;
}

/* ------------------------------------------------------------------ */
/*  Spritesheet finalization                                           */
/* ------------------------------------------------------------------ */

function finalizeSpritesheet(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics, name: string): void {
  const tempKey = `_tmp_${name}`;
  g.generateTexture(tempKey, SHEET_WIDTH, SHEET_HEIGHT);
  g.destroy();

  // Copy to a standalone canvas before removing the temp texture,
  // because textures.remove() recycles the canvas via CanvasPool.
  const srcCanvas = scene.textures.get(tempKey).getSourceImage() as HTMLCanvasElement;
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_WIDTH;
  canvas.height = SHEET_HEIGHT;
  canvas.getContext('2d')!.drawImage(srcCanvas, 0, 0);

  scene.textures.remove(tempKey);
  scene.textures.addSpriteSheet(name, canvas, {
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
  });
}

/* ================================================================== */
/*  PLAYER SPRITESHEET                                                 */
/* ================================================================== */

export function generatePlayerSpritesheet(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 });

  for (let wf = 0; wf < 3; wf++) {
    const [ldy, rdy] = WALK_LEGS[wf];
    const ox = wf * FRAME_WIDTH;

    // Row 0: DOWN
    drawPlayerDown(new D(g, ox, 0), ldy, rdy);
    // Row 1: LEFT
    const leftCtx = new D(g, ox, FRAME_HEIGHT);
    drawPlayerLeft(leftCtx, ldy, rdy);
    // Row 2: RIGHT (mirror of LEFT)
    const rightCtx = new MirrorD(g, ox, 2 * FRAME_HEIGHT);
    drawPlayerLeft(rightCtx, rdy, ldy); // swap leg offsets for mirror
    // Row 3: UP
    drawPlayerUp(new D(g, ox, 3 * FRAME_HEIGHT), ldy, rdy);
  }

  finalizeSpritesheet(scene, g, 'player');
}

/* -- Player DOWN (front) -- */
function drawPlayerDown(d: DrawCtx, ldy: number, rdy: number): void {
  // Hair
  d.fillStyle(0x2a1a0a).rect(10, 2, 12, 6);
  // Face
  d.fillStyle(0xffdbac).rect(10, 6, 12, 10);
  // Eyes
  d.fillStyle(0x000000).rect(12, 9, 2, 2).rect(18, 9, 2, 2);
  // Smile
  d.fillStyle(0x000000).rect(14, 13, 4, 1);
  // Suit jacket
  d.fillStyle(0x1a2a4a).rect(6, 16, 20, 12);
  // Collar
  d.fillStyle(0xffffff).rect(13, 16, 6, 4);
  // Tie
  d.fillStyle(0xcc2222).rect(15, 18, 2, 8);
  // Hands
  d.fillStyle(0xffdbac).rect(4, 24, 4, 4).rect(24, 24, 4, 4);
  // Pants
  d.fillStyle(0x1a1a2a).rect(10, 28 + ldy, 5, 4).rect(17, 28 + rdy, 5, 4);
  // Shoes
  d.fillStyle(0x111111).rect(9, 31 + ldy, 6, 2).rect(17, 31 + rdy, 6, 2);
}

/* -- Player UP (back) -- */
function drawPlayerUp(d: DrawCtx, ldy: number, rdy: number): void {
  // Hair (covers back of head fully)
  d.fillStyle(0x2a1a0a).rect(10, 2, 12, 14);
  // Ears
  d.fillStyle(0xffdbac).rect(9, 9, 2, 4).rect(21, 9, 2, 4);
  // Suit back
  d.fillStyle(0x1a2a4a).rect(6, 16, 20, 12);
  // Back seam
  d.fillStyle(0x141e38).rect(15, 16, 2, 12);
  // Hands
  d.fillStyle(0xffdbac).rect(4, 24, 4, 4).rect(24, 24, 4, 4);
  // Pants
  d.fillStyle(0x1a1a2a).rect(10, 28 + ldy, 5, 4).rect(17, 28 + rdy, 5, 4);
  // Shoes
  d.fillStyle(0x111111).rect(9, 31 + ldy, 6, 2).rect(17, 31 + rdy, 6, 2);
}

/* -- Player LEFT (side profile) -- */
function drawPlayerLeft(d: DrawCtx, ldy: number, rdy: number): void {
  // Hair (side)
  d.fillStyle(0x2a1a0a).rect(12, 2, 10, 7);
  // Head (narrower profile)
  d.fillStyle(0xffdbac).rect(10, 6, 10, 10);
  // One eye
  d.fillStyle(0x000000).rect(11, 9, 2, 2);
  // Nose
  d.fillStyle(0xeec89a).rect(9, 11, 2, 3);
  // Suit (profile)
  d.fillStyle(0x1a2a4a).rect(10, 16, 14, 12);
  // Collar edge
  d.fillStyle(0xffffff).rect(10, 16, 3, 3);
  // Arm
  d.fillStyle(0x1a2a4a).rect(20, 18, 4, 8);
  // Hand
  d.fillStyle(0xffdbac).rect(20, 26, 4, 3);
  // Front leg
  d.fillStyle(0x1a1a2a).rect(11, 28 + ldy, 6, 4);
  // Back leg (partially hidden)
  d.fillStyle(0x1a1a2a).rect(15, 28 + rdy, 5, 4);
  // Front shoe
  d.fillStyle(0x111111).rect(9, 31 + ldy, 7, 2);
  // Back shoe
  d.fillStyle(0x111111).rect(15, 31 + rdy, 5, 2);
}

/* ================================================================== */
/*  HERO (NPC) SPRITESHEET                                             */
/* ================================================================== */

export function generateHeroSpritesheet(scene: Phaser.Scene, name: string, config: HeroConfig): void {
  const g = scene.make.graphics({ x: 0, y: 0 });

  for (let wf = 0; wf < 3; wf++) {
    const [ldy, rdy] = WALK_LEGS[wf];
    const ox = wf * FRAME_WIDTH;

    // Row 0: DOWN
    drawHeroFrame(new D(g, ox, 0), config, 'down', ldy, rdy);
    // Row 1: LEFT
    drawHeroFrame(new D(g, ox, FRAME_HEIGHT), config, 'left', ldy, rdy);
    // Row 2: RIGHT (mirror of LEFT)
    drawHeroFrame(new MirrorD(g, ox, 2 * FRAME_HEIGHT), config, 'left', rdy, ldy);
    // Row 3: UP
    drawHeroFrame(new D(g, ox, 3 * FRAME_HEIGHT), config, 'up', ldy, rdy);
  }

  finalizeSpritesheet(scene, g, name);
}

type Dir = 'down' | 'up' | 'left';

function drawHeroFrame(d: DrawCtx, c: HeroConfig, dir: Dir, ldy: number, rdy: number): void {
  drawHeroHead(d, c, dir);
  drawHeroHair(d, c, dir);
  drawHeroBody(d, c, dir, ldy, rdy);
  drawHeroAccessory(d, c, dir);
}

/* ------------------------------------------------------------------ */
/*  Head                                                               */
/* ------------------------------------------------------------------ */

function drawHeroHead(d: DrawCtx, c: HeroConfig, dir: Dir): void {
  if (dir === 'down') {
    d.fillStyle(c.skinColor).rect(10, 6, 12, 12);
    // Eyes
    d.fillStyle(0x000000).rect(12, 10, 2, 3).rect(18, 10, 2, 3);
    // Eye shine
    d.fillStyle(0xffffff).rect(12, 10, 1, 1).rect(18, 10, 1, 1);
  } else if (dir === 'up') {
    d.fillStyle(c.skinColor).rect(10, 6, 12, 12);
    // Ears
    d.fillStyle(c.skinColor).rect(9, 9, 2, 4).rect(21, 9, 2, 4);
  } else {
    // LEFT side profile
    d.fillStyle(c.skinColor).rect(12, 6, 8, 12);
    // One eye
    d.fillStyle(0x000000).rect(13, 10, 2, 3);
    d.fillStyle(0xffffff).rect(13, 10, 1, 1);
    // Nose/chin profile
    d.fillStyle(c.skinColor).rect(10, 11, 3, 3);
  }
}

/* ------------------------------------------------------------------ */
/*  Hair                                                               */
/* ------------------------------------------------------------------ */

function drawHeroHair(d: DrawCtx, c: HeroConfig, dir: Dir): void {
  switch (c.hairStyle) {
    case 'spiky':
      if (dir === 'down') {
        d.fillStyle(c.hairColor).rect(8, 2, 16, 6);
        d.tri(8, 2, 12, 2, 10, -2).tri(14, 2, 18, 2, 16, -3).tri(20, 2, 24, 2, 22, -1);
      } else if (dir === 'up') {
        d.fillStyle(c.hairColor).rect(8, 2, 16, 10);
        d.tri(8, 2, 12, 2, 10, -2).tri(14, 2, 18, 2, 16, -3).tri(20, 2, 24, 2, 22, -1);
      } else {
        d.fillStyle(c.hairColor).rect(10, 2, 12, 7);
        d.tri(10, 2, 14, 2, 12, -2).tri(16, 2, 20, 2, 18, -3);
      }
      break;

    case 'helmet':
      if (dir === 'down') {
        d.fillStyle(c.helmetColor || c.hairColor).rect(8, 0, 16, 10);
        d.fillStyle(0x666666).rect(10, 8, 12, 2);
        d.fillStyle(0x88ccff).rect(11, 4, 10, 4);
      } else if (dir === 'up') {
        d.fillStyle(c.helmetColor || c.hairColor).rect(8, 0, 16, 14);
        d.fillStyle(0x666666).rect(10, 12, 12, 2);
      } else {
        d.fillStyle(c.helmetColor || c.hairColor).rect(10, 0, 12, 12);
        d.fillStyle(0x666666).rect(10, 10, 10, 2);
        // Side visor edge
        d.fillStyle(0x88ccff).rect(10, 4, 4, 4);
      }
      break;

    case 'goggles':
      if (dir === 'down') {
        d.fillStyle(c.hairColor).rect(10, 2, 12, 6);
        d.fillStyle(0x444444).rect(8, 6, 16, 4);
        d.fillStyle(0xffaa44).rect(10, 7, 5, 2).rect(17, 7, 5, 2);
      } else if (dir === 'up') {
        d.fillStyle(c.hairColor).rect(10, 2, 12, 10);
        // Goggle strap
        d.fillStyle(0x444444).rect(8, 6, 16, 2);
      } else {
        d.fillStyle(c.hairColor).rect(12, 2, 8, 7);
        // Goggle from side
        d.fillStyle(0x444444).rect(10, 6, 10, 4);
        d.fillStyle(0xffaa44).rect(10, 7, 4, 2);
      }
      break;

    case 'short':
      if (dir === 'down') {
        d.fillStyle(c.hairColor).rect(10, 2, 12, 5);
      } else if (dir === 'up') {
        d.fillStyle(c.hairColor).rect(10, 2, 12, 8);
      } else {
        d.fillStyle(c.hairColor).rect(12, 2, 8, 6);
      }
      break;

    case 'long':
      if (dir === 'down') {
        d.fillStyle(c.hairColor).rect(8, 2, 16, 8);
        d.fillStyle(c.hairColor).rect(6, 8, 4, 12).rect(22, 8, 4, 12);
      } else if (dir === 'up') {
        d.fillStyle(c.hairColor).rect(8, 2, 16, 10);
        d.fillStyle(c.hairColor).rect(6, 8, 4, 14).rect(22, 8, 4, 14);
      } else {
        d.fillStyle(c.hairColor).rect(10, 2, 12, 8);
        // Visible side hair drape
        d.fillStyle(c.hairColor).rect(8, 8, 4, 12);
      }
      break;

    case 'bun':
      if (dir === 'down') {
        d.fillStyle(c.hairColor).rect(10, 3, 12, 5);
        d.circle(16, 2, 4);
      } else if (dir === 'up') {
        d.fillStyle(c.hairColor).rect(10, 3, 12, 8);
        d.circle(16, 2, 4);
      } else {
        d.fillStyle(c.hairColor).rect(12, 3, 8, 6);
        d.circle(16, 1, 4);
      }
      break;
  }
}

/* ------------------------------------------------------------------ */
/*  Body                                                               */
/* ------------------------------------------------------------------ */

function drawHeroBody(d: DrawCtx, c: HeroConfig, dir: Dir, ldy: number, rdy: number): void {
  switch (c.bodyStyle) {
    case 'robe':
      drawRobe(d, c, dir, ldy);
      break;
    case 'armor':
      drawArmor(d, c, dir, ldy, rdy);
      break;
    case 'pilot':
      drawPilot(d, c, dir, ldy, rdy);
      break;
    case 'coat':
      drawCoat(d, c, dir, ldy, rdy);
      break;
    case 'cloak':
      drawCloak(d, c, dir, ldy);
      break;
    case 'vest':
      drawVest(d, c, dir, ldy, rdy);
      break;
  }
}

/* -- Robe -- */
function drawRobe(d: DrawCtx, c: HeroConfig, dir: Dir, ldy: number): void {
  if (dir === 'down') {
    d.fillStyle(c.bodyColor).rect(6, 18, 20, 14);
    d.tri(6, 32, 26, 32, 16, 18);
    d.fillStyle(0xffcc00).rect(14, 18, 4, 14);
    // Walk: hem shifts
    if (ldy !== 0) d.fillStyle(c.bodyColor).rect(6, 30, 20, 2 + Math.abs(ldy));
  } else if (dir === 'up') {
    d.fillStyle(c.bodyColor).rect(6, 18, 20, 14);
    d.tri(6, 32, 26, 32, 16, 18);
    // Back seam
    d.fillStyle(darken(c.bodyColor)).rect(15, 18, 2, 14);
    if (ldy !== 0) d.fillStyle(c.bodyColor).rect(6, 30, 20, 2 + Math.abs(ldy));
  } else {
    d.fillStyle(c.bodyColor).rect(8, 18, 16, 14);
    d.tri(8, 32, 24, 32, 16, 18);
    // Side trim
    d.fillStyle(0xffcc00).rect(12, 18, 2, 14);
    if (ldy !== 0) d.fillStyle(c.bodyColor).rect(8, 30, 16, 2 + Math.abs(ldy));
  }
}

/* -- Armor -- */
function drawArmor(d: DrawCtx, c: HeroConfig, dir: Dir, ldy: number, rdy: number): void {
  if (dir === 'down') {
    d.fillStyle(c.bodyColor).rect(6, 18, 20, 12);
    // Shoulder pads
    d.rect(2, 18, 6, 6).rect(24, 18, 6, 6);
    // Belt
    d.fillStyle(0x8b4513).rect(6, 26, 20, 3);
    // Legs
    d.fillStyle(0x666666).rect(8, 30 + ldy, 6, 2).rect(18, 30 + rdy, 6, 2);
    // Boots
    d.fillStyle(0x4a3a2a).rect(7, 32 + ldy, 7, 2).rect(17, 32 + rdy, 7, 2);
  } else if (dir === 'up') {
    d.fillStyle(c.bodyColor).rect(6, 18, 20, 12);
    d.rect(2, 18, 6, 6).rect(24, 18, 6, 6);
    d.fillStyle(0x8b4513).rect(6, 26, 20, 3);
    // Back plate detail
    d.fillStyle(darken(c.bodyColor)).rect(12, 19, 8, 6);
    d.fillStyle(0x666666).rect(8, 30 + ldy, 6, 2).rect(18, 30 + rdy, 6, 2);
    d.fillStyle(0x4a3a2a).rect(7, 32 + ldy, 7, 2).rect(17, 32 + rdy, 7, 2);
  } else {
    d.fillStyle(c.bodyColor).rect(8, 18, 16, 12);
    // One shoulder pad
    d.rect(20, 18, 6, 6);
    d.fillStyle(0x8b4513).rect(8, 26, 16, 3);
    d.fillStyle(0x666666).rect(10, 30 + ldy, 6, 2).rect(14, 30 + rdy, 5, 2);
    d.fillStyle(0x4a3a2a).rect(9, 32 + ldy, 7, 2).rect(13, 32 + rdy, 6, 2);
  }
}

/* -- Pilot -- */
function drawPilot(d: DrawCtx, c: HeroConfig, dir: Dir, ldy: number, rdy: number): void {
  if (dir === 'down') {
    d.fillStyle(c.bodyColor).rect(8, 18, 16, 10);
    d.fillStyle(0xffffff).rect(10, 18, 2, 4).rect(20, 18, 2, 4);
    d.fillStyle(0x333333).rect(8, 26, 16, 2);
    d.fillStyle(0xffcc00).rect(14, 26, 4, 2);
    d.fillStyle(0x333333).rect(8, 28 + ldy, 6, 6).rect(18, 28 + rdy, 6, 6);
  } else if (dir === 'up') {
    d.fillStyle(c.bodyColor).rect(8, 18, 16, 10);
    d.fillStyle(darken(c.bodyColor)).rect(15, 18, 2, 10);
    d.fillStyle(0x333333).rect(8, 26, 16, 2);
    d.fillStyle(0x333333).rect(8, 28 + ldy, 6, 6).rect(18, 28 + rdy, 6, 6);
  } else {
    d.fillStyle(c.bodyColor).rect(10, 18, 12, 10);
    d.fillStyle(0xffffff).rect(10, 18, 2, 4);
    d.fillStyle(0x333333).rect(10, 26, 12, 2);
    d.fillStyle(0xffcc00).rect(14, 26, 3, 2);
    d.fillStyle(0x333333).rect(10, 28 + ldy, 6, 6).rect(14, 28 + rdy, 5, 6);
  }
}

/* -- Coat -- */
function drawCoat(d: DrawCtx, c: HeroConfig, dir: Dir, ldy: number, rdy: number): void {
  if (dir === 'down') {
    d.fillStyle(c.bodyColor).rect(6, 18, 20, 12);
    d.fillStyle(0xdddddd).rect(10, 18, 4, 8).rect(18, 18, 4, 8);
    d.fillStyle(0x88ccff).rect(13, 18, 6, 6);
    // Pants
    d.fillStyle(0x2a2a4a).rect(10, 30 + ldy, 5, 2).rect(17, 30 + rdy, 5, 2);
    // Shoes
    d.fillStyle(0x222222).rect(9, 32 + ldy, 6, 2).rect(16, 32 + rdy, 6, 2);
  } else if (dir === 'up') {
    d.fillStyle(c.bodyColor).rect(6, 18, 20, 12);
    d.fillStyle(darken(c.bodyColor)).rect(15, 18, 2, 12);
    d.fillStyle(0x2a2a4a).rect(10, 30 + ldy, 5, 2).rect(17, 30 + rdy, 5, 2);
    d.fillStyle(0x222222).rect(9, 32 + ldy, 6, 2).rect(16, 32 + rdy, 6, 2);
  } else {
    d.fillStyle(c.bodyColor).rect(8, 18, 16, 12);
    // Lapel edge
    d.fillStyle(0xdddddd).rect(8, 18, 3, 8);
    d.fillStyle(0x88ccff).rect(10, 18, 4, 6);
    // Pants
    d.fillStyle(0x2a2a4a).rect(10, 30 + ldy, 6, 2).rect(14, 30 + rdy, 5, 2);
    // Shoes
    d.fillStyle(0x222222).rect(9, 32 + ldy, 7, 2).rect(13, 32 + rdy, 6, 2);
  }
}

/* -- Cloak -- */
function drawCloak(d: DrawCtx, c: HeroConfig, dir: Dir, ldy: number): void {
  if (dir === 'down') {
    d.fillStyle(c.bodyColor).rect(4, 16, 24, 16);
    d.fillStyle(0x000000, 0.3).rect(8, 4, 16, 4);
    d.fillStyle(0x4a3a5a).rect(12, 20, 8, 10);
    if (ldy !== 0) d.fillStyle(c.bodyColor).rect(4, 30, 24, 2 + Math.abs(ldy));
  } else if (dir === 'up') {
    d.fillStyle(c.bodyColor).rect(4, 16, 24, 16);
    d.fillStyle(0x000000, 0.3).rect(8, 4, 16, 4);
    // Back clasp
    d.fillStyle(darken(c.bodyColor)).rect(14, 16, 4, 4);
    if (ldy !== 0) d.fillStyle(c.bodyColor).rect(4, 30, 24, 2 + Math.abs(ldy));
  } else {
    d.fillStyle(c.bodyColor).rect(6, 16, 20, 16);
    d.fillStyle(0x000000, 0.3).rect(10, 4, 10, 4);
    d.fillStyle(0x4a3a5a).rect(8, 20, 6, 10);
    if (ldy !== 0) d.fillStyle(c.bodyColor).rect(6, 30, 20, 2 + Math.abs(ldy));
  }
}

/* -- Vest -- */
function drawVest(d: DrawCtx, c: HeroConfig, dir: Dir, ldy: number, rdy: number): void {
  if (dir === 'down') {
    d.fillStyle(0xffffff).rect(8, 18, 16, 10);
    d.fillStyle(c.bodyColor).rect(6, 18, 6, 12).rect(20, 18, 6, 12);
    d.fillStyle(0xaa0000).rect(13, 18, 6, 3);
    // Pants
    d.fillStyle(0x1a1a1a).rect(10, 28 + ldy, 5, 4).rect(17, 28 + rdy, 5, 4);
    // Shoes
    d.fillStyle(0x2a1a0a).rect(9, 32 + ldy, 6, 2).rect(16, 32 + rdy, 6, 2);
  } else if (dir === 'up') {
    d.fillStyle(c.bodyColor).rect(6, 18, 20, 12);
    // Back strap
    d.fillStyle(darken(c.bodyColor)).rect(14, 18, 4, 10);
    // Pants
    d.fillStyle(0x1a1a1a).rect(10, 28 + ldy, 5, 4).rect(17, 28 + rdy, 5, 4);
    // Shoes
    d.fillStyle(0x2a1a0a).rect(9, 32 + ldy, 6, 2).rect(16, 32 + rdy, 6, 2);
  } else {
    d.fillStyle(0xffffff).rect(10, 18, 12, 10);
    d.fillStyle(c.bodyColor).rect(8, 18, 5, 12).rect(19, 18, 5, 12);
    // Pants
    d.fillStyle(0x1a1a1a).rect(10, 28 + ldy, 6, 4).rect(14, 28 + rdy, 5, 4);
    // Shoes
    d.fillStyle(0x2a1a0a).rect(9, 32 + ldy, 7, 2).rect(13, 32 + rdy, 6, 2);
  }
}

/* ------------------------------------------------------------------ */
/*  Accessories                                                        */
/* ------------------------------------------------------------------ */

function drawHeroAccessory(d: DrawCtx, c: HeroConfig, dir: Dir): void {
  switch (c.accessory) {
    case 'staff':
      drawStaff(d, c, dir);
      break;
    case 'shield':
      drawShield(d, c, dir);
      break;
    case 'rocket':
      drawRocket(d, c, dir);
      break;
    case 'stethoscope':
      drawStethoscope(d, c, dir);
      break;
    case 'binoculars':
      drawBinoculars(d, c, dir);
      break;
    case 'coins':
      drawCoins(d, c, dir);
      break;
    case 'meta':
      drawMeta(d, c, dir);
      break;
    case 'book':
      drawBook(d, c, dir);
      break;
    case 'blueprint':
      drawBlueprint(d, c, dir);
      break;
  }
}

/* -- Staff -- */
function drawStaff(d: DrawCtx, c: HeroConfig, dir: Dir): void {
  if (dir === 'down') {
    d.fillStyle(0x8b4513).rect(26, 4, 3, 28);
    d.fillStyle(c.accessoryColor).circle(28, 4, 4);
  } else if (dir === 'up') {
    d.fillStyle(0x8b4513).rect(26, 4, 3, 28);
    d.fillStyle(c.accessoryColor).circle(28, 4, 4);
  } else {
    // Held behind/beside in side view
    d.fillStyle(0x8b4513).rect(22, 4, 3, 28);
    d.fillStyle(c.accessoryColor).circle(24, 4, 3);
  }
}

/* -- Shield -- */
function drawShield(d: DrawCtx, c: HeroConfig, dir: Dir): void {
  if (dir === 'down') {
    d.fillStyle(c.accessoryColor).rect(0, 18, 6, 12);
    d.fillStyle(0xffffff).rect(1, 22, 4, 4);
  } else if (dir === 'up') {
    // Shield on arm, visible from behind
    d.fillStyle(c.accessoryColor).rect(0, 18, 6, 12);
    d.fillStyle(0xffffff).rect(1, 22, 4, 4);
  } else {
    // Shield held in front
    d.fillStyle(c.accessoryColor).rect(6, 18, 5, 12);
    d.fillStyle(0xffffff).rect(7, 22, 3, 4);
  }
}

/* -- Rocket -- */
function drawRocket(d: DrawCtx, c: HeroConfig, dir: Dir): void {
  if (dir === 'down') {
    d.fillStyle(c.accessoryColor).rect(26, 20, 5, 10);
    d.tri(26, 20, 31, 20, 28, 14);
    d.fillStyle(0xff4400).rect(26, 30, 5, 3);
    d.fillStyle(0xffff00).rect(27, 31, 3, 2);
  } else if (dir === 'up') {
    d.fillStyle(c.accessoryColor).rect(26, 20, 5, 10);
    d.tri(26, 20, 31, 20, 28, 14);
    d.fillStyle(0xff4400).rect(26, 30, 5, 3);
    d.fillStyle(0xffff00).rect(27, 31, 3, 2);
  } else {
    // Rocket behind character
    d.fillStyle(c.accessoryColor).rect(20, 20, 4, 10);
    d.tri(20, 20, 24, 20, 22, 14);
    d.fillStyle(0xff4400).rect(20, 30, 4, 3);
    d.fillStyle(0xffff00).rect(21, 31, 2, 2);
  }
}

/* -- Stethoscope -- */
function drawStethoscope(d: DrawCtx, c: HeroConfig, dir: Dir): void {
  if (dir === 'down') {
    d.fillStyle(c.accessoryColor).circle(16, 28, 3);
    d.fillStyle(0x333333).rect(14, 20, 2, 6).rect(16, 20, 2, 6);
  } else if (dir === 'up') {
    // Tube around neck visible from behind
    d.fillStyle(0x333333).rect(10, 14, 2, 6).rect(20, 14, 2, 6);
  } else {
    // Hanging from side
    d.fillStyle(0x333333).rect(10, 14, 2, 12);
    d.fillStyle(c.accessoryColor).circle(11, 26, 2);
  }
}

/* -- Binoculars -- */
function drawBinoculars(d: DrawCtx, c: HeroConfig, dir: Dir): void {
  if (dir === 'down') {
    d.fillStyle(0x333333).rect(0, 14, 5, 6).rect(2, 12, 6, 4);
    d.fillStyle(c.accessoryColor).circle(2, 17, 2);
  } else if (dir === 'up') {
    // Strap around neck
    d.fillStyle(0x333333).rect(10, 14, 12, 2);
  } else {
    // At side
    d.fillStyle(0x333333).rect(6, 16, 4, 5);
    d.fillStyle(c.accessoryColor).circle(7, 18, 2);
  }
}

/* -- Coins -- */
function drawCoins(d: DrawCtx, c: HeroConfig, dir: Dir): void {
  if (dir === 'down') {
    d.fillStyle(c.accessoryColor).circle(4, 26, 4).circle(6, 22, 3).circle(2, 30, 3);
    d.fillStyle(0xaa8800).rect(3, 25, 2, 2);
  } else if (dir === 'up') {
    // Coin pouch on belt
    d.fillStyle(c.accessoryColor).circle(4, 26, 3);
    d.fillStyle(0xaa8800).rect(3, 25, 2, 2);
  } else {
    // Belt pouch
    d.fillStyle(c.accessoryColor).circle(8, 26, 3);
    d.fillStyle(0xaa8800).rect(7, 25, 2, 2);
  }
}

/* -- Meta -- */
function drawMeta(d: DrawCtx, c: HeroConfig, dir: Dir): void {
  if (dir === 'down') {
    d.fillStyle(0x222222).rect(24, 14, 8, 10);
    d.fillStyle(c.accessoryColor).rect(25, 15, 6, 8);
    d.fillStyle(0xff00ff).rect(27, 17, 2, 4);
    d.fillStyle(0xffaaff).rect(22, 12, 2, 2).rect(30, 10, 2, 2).rect(26, 8, 2, 2);
  } else if (dir === 'up') {
    // Screen back
    d.fillStyle(0x222222).rect(24, 14, 8, 10);
    d.fillStyle(0xffaaff).rect(22, 12, 2, 2).rect(30, 10, 2, 2);
  } else {
    // Side view of device
    d.fillStyle(0x222222).rect(22, 16, 6, 8);
    d.fillStyle(c.accessoryColor).rect(22, 17, 5, 6);
    d.fillStyle(0xffaaff).rect(20, 14, 2, 2).rect(26, 12, 2, 2);
  }
}

/* -- Book -- */
function drawBook(d: DrawCtx, c: HeroConfig, dir: Dir): void {
  if (dir === 'down') {
    d.fillStyle(0x5a3010).rect(0, 18, 4, 14);
    d.fillStyle(c.accessoryColor).rect(1, 19, 7, 12);
    d.fillStyle(0xffffff).rect(2, 20, 5, 10);
    d.fillStyle(0xaaaaaa).rect(3, 22, 3, 1).rect(3, 24, 3, 1).rect(3, 26, 3, 1);
  } else if (dir === 'up') {
    // Under arm
    d.fillStyle(0x5a3010).rect(0, 20, 4, 8);
    d.fillStyle(c.accessoryColor).rect(0, 20, 6, 7);
  } else {
    // Book held in front
    d.fillStyle(0x5a3010).rect(6, 20, 3, 10);
    d.fillStyle(c.accessoryColor).rect(7, 20, 5, 9);
    d.fillStyle(0xffffff).rect(8, 21, 3, 7);
  }
}

/* -- Blueprint -- */
function drawBlueprint(d: DrawCtx, c: HeroConfig, dir: Dir): void {
  if (dir === 'down') {
    d.fillStyle(0x2244aa).rect(24, 12, 7, 18);
    d.fillStyle(c.accessoryColor).rect(25, 15, 5, 1).rect(25, 18, 5, 1).rect(25, 21, 5, 1).rect(27, 14, 1, 10);
    d.fillStyle(0xddddcc).rect(23, 11, 9, 3).rect(23, 27, 9, 3);
    d.fillStyle(0xaaaaff).rect(20, 8, 2, 2).rect(22, 10, 2, 2);
  } else if (dir === 'up') {
    // Scroll on back
    d.fillStyle(0x2244aa).rect(24, 14, 6, 14);
    d.fillStyle(0xddddcc).rect(23, 13, 8, 3).rect(23, 26, 8, 3);
  } else {
    // Scroll at side
    d.fillStyle(0x2244aa).rect(20, 14, 5, 14);
    d.fillStyle(0xddddcc).rect(19, 13, 7, 3).rect(19, 26, 7, 3);
    d.fillStyle(0xaaaaff).rect(18, 10, 2, 2);
  }
}

/* ------------------------------------------------------------------ */
/*  Utility                                                            */
/* ------------------------------------------------------------------ */

function darken(color: number): number {
  const r = Math.max(0, ((color >> 16) & 0xff) - 30);
  const g = Math.max(0, ((color >> 8) & 0xff) - 30);
  const b = Math.max(0, (color & 0xff) - 30);
  return (r << 16) | (g << 8) | b;
}
