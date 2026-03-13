// SettingsPanel — Unified settings overlay consolidating Audio, Terminal, Notifications, and Offices

import {
  type NotificationEventType,
  type NotificationSettings,
  NOTIFICATION_EVENT_LABELS,
  resetNotificationSettings,
} from '../config/notifications';
import { type NotificationService } from './NotificationService';
import { type OfficeManager } from '../office/officeManager';

const TERMINAL_PATH_KEY = 'copilot-office-terminal-path';

/** Returns the user-configured default terminal path, or undefined if not set. */
export function getDefaultTerminalPath(): string | undefined {
  const val = localStorage.getItem(TERMINAL_PATH_KEY);
  return val && val.trim() ? val.trim() : undefined;
}

const ALL_EVENT_TYPES: NotificationEventType[] = [
  'turnEnd',
  'askUser',
  'turnStart',
  'toolStart',
  'toolComplete',
  'sessionReady',
  'sessionError',
];

export interface SettingsPanelCallbacks {
  /** Emit bgm:volume event to Phaser */
  onBgmVolumeChange: (volume: number) => void;
  /** Emit bgm:mute event to Phaser */
  onBgmMuteChange: (muted: boolean) => void;
  /** Get the current bgmMuted state */
  getBgmMuted: () => boolean;
  /** Set the bgmMuted state */
  setBgmMuted: (muted: boolean) => void;
  /** Called when the global terminal path is changed — should reset all sessions */
  onTerminalPathChanged: (newPath: string) => void;
  /** Called when settings panel opens — disable game input */
  onOpen?: () => void;
  /** Called when settings panel closes — re-enable game input */
  onClose?: () => void;
}

export class SettingsPanel {
  private overlay: HTMLDivElement | null = null;
  private notificationService: NotificationService;
  private officeManager: OfficeManager;
  private callbacks: SettingsPanelCallbacks;

  constructor(
    notificationService: NotificationService,
    officeManager: OfficeManager,
    callbacks: SettingsPanelCallbacks,
  ) {
    this.notificationService = notificationService;
    this.officeManager = officeManager;
    this.callbacks = callbacks;
  }

  isOpen(): boolean {
    return this.overlay !== null;
  }

  toggle(): void {
    if (this.overlay) {
      this.close();
    } else {
      this.open();
    }
  }

  open(): void {
    if (this.overlay) return;

    this.overlay = document.createElement('div');
    this.overlay.id = 'settings-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 20000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Cascadia Code', Consolas, monospace;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1a1a2e;
      border: 2px solid #333;
      border-radius: 12px;
      padding: 24px;
      width: 650px;
      max-height: 80vh;
      overflow-y: auto;
      color: #dde;
    `;

    panel.innerHTML = this.renderContent();
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

    // Close on backdrop click
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Close on Escape
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    this.bindEvents(panel);
    this.callbacks.onOpen?.();
  }

  close(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.callbacks.onClose?.();
  }

  // ── Rendering ────────────────────────────────────────────────────

  private renderContent(): string {
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 style="margin: 0; font-size: 18px; color: #fff;">⚙ Settings</h2>
        <button id="settings-close-btn" style="
          background: none; border: none; color: #666; font-size: 20px; cursor: pointer; padding: 4px 8px;
        ">✕</button>
      </div>

      ${this.renderAudioSection()}
      ${this.renderTerminalSection()}
      ${this.renderNotificationsSection()}
      ${this.renderAboutSection()}
    `;
  }

  private renderAudioSection(): string {
    const bgmMuted = this.callbacks.getBgmMuted();
    const bgmVolume = Math.round(parseFloat(localStorage.getItem('copilot-office-bgm-volume') ?? '0.5') * 100);

    return `
      <div class="settings-section" style="margin-bottom: 20px;">
        <h3 style="margin: 0 0 12px; font-size: 14px; color: #889; border-bottom: 1px solid #2a2a3e; padding-bottom: 8px;">
          🔊 Audio
        </h3>
        <div style="display: flex; align-items: center; gap: 16px; padding: 8px 0;">
          <span style="color: #aab; font-size: 13px; min-width: 100px;">Background Music</span>
          <button id="settings-bgm-mute-btn" style="
            background: #333;
            border: 1px solid #555;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-family: monospace;
            padding: 4px 10px;
            color: ${bgmMuted ? '#ff6666' : '#00ff88'};
            min-width: 60px;
          ">${bgmMuted ? 'MUTED' : 'ON'}</button>
          <input id="settings-bgm-slider" type="range" min="0" max="100"
            value="${bgmVolume}"
            title="Volume"
            style="width: 120px; cursor: pointer; accent-color: #00ff88;" />
          <span id="settings-bgm-volume-label" style="color: #888; font-size: 11px; min-width: 32px;">${bgmVolume}%</span>
        </div>
      </div>
    `;
  }

