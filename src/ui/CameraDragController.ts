import Phaser from 'phaser';

export interface CameraDragConfig {
  worldWidth: number;
  worldHeight: number;
  tileSize: number;
  /** Extra tiles of padding beyond room edges where camera can pan. Default 1. */
  bufferTiles?: number;
}

/**
 * Click-to-drag camera panning controller.
 *
 * Distinguishes "click" from "drag" using a pixel-distance threshold so that
 * NPC clicks and background clicks still work. Clamps the camera within room
 * bounds plus a configurable tile buffer.
 */
export class CameraDragController {
  private scene: Phaser.Scene;
  private enabled: boolean = false;
  private active: boolean = false; // true while a drag gesture is in progress

  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private pointerDown: boolean = false;
  private didDrag: boolean = false; // set once distance threshold is exceeded

  private readonly dragThreshold = 5; // pixels before a hold becomes a drag
  private readonly bufferPx: number;

  // Expanded camera bounds
  private boundsLeft: number;
  private boundsTop: number;
  private boundsRight: number;
  private boundsBottom: number;

  // Track whether user manually panned (for auto-snap-back on player move)
  private userPanned: boolean = false;

  // Bound handler refs for cleanup
  private onPointerDown: ((p: Phaser.Input.Pointer) => void) | null = null;
  private onPointerMove: ((p: Phaser.Input.Pointer) => void) | null = null;
  private onPointerUp: ((p: Phaser.Input.Pointer) => void) | null = null;

  constructor(scene: Phaser.Scene, config: CameraDragConfig) {
    this.scene = scene;

    const buffer = (config.bufferTiles ?? 1) * config.tileSize;
    this.bufferPx = buffer;
    this.boundsLeft = -buffer;
    this.boundsTop = -buffer;
    this.boundsRight = config.worldWidth + buffer;
    this.boundsBottom = config.worldHeight + buffer;

    this.wirePointerEvents();
  }

  private wirePointerEvents(): void {
    this.onPointerDown = (pointer: Phaser.Input.Pointer) => {
      if (!this.enabled) return;
      // Only respond to left-button (button 0) or touch
      if (pointer.button !== 0) return;
      this.pointerDown = true;
      this.didDrag = false;
      this.dragStartX = pointer.x;
      this.dragStartY = pointer.y;
    };

    this.onPointerMove = (pointer: Phaser.Input.Pointer) => {
      if (!this.enabled || !this.pointerDown) return;

      const dx = pointer.x - this.dragStartX;
      const dy = pointer.y - this.dragStartY;

      if (!this.didDrag) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < this.dragThreshold) return;
        this.didDrag = true;
        this.active = true;
      }

      // Pan camera by pointer delta (divided by zoom for consistent speed)
      const cam = this.scene.cameras.main;
      const zoom = cam.zoom;
      cam.scrollX -= (pointer.x - pointer.prevPosition.x) / zoom;
      cam.scrollY -= (pointer.y - pointer.prevPosition.y) / zoom;

      // Clamp to expanded bounds
      this.clampCamera();
      this.userPanned = true;
    };

    this.onPointerUp = () => {
      this.pointerDown = false;
      this.active = false;
    };

    this.scene.input.on('pointerdown', this.onPointerDown);
    this.scene.input.on('pointermove', this.onPointerMove);
    this.scene.input.on('pointerup', this.onPointerUp);
  }

  /** Clamp camera scroll so it stays within the expanded bounds. */
  private clampCamera(): void {
    const cam = this.scene.cameras.main;
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;

    const minScrollX = this.boundsLeft;
    const maxScrollX = this.boundsRight - viewW;
    const minScrollY = this.boundsTop;
    const maxScrollY = this.boundsBottom - viewH;

    if (maxScrollX > minScrollX) {
      cam.scrollX = Phaser.Math.Clamp(cam.scrollX, minScrollX, maxScrollX);
    } else {
      // Viewport is wider than bounds — center horizontally
      cam.scrollX = (this.boundsLeft + this.boundsRight - viewW) / 2;
    }

    if (maxScrollY > minScrollY) {
      cam.scrollY = Phaser.Math.Clamp(cam.scrollY, minScrollY, maxScrollY);
    } else {
      // Viewport is taller than bounds — center vertically
      cam.scrollY = (this.boundsTop + this.boundsBottom - viewH) / 2;
    }
  }

  /**
   * Returns true if the pointer gesture that just ended was a drag
   * (i.e. exceeded the distance threshold). The caller should skip
   * NPC click handling when this returns true.
   *
   * Calling this resets the flag, so it reads as true only once per gesture.
   */
  wasDragging(): boolean {
    const was = this.didDrag;
    this.didDrag = false;
    return was;
  }

  /** Call from update() when the player is moving. Re-centers camera smoothly. */
  onPlayerMove(playerX: number, playerY: number): void {
    if (!this.userPanned) return;
    // Smoothly lerp camera back toward the player
    const cam = this.scene.cameras.main;
    const lerpSpeed = 0.08;
    const targetX = playerX - (cam.width / cam.zoom) / 2;
    const targetY = playerY - (cam.height / cam.zoom) / 2;
    cam.scrollX += (targetX - cam.scrollX) * lerpSpeed;
    cam.scrollY += (targetY - cam.scrollY) * lerpSpeed;
    this.clampCamera();

    // Once close enough, stop lerping
    if (Math.abs(cam.scrollX - targetX) < 1 && Math.abs(cam.scrollY - targetY) < 1) {
      this.userPanned = false;
    }
  }

  /** Enable drag panning. */
  enable(): void {
    this.enabled = true;
  }

  /** Disable drag panning (e.g. when terminal is focused or mini-game active). */
  disable(): void {
    this.enabled = false;
    this.pointerDown = false;
    this.active = false;
    this.didDrag = false;
  }

  /** Returns true while a drag gesture is actively in progress. */
  isActive(): boolean {
    return this.active;
  }

  /** Reset the manual-pan state so camera doesn't try to snap back. */
  resetPan(): void {
    this.userPanned = false;
  }

  /** Update the camera bounds (e.g. after zoom change). */
  updateBounds(worldWidth: number, worldHeight: number, tileSize: number, bufferTiles: number = 1): void {
    const buffer = bufferTiles * tileSize;
    this.boundsLeft = -buffer;
    this.boundsTop = -buffer;
    this.boundsRight = worldWidth + buffer;
    this.boundsBottom = worldHeight + buffer;
  }

  destroy(): void {
    if (this.onPointerDown) this.scene.input.off('pointerdown', this.onPointerDown);
    if (this.onPointerMove) this.scene.input.off('pointermove', this.onPointerMove);
    if (this.onPointerUp) this.scene.input.off('pointerup', this.onPointerUp);
    this.onPointerDown = null;
    this.onPointerMove = null;
    this.onPointerUp = null;
  }
}
