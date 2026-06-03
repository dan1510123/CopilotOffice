// SpriteCustomizerPanel — DOM-based dropdown for player sprite color customization
//
// Focus contract (slice S1-A, baseline BL-008): this is a DOM-modal overlay
// that may steal keyboard focus from the Phaser canvas. The owner MUST wire
// `onOpen` / `onClose` to `InputManager.suspendGameInput()` /
// `resumeGameInput()` (e.g. via the existing `settings:open` / `settings:close`
// event bus) so prior focus is saved and restored on dismissal.

import {
  type PlayerColors,
  DEFAULT_PLAYER_COLORS,
  PLAYER_COLOR_PRESETS,
  COLOR_REGION_LABELS,
  savePlayerColors,
  loadPlayerColors,
  resetPlayerColors,
} from '../config/playerCustomization';

function hexToCSS(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

const COLOR_REGIONS: (keyof PlayerColors)[] = ['hair', 'skin', 'suit', 'tie', 'pants', 'shoes'];

export class SpriteCustomizerPanel {
  private container: HTMLDivElement | null = null;
  private previewImg: HTMLImageElement | null = null;
  private currentColors: PlayerColors;
  private onColorsChanged: (colors: PlayerColors) => void;
  private onOpenCallback: (() => void) | undefined;
  private onCloseCallback: (() => void) | undefined;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(options: {
    onColorsChanged: (colors: PlayerColors) => void;
    /** Called when the panel opens — wire to InputManager.suspendGameInput. */
    onOpen?: () => void;
    /** Called when the panel closes — wire to InputManager.resumeGameInput. */
    onClose?: () => void;
  }) {
    this.onColorsChanged = options.onColorsChanged;
    this.onOpenCallback = options.onOpen;
    this.onCloseCallback = options.onClose;
    this.currentColors = loadPlayerColors();
  }

  show(anchorElement: HTMLElement): void {
    const wasOpen = this.container !== null;
    if (this.container) this.hide();

    this.currentColors = loadPlayerColors();

    this.container = document.createElement('div');
    this.container.style.cssText = `
      position: fixed;
      z-index: 15000;
      width: 320px;
      background: #1a1a2e;
      border: 2px solid #333;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      font-family: 'Cascadia Code', Consolas, monospace;
      color: #dde;
    `;

    // Position below anchor
    const rect = anchorElement.getBoundingClientRect();
    this.container.style.left = `${rect.left}px`;
    this.container.style.top = `${rect.bottom + 4}px`;

    this.container.innerHTML = this.renderContent();
    document.body.appendChild(this.container);

    // Clamp to viewport
    const panelRect = this.container.getBoundingClientRect();
    if (panelRect.right > window.innerWidth) {
      this.container.style.left = `${window.innerWidth - panelRect.width - 8}px`;
    }
    if (panelRect.bottom > window.innerHeight) {
      this.container.style.top = `${rect.top - panelRect.height - 4}px`;
    }

    this.previewImg = this.container.querySelector('#sprite-preview-img') as HTMLImageElement | null;

    this.bindEvents();

    if (!wasOpen) this.onOpenCallback?.();
  }

  hide(): void {
    const wasOpen = this.container !== null;
    if (this.outsideClickHandler) {
      document.removeEventListener('mousedown', this.outsideClickHandler, true);
      this.outsideClickHandler = null;
    }
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    this.previewImg = null;
    if (wasOpen) this.onCloseCallback?.();
  }

  toggle(anchorElement: HTMLElement): void {
    if (this.container) {
      this.hide();
    } else {
      this.show(anchorElement);
    }
  }

  isOpen(): boolean {
    return this.container !== null;
  }

  updatePreview(dataUrl: string): void {
    if (this.previewImg) {
      this.previewImg.src = dataUrl;
    }
  }

  destroy(): void {
    this.hide();
    this.container = null;
    this.previewImg = null;
  }

  private renderContent(): string {
    let sections = '';
    for (const region of COLOR_REGIONS) {
      const label = COLOR_REGION_LABELS[region];
      const presets = PLAYER_COLOR_PRESETS[region];
      const selected = this.currentColors[region];

      let swatches = '';
      for (const color of presets) {
        const isSelected = color === selected;
        const borderStyle = isSelected ? 'border: 2px solid #4488ff; box-shadow: 0 0 8px #4488ff88;' : 'border: 2px solid #444;';
        swatches += `<div
          data-region="${region}"
          data-color="${color}"
          style="
            width: 28px;
            height: 28px;
            border-radius: 50%;
            ${borderStyle}
            background: ${hexToCSS(color)};
            cursor: pointer;
            flex-shrink: 0;
            transition: border-color 0.15s;
          "
          class="swatch"
        ></div>`;
      }

      sections += `
        <div style="margin-bottom: 14px;">
          <div style="font-size: 12px; color: #889; text-transform: uppercase; margin-bottom: 6px;">${label}</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${swatches}
          </div>
        </div>
      `;
    }

    return `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <span style="font-size: 16px; color: #fff;">🎨 Customize Player</span>
        <button id="sprite-customizer-close" style="
          background: none; border: none; color: #666; font-size: 18px; cursor: pointer; padding: 4px 8px;
        ">✕</button>
      </div>
      <div style="text-align: center; margin-bottom: 16px; border-top: 1px solid #2a2a3e; padding-top: 16px;">
        <img id="sprite-preview-img" style="
          image-rendering: pixelated;
          width: 128px;
          height: auto;
        " />
      </div>
      <div style="border-top: 1px solid #2a2a3e; padding-top: 16px;">
        ${sections}
      </div>
      <div style="border-top: 1px solid #2a2a3e; padding-top: 16px;">
        <button id="sprite-customizer-reset" style="
          width: 100%;
          background: #2a1a1a;
          border: 1px solid #633;
          border-radius: 6px;
          padding: 8px;
          color: #f88;
          cursor: pointer;
          font-family: 'Cascadia Code', Consolas, monospace;
          font-size: 12px;
        ">Reset to Default</button>
      </div>
    `;
  }

  private bindEvents(): void {
    if (!this.container) return;

    // Close button
    this.container.querySelector('#sprite-customizer-close')?.addEventListener('click', () => this.hide());

    // Reset button
    this.container.querySelector('#sprite-customizer-reset')?.addEventListener('click', () => {
      this.currentColors = resetPlayerColors();
      this.onColorsChanged(this.currentColors);
      // Rebuild panel to reflect default selections
      if (this.container) {
        this.container.innerHTML = this.renderContent();
        this.previewImg = this.container.querySelector('#sprite-preview-img') as HTMLImageElement | null;
        this.bindInternalEvents();
      }
    });

    this.bindInternalEvents();

    // Outside click handler
    this.outsideClickHandler = (e: MouseEvent) => {
      if (this.container && !this.container.contains(e.target as Node)) {
        this.hide();
      }
    };
    // Use setTimeout to avoid the triggering click from immediately closing the panel
    setTimeout(() => {
      if (this.outsideClickHandler) {
        document.addEventListener('mousedown', this.outsideClickHandler, true);
      }
    }, 0);

    // Escape handler
    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    };
    document.addEventListener('keydown', this.escapeHandler);
  }

  private bindInternalEvents(): void {
    if (!this.container) return;

    // Swatch clicks
    this.container.querySelectorAll<HTMLDivElement>('.swatch').forEach(swatch => {
      // Hover effects
      swatch.addEventListener('mouseenter', () => {
        if (swatch.style.borderColor !== 'rgb(68, 136, 255)') {
          swatch.style.borderColor = '#888';
        }
      });
      swatch.addEventListener('mouseleave', () => {
        const color = parseInt(swatch.dataset.color!, 10);
        const region = swatch.dataset.region as keyof PlayerColors;
        if (this.currentColors[region] !== color) {
          swatch.style.borderColor = '#444';
        }
      });

      swatch.addEventListener('click', () => {
        const region = swatch.dataset.region as keyof PlayerColors;
        const color = parseInt(swatch.dataset.color!, 10);

        this.currentColors[region] = color;
        savePlayerColors(this.currentColors);
        this.onColorsChanged(this.currentColors);

        // Update visual selection for this region
        this.container?.querySelectorAll<HTMLDivElement>(`.swatch[data-region="${region}"]`).forEach(s => {
          const c = parseInt(s.dataset.color!, 10);
          if (c === color) {
            s.style.border = '2px solid #4488ff';
            s.style.boxShadow = '0 0 8px #4488ff88';
          } else {
            s.style.border = '2px solid #444';
            s.style.boxShadow = 'none';
          }
        });
      });
    });

    // Re-bind close and reset for rebuilt content
    this.container.querySelector('#sprite-customizer-close')?.addEventListener('click', () => this.hide());
    this.container.querySelector('#sprite-customizer-reset')?.addEventListener('click', () => {
      this.currentColors = resetPlayerColors();
      this.onColorsChanged(this.currentColors);
      if (this.container) {
        this.container.innerHTML = this.renderContent();
        this.previewImg = this.container.querySelector('#sprite-preview-img') as HTMLImageElement | null;
        this.bindInternalEvents();
      }
    });
  }
}