  private renderTerminalSection(): string {
    const terminalPath = localStorage.getItem(TERMINAL_PATH_KEY) ?? '';

    return `
      <div class="settings-section" style="margin-bottom: 20px;">
        <h3 style="margin: 0 0 12px; font-size: 14px; color: #889; border-bottom: 1px solid #2a2a3e; padding-bottom: 8px;">
          🖥 Terminal
        </h3>
        <div style="padding: 8px 0;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span style="color: #aab; font-size: 13px; min-width: 100px;">Default Path</span>
            <input id="settings-terminal-path" type="text"
              value="${this.escapeHtml(terminalPath)}"
              placeholder="Default (app directory)"
              style="
                flex: 1;
                background: #12121f;
                border: 1px solid #333;
                border-radius: 4px;
                padding: 6px 10px;
                color: #dde;
                font-family: inherit;
                font-size: 12px;
              "
            />
          </div>
          <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px;">
            <button id="settings-terminal-clear-btn" style="
              background: #2a1a1a; border: 1px solid #633; border-radius: 4px;
              padding: 4px 12px; color: #f88; cursor: pointer; font-family: inherit; font-size: 11px;
            ">Clear</button>
            <button id="settings-terminal-save-btn" style="
              background: #1a1a3a; border: 1px solid #336; border-radius: 4px;
              padding: 4px 12px; color: #88f; cursor: pointer; font-family: inherit; font-size: 11px;
            ">💾 Save</button>
          </div>
          <p style="margin-top: 8px; font-size: 9px; color: #556;">
            Absolute path where all new terminals will spawn. Saving resets all active sessions.
          </p>
        </div>
      </div>
    `;
  }

  private renderNotificationsSection(): string {
    const settings = this.notificationService.getSettings();
    let rows = '';
    for (const eventType of ALL_EVENT_TYPES) {
      const cfg = settings.events[eventType];
      const label = NOTIFICATION_EVENT_LABELS[eventType];
      rows += `
        <tr style="border-bottom: 1px solid #2a2a3e;">
          <td style="padding: 8px 6px; font-size: 12px;">${label}</td>
          <td style="padding: 8px 6px; text-align: center;">
            <input type="checkbox" data-event="${eventType}" data-field="enabled" ${cfg.enabled ? 'checked' : ''} style="cursor: pointer; width: 15px; height: 15px;" />
          </td>
          <td style="padding: 8px 6px; text-align: center;">
            <input type="checkbox" data-event="${eventType}" data-field="toast" ${cfg.toast ? 'checked' : ''} ${!cfg.enabled ? 'disabled' : ''} style="cursor: pointer; width: 15px; height: 15px;" />
          </td>
          <td style="padding: 8px 6px; text-align: center;">
            <input type="checkbox" data-event="${eventType}" data-field="osNotification" ${cfg.osNotification ? 'checked' : ''} ${!cfg.enabled ? 'disabled' : ''} style="cursor: pointer; width: 15px; height: 15px;" />
          </td>
          <td style="padding: 8px 4px;">
            <input type="text" data-event="${eventType}" data-field="message" value="${this.escapeHtml(cfg.message)}" ${!cfg.enabled ? 'disabled' : ''}
              style="
                width: 100%;
                background: #12121f;
                border: 1px solid #333;
                border-radius: 4px;
                padding: 3px 6px;
                color: #dde;
                font-family: inherit;
                font-size: 10px;
              "
            />
          </td>
        </tr>
      `;
    }

    return `
      <div class="settings-section" style="margin-bottom: 20px;">
        <h3 style="margin: 0 0 12px; font-size: 14px; color: #889; border-bottom: 1px solid #2a2a3e; padding-bottom: 8px;">
          🔔 Notifications
        </h3>

        <div style="margin-bottom: 12px; display: flex; align-items: center; gap: 12px;">
          <label style="font-size: 11px; color: #889;">Dedup window (ms):</label>
          <input type="number" id="settings-dedupe-ms" value="${settings.dedupeWindowMs}" min="0" max="30000" step="500"
            style="
              width: 80px; background: #12121f; border: 1px solid #333; border-radius: 4px;
              padding: 4px 8px; color: #dde; font-family: inherit; font-size: 12px;
            "
          />
        </div>

        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 2px solid #333;">
              <th style="padding: 6px; text-align: left; font-size: 11px; color: #889;">Event</th>
              <th style="padding: 6px; text-align: center; font-size: 11px; color: #889;">On</th>
              <th style="padding: 6px; text-align: center; font-size: 11px; color: #889;">Toast</th>
              <th style="padding: 6px; text-align: center; font-size: 11px; color: #889;">OS</th>
              <th style="padding: 6px; text-align: left; font-size: 11px; color: #889;">Message template</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div style="margin-top: 12px; display: flex; gap: 8px; justify-content: space-between;">
          <button id="settings-notif-reset-btn" style="
            background: #2a1a1a; border: 1px solid #633; border-radius: 6px;
            padding: 6px 12px; color: #f88; cursor: pointer; font-family: inherit; font-size: 11px;
          ">Reset to Defaults</button>
          <div style="display: flex; gap: 8px;">
            <button id="settings-notif-test-btn" style="
              background: #1a2a1a; border: 1px solid #363; border-radius: 6px;
              padding: 6px 12px; color: #8f8; cursor: pointer; font-family: inherit; font-size: 11px;
            ">🔔 Test Toast</button>
            <button id="settings-notif-save-btn" style="
              background: #1a1a3a; border: 1px solid #336; border-radius: 6px;
              padding: 6px 12px; color: #88f; cursor: pointer; font-family: inherit; font-size: 11px;
            ">💾 Save</button>
          </div>
        </div>

        <p style="margin-top: 8px; font-size: 9px; color: #556;">
          Use <code style="color: #889;">{agent}</code> and <code style="color: #889;">{tool}</code> in templates.
        </p>
      </div>
    `;
  }

