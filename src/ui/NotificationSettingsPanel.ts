// NotificationSettingsPanel — DOM-based settings UI for notification preferences
//
// Focus contract (slice S1-A, baseline BL-008): this is a DOM-modal overlay.
// If/when it is wired into the app, the owner MUST call
// `InputManager.suspendGameInput()` on open and `resumeGameInput()` on close
// (e.g. via the existing `settings:open` / `settings:close` event bus) so prior
// focus is saved and restored. The panel currently has no instantiation site;
// add `onOpen` / `onClose` callbacks at that time mirroring `SettingsPanel`.

import {
  type NotificationEventType,
  type NotificationSettings,
  NOTIFICATION_EVENT_LABELS,
  resetNotificationSettings,
} from '../config/notifications';
import { type NotificationService } from './NotificationService';

const ALL_EVENT_TYPES: NotificationEventType[] = [
  'turnEnd',
  'askUser',
  'turnStart',
  'toolStart',
  'toolComplete',
  'sessionReady',
  'sessionError',
];

export class NotificationSettingsPanel {
  private overlay: HTMLDivElement | null = null;
  private service: NotificationService;

  constructor(service: NotificationService) {
    this.service = service;
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

    const settings = this.service.getSettings();

    this.overlay = document.createElement('div');
    this.overlay.id = 'notification-settings-overlay';
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
      width: 600px;
      max-height: 80vh;
      overflow-y: auto;
      color: #dde;
    `;

    panel.innerHTML = this.renderContent(settings);
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

    this.bindEvents(panel, settings);
  }

  close(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  private renderContent(settings: NotificationSettings): string {
    let rows = '';
    for (const eventType of ALL_EVENT_TYPES) {
      const cfg = settings.events[eventType];
      const label = NOTIFICATION_EVENT_LABELS[eventType];
      rows += `
        <tr style="border-bottom: 1px solid #2a2a3e;">
          <td style="padding: 10px 8px; font-size: 13px;">${label}</td>
          <td style="padding: 10px 8px; text-align: center;">
            <input type="checkbox" data-event="${eventType}" data-field="enabled" ${cfg.enabled ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px;" />
          </td>
          <td style="padding: 10px 8px; text-align: center;">
            <input type="checkbox" data-event="${eventType}" data-field="toast" ${cfg.toast ? 'checked' : ''} ${!cfg.enabled ? 'disabled' : ''} style="cursor: pointer; width: 16px; height: 16px;" />
          </td>
          <td style="padding: 10px 8px; text-align: center;">
            <input type="checkbox" data-event="${eventType}" data-field="osNotification" ${cfg.osNotification ? 'checked' : ''} ${!cfg.enabled ? 'disabled' : ''} style="cursor: pointer; width: 16px; height: 16px;" />
          </td>
          <td style="padding: 10px 4px;">
            <input type="text" data-event="${eventType}" data-field="message" value="${this.escapeHtml(cfg.message)}" ${!cfg.enabled ? 'disabled' : ''}
              style="
                width: 100%;
                background: #12121f;
                border: 1px solid #333;
                border-radius: 4px;
                padding: 4px 8px;
                color: #dde;
                font-family: inherit;
                font-size: 11px;
              "
            />
          </td>
        </tr>
      `;
    }

    return `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 style="margin: 0; font-size: 18px; color: #fff;">🔔 Notification Settings</h2>
        <button id="notif-close-btn" style="
          background: none; border: none; color: #666; font-size: 20px; cursor: pointer; padding: 4px 8px;
        ">✕</button>
      </div>

      <div style="margin-bottom: 16px; display: flex; align-items: center; gap: 12px;">
        <label style="font-size: 12px; color: #889;">Dedup window (ms):</label>
        <input type="number" id="notif-dedupe-ms" value="${settings.dedupeWindowMs}" min="0" max="30000" step="500"
          style="
            width: 80px; background: #12121f; border: 1px solid #333; border-radius: 4px;
            padding: 4px 8px; color: #dde; font-family: inherit; font-size: 12px;
          "
        />
      </div>

      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 2px solid #333;">
            <th style="padding: 8px; text-align: left; font-size: 12px; color: #889;">Event</th>
            <th style="padding: 8px; text-align: center; font-size: 12px; color: #889;">On</th>
            <th style="padding: 8px; text-align: center; font-size: 12px; color: #889;">Toast</th>
            <th style="padding: 8px; text-align: center; font-size: 12px; color: #889;">OS</th>
            <th style="padding: 8px; text-align: left; font-size: 12px; color: #889;">Message template</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      <div style="margin-top: 20px; display: flex; gap: 12px; justify-content: space-between;">
        <button id="notif-reset-btn" style="
          background: #2a1a1a; border: 1px solid #633; border-radius: 6px;
          padding: 8px 16px; color: #f88; cursor: pointer; font-family: inherit; font-size: 12px;
        ">Reset to Defaults</button>
        <div style="display: flex; gap: 8px;">
          <button id="notif-test-btn" style="
            background: #1a2a1a; border: 1px solid #363; border-radius: 6px;
            padding: 8px 16px; color: #8f8; cursor: pointer; font-family: inherit; font-size: 12px;
          ">🔔 Test Toast</button>
          <button id="notif-save-btn" style="
            background: #1a1a3a; border: 1px solid #336; border-radius: 6px;
            padding: 8px 16px; color: #88f; cursor: pointer; font-family: inherit; font-size: 12px;
          ">💾 Save</button>
        </div>
      </div>

      <p style="margin-top: 12px; font-size: 10px; color: #556;">
        Use <code style="color: #889;">{agent}</code> and <code style="color: #889;">{tool}</code> in message templates.
        Dedup window prevents the same notification from showing twice within the specified time.
      </p>
    `;
  }

  private bindEvents(panel: HTMLElement, settings: NotificationSettings): void {
    // Close button
    panel.querySelector('#notif-close-btn')?.addEventListener('click', () => this.close());

    // "Enabled" checkboxes toggle disabled state of sibling inputs
    panel.querySelectorAll<HTMLInputElement>('input[data-field="enabled"]').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        const eventType = checkbox.dataset.event as NotificationEventType;
        const row = checkbox.closest('tr');
        if (!row) return;
        const inputs = row.querySelectorAll<HTMLInputElement>('input:not([data-field="enabled"])');
        inputs.forEach(input => {
          input.disabled = !checkbox.checked;
        });
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
    panel.querySelector('#notif-dedupe-ms')?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value, 10);
      if (!isNaN(val) && val >= 0) {
        settings.dedupeWindowMs = val;
      }
    });

    // Reset button
    panel.querySelector('#notif-reset-btn')?.addEventListener('click', () => {
      const defaults = resetNotificationSettings();
      this.service.updateSettings(defaults);
      this.close();
      this.open();
    });

    // Test button
    panel.querySelector('#notif-test-btn')?.addEventListener('click', () => {
      this.service.notify('test', 'turnEnd', undefined, null);
    });

    // Save button
    panel.querySelector('#notif-save-btn')?.addEventListener('click', () => {
      this.service.updateSettings(settings);
      this.close();
    });
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
