import Phaser from 'phaser';
import { Depths } from '../config/depths';

const STORAGE_KEY = 'agencyOffice:zoomLevel';

export interface ZoomBarConfig {
  min: number;
  max: number;
  defaultValue: number;
  /** World-space Y of the office floor bottom. Bar renders just below this. */
  worldBottomY: number;
  onChange: (zoom: number) => void;
}

/**
 * Phaser-rendered zoom slider bar positioned just below the office floor.
 * Supports handle drag, click-to-jump, scroll wheel, and +/- buttons.
 * Persists zoom level to localStorage.
 */
export class ZoomBar {
  private scene: Phaser.Scene;
  private container!: Phaser.GameObjects.Container;
  private track!: Phaser.GameObjects.Rectangle;
  private fill!: Phaser.GameObjects.Rectangle;
  private handle!: Phaser.GameObjects.Arc;
  private label!: Phaser.GameObjects.Text;
  private bgPill!: Phaser.GameObjects.Rectangle;
  private minusBtn!: Phaser.GameObjects.Text;
  private plusBtn!: Phaser.GameObjects.Text;

  private config: ZoomBarConfig;
  private value: number;
  private dragging: boolean = false;
  private visible: boolean = true;

  // Layout constants
  private readonly trackWidth = 140;
  private readonly trackHeight = 6;
  private readonly handleRadius = 7;
  private readonly offsetBelowOffice = 16;
  private readonly btnSpacing = 22;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(scene: Phaser.Scene, config: ZoomBarConfig) {
    this.scene = scene;
    this.config = config;
    this.value = this.loadSavedZoom() ?? config.defaultValue;
    this.create();
    this.config.onChange(this.value);
  }