  private renderAboutSection(): string {
    return `
      <div class="settings-section">
        <h3 style="margin: 0 0 12px; font-size: 14px; color: #889; border-bottom: 1px solid #2a2a3e; padding-bottom: 8px;">
          ℹ️ About
        </h3>
        <div style="font-size: 12px; color: #889; line-height: 1.8;">
          <div><strong style="color: #dde;">Copilot Office</strong> — AI-powered virtual office</div>
          <div style="margin-top: 10px; font-size: 11px; color: #667;">
            <strong style="color: #889;">Keyboard Shortcuts</strong>
          </div>
          <table style="width: 100%; font-size: 11px; margin-top: 4px;">
            <tr><td style="color: #667; padding: 2px 8px 2px 0;">WASD / Arrows</td><td style="color: #889;">Move</td></tr>
            <tr><td style="color: #667; padding: 2px 8px 2px 0;">Shift</td><td style="color: #889;">Sprint</td></tr>
            <tr><td style="color: #667; padding: 2px 8px 2px 0;">E</td><td style="color: #889;">Interact</td></tr>
            <tr><td style="color: #667; padding: 2px 8px 2px 0;">F10</td><td style="color: #889;">Close terminal</td></tr>
            <tr><td style="color: #667; padding: 2px 8px 2px 0;">Escape</td><td style="color: #889;">Close overlay</td></tr>
            <tr><td style="color: #667; padding: 2px 8px 2px 0;">Ctrl+Shift+N</td><td style="color: #889;">New session</td></tr>
          </table>
        </div>
      </div>
    `;
  }

  // ── Event Binding ────────────────────────────────────────────────

  private bindEvents(panel: HTMLElement): void {
    // Close button
    panel.querySelector('#settings-close-btn')?.addEventListener('click', () => this.close());

    this.bindAudioEvents(panel);
    this.bindTerminalEvents(panel);
    this.bindNotificationEvents(panel);
  }

