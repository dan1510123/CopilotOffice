// SettingsPanel — Unified settings overlay for Audio, Notifications, and About

import {
  type NotificationEventType,
  NOTIFICATION_EVENT_LABELS,
  resetNotificationSettings,
} from '../config/notifications';
import {
  getAgentAutoStartSettings,
  setAgentAutoStartSettings,
} from '../config/agentAutoStart';
import {
  getYoloModeSettings,
  setYoloModeSettings,
} from '../config/yoloMode';
import {
  getAdditionalParamsSettings,
  setAdditionalParamsSettings,
  type AdditionalParamsSettings,
} from '../config/additionalParams';
import { ZIndex } from '../config/zIndex';
import { type NotificationService } from './NotificationService';
import { injectUiKit } from './uiKit';

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
  /** Called when settings panel opens — disable game input */
  onOpen?: () => void;
  /** Called when settings panel closes — re-enable game input */
  onClose?: () => void;
  /** Open the Teams Remote settings overlay (panel closes itself first). */
  onOpenTeamsSettings?: () => void;
}

export class SettingsPanel {
  private overlay: HTMLDivElement | null = null;
  private notificationService: NotificationService;
  private callbacks: SettingsPanelCallbacks;

  constructor(
    notificationService: NotificationService,
    callbacks: SettingsPanelCallbacks,
  ) {
    this.notificationService = notificationService;
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
    injectUiKit();

    this.overlay = document.createElement('div');
    this.overlay.id = 'settings-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: ${ZIndex.SETTINGS};
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
      ${this.renderAgentsSection()}
      ${this.renderNotificationsSection()}
      ${this.renderTeamsSection()}
      ${this.renderAboutSection()}
    `;
  }

  private renderTeamsSection(): string {
    return `
      <div class="settings-section" style="margin-bottom: 20px;">
        <h3 style="margin: 0 0 12px; font-size: 14px; color: #889; border-bottom: 1px solid #2a2a3e; padding-bottom: 8px;">
          💬 Teams Remote
        </h3>
        <p style="margin: 0 0 12px; font-size: 11px; color: #778;">
          Bring agents online in a Microsoft Teams channel so you can drive them from a thread.
          Configure the feature flag and default channel here.
        </p>
        <button id="settings-teams-btn" class="ui-btn ui-btn--teams">💬 Open Teams Remote settings…</button>
      </div>
    `;
  }

  private renderAgentsSection(): string {
    const settings = getAgentAutoStartSettings();
    const yolo = getYoloModeSettings();
    const extra = getAdditionalParamsSettings();
    return `
      <div class="settings-section" style="margin-bottom: 20px;">
        <h3 style="margin: 0 0 12px; font-size: 14px; color: #889; border-bottom: 1px solid #2a2a3e; padding-bottom: 8px;">
          🤖 Agents
        </h3>
        <label style="display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer;">
          <input
            type="checkbox"
            id="settings-agent-auto-start"
            ${settings.autoStartKnownAgents ? 'checked' : ''}
            style="cursor: pointer; width: 15px; height: 15px;"
          />
          <span style="color: #aab; font-size: 13px;">Auto-start known agents</span>
        </label>
        <p style="margin: 4px 0 0 25px; font-size: 10px; color: #556;">
          When ON, agents with a saved session resume automatically on launch, office switch, and New Session.
        </p>
        <label style="display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer;">
          <input
            type="checkbox"
            id="settings-yolo-mode"
            ${yolo.yoloEnabled ? 'checked' : ''}
            style="cursor: pointer; width: 15px; height: 15px;"
          />
          <span style="color: #aab; font-size: 13px;">⚡ YOLO mode</span>
        </label>
        <p style="margin: 4px 0 0 25px; font-size: 10px; color: #b86;">
          When ON, every terminal launches with <code style="color: #db8;">--yolo</code> — auto-approves all tool, file, and URL permissions without prompting. Applies to the next terminal you open.
        </p>
        <label style="display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer;">
          <input
            type="checkbox"
            id="settings-additional-params-enabled"
            ${extra.enabled ? 'checked' : ''}
            style="cursor: pointer; width: 15px; height: 15px;"
          />
          <span style="color: #aab; font-size: 13px;">Additional parameters</span>
          <input
            type="text"
            id="settings-additional-params-text"
            value="${this.escapeHtml(extra.params)}"
            placeholder="--model gpt-5.4"
            ${extra.enabled ? '' : 'disabled'}
            style="
              flex: 1;
              background: #12121f;
              border: 1px solid #333;
              border-radius: 4px;
              padding: 4px 8px;
              color: #dde;
              font-family: inherit;
              font-size: 12px;
              ${extra.enabled ? '' : 'opacity: 0.5;'}
            "
          />
        </label>
        <p style="margin: 4px 0 0 25px; font-size: 10px; color: #556;">
          When ON, these parameters are appended to every <code style="color: #889;">copilot</code> launch. Applies to the next terminal you open.
        </p>
      </div>
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
          <button id="settings-bgm-mute-btn" class="ui-btn ui-btn--ghost" style="
            min-width: 60px;
            color: ${bgmMuted ? '#ff6666' : '#00ff88'};
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
          <button id="settings-notif-reset-btn" class="ui-btn ui-btn--danger">Reset to Defaults</button>
          <div style="display: flex; gap: 8px;">
            <button id="settings-notif-test-btn" class="ui-btn ui-btn--success">🔔 Test Toast</button>
            <button id="settings-notif-save-btn" class="ui-btn ui-btn--primary">💾 Save</button>
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
    this.bindAgentsEvents(panel);
    this.bindNotificationEvents(panel);

    // Teams Remote: close this panel first (its z-index sits above the Teams
    // overlay), then open the Teams settings overlay via the host callback.
    panel.querySelector('#settings-teams-btn')?.addEventListener('click', () => {
      this.close();
      this.callbacks.onOpenTeamsSettings?.();
    });
  }

  private bindAgentsEvents(panel: HTMLElement): void {
    const cb = panel.querySelector('#settings-agent-auto-start') as HTMLInputElement | null;
    if (cb) {
      cb.addEventListener('change', () => {
        setAgentAutoStartSettings({ autoStartKnownAgents: cb.checked });
      });
    }

    const yoloCb = panel.querySelector('#settings-yolo-mode') as HTMLInputElement | null;
    if (yoloCb) {
      yoloCb.addEventListener('change', () => {
        setYoloModeSettings({ yoloEnabled: yoloCb.checked });
        // Push the global flag to the PTY server so the next launch reflects it.
        window.copilotBridge?.setYolo(yoloCb.checked);
      });
    }

    const apCb = panel.querySelector('#settings-additional-params-enabled') as HTMLInputElement | null;
    const apText = panel.querySelector('#settings-additional-params-text') as HTMLInputElement | null;
    if (apCb && apText) {
      const persistAndPush = () => {
        const next: AdditionalParamsSettings = {
          enabled: apCb.checked,
          params: apText.value,
        };
        setAdditionalParamsSettings(next);
        // Effective string: empty when disabled. Push to the PTY server.
        const effective = next.enabled ? next.params.trim() : '';
        window.copilotBridge?.setAdditionalParams?.(effective);
      };
      apCb.addEventListener('change', () => {
        apText.disabled = !apCb.checked;
        apText.style.opacity = apCb.checked ? '1' : '0.5';
        persistAndPush();
      });
      apText.addEventListener('input', persistAndPush);
    }
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

    // Other checkboxes (notifications only — must have data-event)
    panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-event]:not([data-field="enabled"])').forEach(checkbox => {
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