  private loadSavedZoom(): number | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return null;
      const v = parseFloat(raw);
      if (isNaN(v) || v < this.config.min || v > this.config.max) return null;
      return v;
    } catch {
      return null;
    }
  }

  private saveZoom(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, this.value.toFixed(2));
      } catch { /* ignore */ }
    }, 300);
  }

  private create(): void {
    const cy = this.config.worldBottomY + this.offsetBelowOffice;

    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(Depths.ZOOM_BAR);

    const totalWidth = this.trackWidth + this.btnSpacing * 2 + 60;
    const pillHeight = 28;

    // Semi-transparent background pill (position updated in updatePosition)
    this.bgPill = this.scene.add.rectangle(0, cy, totalWidth, pillHeight, 0x000000, 0.45);
    this.bgPill.setStrokeStyle(1, 0x444466, 0.4);
    this.container.add(this.bgPill);

    // Minus button
    this.minusBtn = this.scene.add.text(0, cy, '\u2212', {
      font: 'bold 16px monospace',
      color: '#aaaacc',
      backgroundColor: '#222233',
      padding: { x: 4, y: 1 },
    });
    this.minusBtn.setOrigin(0.5, 0.5);
    this.container.add(this.minusBtn);

    // Track
    this.track = this.scene.add.rectangle(0, cy, this.trackWidth, this.trackHeight, 0x333344);
    this.track.setStrokeStyle(1, 0x555566);
    this.container.add(this.track);

    // Fill (left portion of the track)
    this.fill = this.scene.add.rectangle(0, cy, 0, this.trackHeight - 2, 0x4488cc, 0.6);
    this.fill.setOrigin(0, 0.5);
    this.container.add(this.fill);

    // Handle (circle)
    this.handle = this.scene.add.circle(0, cy, this.handleRadius, 0xffffff);
    this.handle.setStrokeStyle(2, 0x88aadd, 0.8);
    this.container.add(this.handle);

    // Plus button
    this.plusBtn = this.scene.add.text(0, cy, '+', {
      font: 'bold 16px monospace',
      color: '#aaaacc',
      backgroundColor: '#222233',
      padding: { x: 4, y: 1 },
    });
    this.plusBtn.setOrigin(0.5, 0.5);
    this.container.add(this.plusBtn);

    // Percentage label
    this.label = this.scene.add.text(0, cy, this.formatLabel(), {
      font: '11px monospace',
      color: '#aaaacc',
    });
    this.label.setOrigin(0, 0.5);
    this.container.add(this.label);

    // Position everything correctly
    this.updatePosition();
    this.updateVisuals();

    // --- Interactions ---

    this.handle.setInteractive({ draggable: true, useHandCursor: true });
    this.scene.input.setDraggable(this.handle);

    this.handle.on('dragstart', () => { this.dragging = true; });
    this.handle.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number) => {
      this.setValueFromX(dragX);
    });
    this.handle.on('dragend', () => { this.dragging = false; });

    // Click-to-jump on track
    this.track.setInteractive({ useHandCursor: true });
    this.track.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const wp = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.setValueFromX(wp.x);
    });

    // Background pill click within track range
    this.bgPill.setInteractive({ useHandCursor: true });
    this.bgPill.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const wp = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const cxNow = this.track.x;
      const tLeft = cxNow - this.trackWidth / 2;
      const tRight = cxNow + this.trackWidth / 2;
      if (wp.x >= tLeft && wp.x <= tRight) {
        this.setValueFromX(wp.x);
      }
    });

    // +/- buttons (10% increments)
    this.minusBtn.setInteractive({ useHandCursor: true });
    this.minusBtn.on('pointerdown', () => { this.setValue(this.value - 0.1); });

    this.plusBtn.setInteractive({ useHandCursor: true });
    this.plusBtn.on('pointerdown', () => { this.setValue(this.value + 0.1); });

    // Scroll wheel near the bar
    this.scene.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gos: unknown[], _dx: number, dy: number) => {
      const ptr = this.scene.input.activePointer;
      const wp = this.scene.cameras.main.getWorldPoint(ptr.x, ptr.y);
      const barY = this.config.worldBottomY + this.offsetBelowOffice;
      const barX = this.track.x;
      if (Math.abs(wp.y - barY) < 30 && Math.abs(wp.x - barX) < (this.trackWidth / 2 + 50)) {
        const step = 0.05;
        const delta = dy > 0 ? -step : step;
        this.setValue(Phaser.Math.Clamp(this.value + delta, this.config.min, this.config.max));
      }
    });
  }

  /** Reposition the bar centered below the office. Call after zoom/scroll changes. */
  updatePosition(): void {
    const cam = this.scene.cameras.main;
    const cx = cam.scrollX + (cam.width / cam.zoom) / 2;
    const cy = this.config.worldBottomY + this.offsetBelowOffice;

    this.bgPill.setPosition(cx, cy);
    this.track.setPosition(cx, cy);
    this.minusBtn.setPosition(cx - this.trackWidth / 2 - this.btnSpacing, cy);
    this.plusBtn.setPosition(cx + this.trackWidth / 2 + this.btnSpacing, cy);
    this.label.setPosition(cx + this.trackWidth / 2 + this.btnSpacing + 22, cy);

    this.updateVisuals();
  }

  private valueToX(val: number): number {
    const cx = this.track.x;
    const t = (val - this.config.min) / (this.config.max - this.config.min);
    return cx - this.trackWidth / 2 + t * this.trackWidth;
  }

  private xToValue(x: number): number {
    const cx = this.track.x;
    const trackLeft = cx - this.trackWidth / 2;
    const t = Phaser.Math.Clamp((x - trackLeft) / this.trackWidth, 0, 1);
    return this.config.min + t * (this.config.max - this.config.min);
  }

  private setValueFromX(x: number): void {
    this.setValue(this.xToValue(x));
  }

  private setValue(newValue: number): void {
    const clamped = Phaser.Math.Clamp(newValue, this.config.min, this.config.max);
    this.value = Math.round(clamped * 10) / 10;
    this.updateVisuals();
    this.config.onChange(this.value);
    this.saveZoom();
  }

  private updateVisuals(): void {
    const handleX = this.valueToX(this.value);
    this.handle.setX(handleX);
    this.handle.setY(this.track.y);

    const trackLeft = this.track.x - this.trackWidth / 2;
    this.fill.setPosition(trackLeft, this.track.y);
    this.fill.width = handleX - trackLeft;

    this.label.setText(this.formatLabel());
  }

  private formatLabel(): string {
    return `${Math.round(this.value * 100)}%`;
  }

  getValue(): number {
    return this.value;
  }

  isDragging(): boolean {
    return this.dragging;
  }

  /** Returns all interactive game objects owned by this bar (for hit-test exclusion). */
  getInteractiveObjects(): Phaser.GameObjects.GameObject[] {
    return [this.handle, this.track, this.bgPill, this.minusBtn, this.plusBtn];
  }

  show(): void {
    this.visible = true;
    this.container.setVisible(true);
  }

  hide(): void {
    this.visible = false;
    this.container.setVisible(false);
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.handle.off('dragstart');
    this.handle.off('drag');
    this.handle.off('dragend');
    this.track.off('pointerdown');
    this.bgPill.off('pointerdown');
    this.minusBtn.off('pointerdown');
    this.plusBtn.off('pointerdown');
    this.container.destroy(true);
  }
}