  private bindAudioEvents(panel: HTMLElement): void {
    const muteBtn = panel.querySelector('#settings-bgm-mute-btn') as HTMLButtonElement | null;
    const slider = panel.querySelector('#settings-bgm-slider') as HTMLInputElement | null;
    const volumeLabel = panel.querySelector('#settings-bgm-volume-label') as HTMLElement | null;

    muteBtn?.addEventListener('click', () => {
      const newMuted = !this.callbacks.getBgmMuted();
      this.callbacks.setBgmMuted(newMuted);
      localStorage.setItem('copilot-office-bgm-muted', String(newMuted));
      this.callbacks.onBgmMuteChange(newMuted);

      if (newMuted) {
        muteBtn.textContent = 'MUTED';
        muteBtn.style.color = '#ff6666';
      } else {
        muteBtn.textContent = 'ON';
        muteBtn.style.color = '#00ff88';
      }
    });

    slider?.addEventListener('input', (e) => {
      const vol = parseInt((e.target as HTMLInputElement).value, 10) / 100;
      localStorage.setItem('copilot-office-bgm-volume', String(vol));
      this.callbacks.onBgmVolumeChange(vol);
      if (volumeLabel) volumeLabel.textContent = `${Math.round(vol * 100)}%`;
    });
  }

  private bindTerminalEvents(panel: HTMLElement): void {
    const pathInput = panel.querySelector('#settings-terminal-path') as HTMLInputElement | null;
    const saveBtn = panel.querySelector('#settings-terminal-save-btn') as HTMLButtonElement | null;
    const clearBtn = panel.querySelector('#settings-terminal-clear-btn') as HTMLButtonElement | null;

    saveBtn?.addEventListener('click', () => {
      const newPath = pathInput?.value.trim() ?? '';
      if (newPath) {
        localStorage.setItem(TERMINAL_PATH_KEY, newPath);
      } else {
        localStorage.removeItem(TERMINAL_PATH_KEY);
      }
      this.callbacks.onTerminalPathChanged(newPath);

      if (saveBtn) {
        saveBtn.textContent = '✓ Saved — resetting sessions…';
        setTimeout(() => { saveBtn.textContent = '💾 Save'; }, 2000);
      }
    });

    clearBtn?.addEventListener('click', () => {
      localStorage.removeItem(TERMINAL_PATH_KEY);
      if (pathInput) pathInput.value = '';
      this.callbacks.onTerminalPathChanged('');

      if (clearBtn) {
        clearBtn.textContent = '✓ Cleared';
        setTimeout(() => { clearBtn.textContent = 'Clear'; }, 1500);
      }
    });
  }

  private bindNotificationEvents(panel: HTMLElement): void {
    const settings = this.notificationService.getSettings();

    // "Enabled" checkboxes toggle disabled state of sibling inputs
    panel.querySelectorAll<HTMLInputElement>('input[data-field="enabled"]').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        const eventType = checkbox.dataset.event as NotificationEventType;
        const row = checkbox.closest('tr');
        if (!row) return;
        const inputs = row.querySelectorAll<HTMLInputElement>('input:not([data-field="enabled"])');
        inputs.forEach(input => { input.disabled = !checkbox.checked; });
        settings.events[eventType].enabled = checkbox.checked;
      });
    });

    // Other checkboxes
    panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not([data-field="enabled"])').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        const eventType = checkbox.dataset.event as NotificationEventType;
        const field = checkbox.dataset.field as 'toast' | 'osNotification';
        settings.events[eventType][field] = checkbox.checked;
      });
    });

    // Message text inputs
    panel.querySelectorAll<HTMLInputElement>('input[type="text"][data-field="message"]').forEach(input => {
      input.addEventListener('input', () => {
        const eventType = input.dataset.event as NotificationEventType;
        settings.events[eventType].message = input.value;
      });
    });

    // Dedupe window
    panel.querySelector('#settings-dedupe-ms')?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value, 10);
      if (!isNaN(val) && val >= 0) {
        settings.dedupeWindowMs = val;
      }
    });

    // Reset button
    panel.querySelector('#settings-notif-reset-btn')?.addEventListener('click', () => {
      const defaults = resetNotificationSettings();
      this.notificationService.updateSettings(defaults);
      this.close();
      this.open();
    });

    // Test button
    panel.querySelector('#settings-notif-test-btn')?.addEventListener('click', () => {
      this.notificationService.notify('test', 'turnEnd', undefined, null);
    });

    // Save button
    panel.querySelector('#settings-notif-save-btn')?.addEventListener('click', () => {
      this.notificationService.updateSettings(settings);
      const saveBtn = panel.querySelector('#settings-notif-save-btn') as HTMLButtonElement | null;
      if (saveBtn) {
        saveBtn.textContent = '✓ Saved';
        setTimeout(() => { saveBtn.textContent = '💾 Save'; }, 1500);
      }
    });
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
