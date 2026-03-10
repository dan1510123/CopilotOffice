import Phaser from 'phaser';
import { Depths } from '../config/depths';

const STORAGE_KEY = 'agencyOffice:zoomLevel';

export interface ZoomBarConfig {
  min: number;
  max: number;
  defaultValue: number;
  onChange: (zoom: number) => void;
}

/**
 * Phaser-rendered zoom slider bar, fixed to the bottom-center of the camera viewport.
 * Supports handle drag, click-to-jump, and scroll wheel.
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

  private config: ZoomBarConfig;
  private value: number;
  private dragging: boolean = false;
  private visible: boolean = true;

  // Layout constants
  private readonly trackWidth = 140;
  private readonly trackHeight = 6;
  private readonly handleRadius = 7;
  private readonly bottomMargin = 24;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(scene: Phaser.Scene, config: ZoomBarConfig) {
    this.scene = scene;
    this.config = config;
    this.value = this.loadSavedZoom() ?? config.defaultValue;
    this.create();
    // Notify initial zoom value
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
    const cam = this.scene.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height - this.bottomMargin;

    // Container is fixed to viewport
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(Depths.ZOOM_BAR);
    this.container.setScrollFactor(0);

    // Semi-transparent background pill
    const pillWidth = this.trackWidth + 80;
    const pillHeight = 28;
    this.bgPill = this.scene.add.rectangle(cx, cy, pillWidth, pillHeight, 0x000000, 0.45);
    this.bgPill.setStrokeStyle(1, 0x444466, 0.4);
    this.container.add(this.bgPill);

    // Track
    const trackLeft = cx - this.trackWidth / 2;
    this.track = this.scene.add.rectangle(cx, cy, this.trackWidth, this.trackHeight, 0x333344);
    this.track.setStrokeStyle(1, 0x555566);
    this.container.add(this.track);

    // Fill (left portion of the track)
    this.fill = this.scene.add.rectangle(trackLeft, cy, 0, this.trackHeight - 2, 0x4488cc, 0.6);
    this.fill.setOrigin(0, 0.5);
    this.container.add(this.fill);

    // Handle (circle)
    const handleX = this.valueToX(this.value, cx);
    this.handle = this.scene.add.circle(handleX, cy, this.handleRadius, 0xffffff);
    this.handle.setStrokeStyle(2, 0x88aadd, 0.8);
    this.container.add(this.handle);

    // Percentage label
    this.label = this.scene.add.text(cx + this.trackWidth / 2 + 14, cy, this.formatLabel(), {
      font: '11px monospace',
      color: '#aaaacc',
    });
    this.label.setOrigin(0, 0.5);
    this.container.add(this.label);

    // Update fill to match initial value
    this.updateVisuals(cx);

    // --- Interactions ---

    // Make handle interactive (drag)
    this.handle.setInteractive({ draggable: true, useHandCursor: true });
    this.scene.input.setDraggable(this.handle);

    this.handle.on('dragstart', () => {
      this.dragging = true;
    });

    this.handle.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number) => {
      this.setValueFromX(dragX, cam.width / 2);
    });

    this.handle.on('dragend', () => {
      this.dragging = false;
    });

    // Make track interactive (click-to-jump)
    this.track.setInteractive({ useHandCursor: true });
    this.track.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // pointer.x is in camera coords since scrollFactor=0
      this.setValueFromX(pointer.x, cam.width / 2);
    });

    // Also make background pill clickable for easier targeting
    this.bgPill.setInteractive({ useHandCursor: true });
    this.bgPill.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Only respond if click is within horizontal track range
      const trackLeft2 = cam.width / 2 - this.trackWidth / 2;
      const trackRight2 = cam.width / 2 + this.trackWidth / 2;
      if (pointer.x >= trackLeft2 && pointer.x <= trackRight2) {
        this.setValueFromX(pointer.x, cam.width / 2);
      }
    });

    // Scroll wheel over the bar area
    this.scene.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gos: unknown[], _dx: number, dy: number) => {
      // Only respond if pointer is near the bar
      const ptr = this.scene.input.activePointer;
      if (Math.abs(ptr.y - cy) < 30 &&
          Math.abs(ptr.x - cx) < (this.trackWidth / 2 + 40)) {
        const step = 0.05;
        const delta = dy > 0 ? -step : step;
        this.setValue(Phaser.Math.Clamp(this.value + delta, this.config.min, this.config.max));
      }
    });
  }

  private valueToX(val: number, centerX: number): number {
    const t = (val - this.config.min) / (this.config.max - this.config.min);
    return centerX - this.trackWidth / 2 + t * this.trackWidth;
  }

  private xToValue(x: number, centerX: number): number {
    const trackLeft = centerX - this.trackWidth / 2;
    const t = Phaser.Math.Clamp((x - trackLeft) / this.trackWidth, 0, 1);
    return this.config.min + t * (this.config.max - this.config.min);
  }

  private setValueFromX(x: number, centerX: number): void {
    this.setValue(this.xToValue(x, centerX));
  }

  private setValue(newValue: number): void {
    const clamped = Phaser.Math.Clamp(newValue, this.config.min, this.config.max);
    // Snap to nice increments (round to 0.05)
    this.value = Math.round(clamped * 20) / 20;
    this.updateVisuals(this.scene.cameras.main.width / 2);
    this.config.onChange(this.value);
    this.saveZoom();
  }

  private updateVisuals(centerX: number): void {
    const handleX = this.valueToX(this.value, centerX);
    this.handle.setX(handleX);

    const trackLeft = centerX - this.trackWidth / 2;
    this.fill.setX(trackLeft);
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
    this.container.destroy(true);
  }
}
