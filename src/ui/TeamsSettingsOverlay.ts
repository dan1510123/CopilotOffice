// TeamsSettingsOverlay — DOM-modal settings for Teams Remote Agents (011).
//
// Focus contract: like NotificationSettingsPanel, this is a DOM-modal overlay.
// Owners MUST wire onOpen/onClose to InputManager.suspendGameInput/resumeGameInput
// (via the settings:open / settings:close bus). Uses ZIndex.TEAMS_SETTINGS.

import { ZIndex } from '../config/zIndex';
import type { TeamsSettings } from '../config/teamsConfig';
import { DEFAULT_TEAMS_SETTINGS } from '../config/teamsConfig';

export interface TeamsSettingsOverlayCallbacks {
  onOpen?: () => void;
  onClose?: () => void;
  /** Called after a successful save so the button visibility can refresh. */
  onSaved?: (settings: TeamsSettings) => void;
}

export class TeamsSettingsOverlay {
  private overlay: HTMLDivElement | null = null;

  constructor(private readonly callbacks: TeamsSettingsOverlayCallbacks = {}) {}

  isOpen(): boolean {
    return this.overlay !== null;
  }

  /** Open the overlay; optionally show a prompt banner (e.g. "no channel configured"). */
  async open(prompt?: string): Promise<void> {
    if (this.overlay) return;

    let settings: TeamsSettings = { ...DEFAULT_TEAMS_SETTINGS };
    try {
      const res = await window.copilotBridge.teamsGetSettings();
      if (res?.success && res.settings) settings = res.settings as TeamsSettings;
    } catch {
      /* use defaults */
    }

    this.callbacks.onOpen?.();

    this.overlay = document.createElement('div');
    this.overlay.id = 'teams-settings-overlay';
    this.overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      z-index: ${ZIndex.TEAMS_SETTINGS};
      display: flex; align-items: center; justify-content: center;
      font-family: 'Cascadia Code', Consolas, monospace;
    `;
    this.overlay.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.close();
    });

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1a1a2e; border: 2px solid #333; border-radius: 12px;
      padding: 24px; width: 560px; max-height: 82vh; overflow-y: auto; color: #dde;
    `;
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    panel.appendChild(this.buildContent(settings, prompt));
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    };
    document.addEventListener('keydown', this.keydownHandler, true);
  }

  close(): void {
    if (!this.overlay) return;
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
    this.overlay.remove();
    this.overlay = null;
    this.callbacks.onClose?.();
  }

  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  private buildContent(settings: TeamsSettings, prompt?: string): HTMLElement {
    const wrap = document.createElement('div');

    const title = document.createElement('h2');
    title.textContent = 'Teams Remote Agents';
    title.style.cssText = 'margin: 0 0 6px; font-size: 18px; color: #88ccff;';
    wrap.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.textContent =
      'Bring agents online in a Microsoft Teams channel. Requires the Azure CLI (`az`) signed in.';
    subtitle.style.cssText = 'margin: 0 0 16px; font-size: 12px; color: #99a;';
    wrap.appendChild(subtitle);

    if (prompt) {
      const banner = document.createElement('div');
      banner.textContent = prompt;
      banner.style.cssText =
        'margin: 0 0 16px; padding: 10px 12px; border-radius: 6px; background: #3a2a1a; border: 1px solid #7a5a2a; color: #ffcc88; font-size: 12px;';
      wrap.appendChild(banner);
    }

    const enabled = this.toggleRow('Enable Teams remote', settings.enabled);
    wrap.appendChild(enabled.row);

    const channelLabel = document.createElement('label');
    channelLabel.textContent = 'Default channel deep-link';
    channelLabel.style.cssText = 'display: block; margin: 16px 0 6px; font-size: 13px; color: #cdd;';
    wrap.appendChild(channelLabel);

    const channelInput = document.createElement('input');
    channelInput.type = 'text';
    channelInput.value = settings.defaultChannelUrl;
    channelInput.placeholder = 'https://teams.microsoft.com/l/channel/19%3A...';
    channelInput.style.cssText =
      'width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; border: 1px solid #445; background: #12121e; color: #dde; font-family: inherit; font-size: 12px;';
    wrap.appendChild(channelInput);

    const channelHint = document.createElement('p');
    channelHint.textContent =
      'In Teams, right-click the channel → "Get link to channel". Offices can override this in their settings.';
    channelHint.style.cssText = 'margin: 6px 0 0; font-size: 11px; color: #778;';
    wrap.appendChild(channelHint);

    const relayLabel = document.createElement('label');
    relayLabel.textContent = 'Relay Dump channel link (optional)';
    relayLabel.style.cssText = 'display: block; margin: 16px 0 6px; font-size: 13px; color: #cdd;';
    wrap.appendChild(relayLabel);

    const relayInput = document.createElement('input');
    relayInput.type = 'text';
    relayInput.value = settings.relayChannelUrl;
    relayInput.placeholder = 'https://teams.microsoft.com/l/channel/19%3A...';
    relayInput.style.cssText =
      'width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; border: 1px solid #445; background: #12121e; color: #dde; font-family: inherit; font-size: 12px;';
    wrap.appendChild(relayInput);

    const relayHint = document.createElement('p');
    relayHint.textContent =
      'Set a dedicated Dump channel watched by a Power Automate "When a new channel message is added" flow that re-posts each message to its real destination with an @mention, so you get notified under a distinct bot identity. Leave blank to post as your signed-in user. Note: relay posts are send-only (no threaded replies).';
    relayHint.style.cssText = 'margin: 6px 0 0; font-size: 11px; color: #778;';
    wrap.appendChild(relayHint);

    // Mention target for the relay flow: a person or a Teams tag (resolved by the app).
    const mentionLabel = document.createElement('label');
    mentionLabel.textContent = 'Relay @mention target (optional)';
    mentionLabel.style.cssText = 'display: block; margin: 16px 0 6px; font-size: 13px; color: #cdd;';
    wrap.appendChild(mentionLabel);

    const mentionRow = document.createElement('div');
    mentionRow.style.cssText = 'display: flex; gap: 8px;';

    const mentionType = document.createElement('select');
    mentionType.style.cssText =
      'flex: 0 0 110px; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; border: 1px solid #445; background: #12121e; color: #dde; font-family: inherit; font-size: 12px;';
    for (const [val, label] of [
      ['none', 'None'],
      ['user', 'User'],
      ['tag', 'Tag'],
    ] as const) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (settings.relayMentionType === val) opt.selected = true;
      mentionType.appendChild(opt);
    }
    mentionRow.appendChild(mentionType);

    const mentionValue = document.createElement('input');
    mentionValue.type = 'text';
    mentionValue.value = settings.relayMentionValue;
    mentionValue.placeholder = 'Name or ID (user UPN / display name, or tag name)';
    mentionValue.style.cssText =
      'flex: 1; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; border: 1px solid #445; background: #12121e; color: #dde; font-family: inherit; font-size: 12px;';
    mentionRow.appendChild(mentionValue);
    wrap.appendChild(mentionRow);

    const mentionHint = document.createElement('p');
    mentionHint.textContent =
      'Who the Flow bot @mentions in the destination channel. User: a UPN, object id, or display name. Tag: a Teams tag name (resolved per destination team). None: no mention.';
    mentionHint.style.cssText = 'margin: 6px 0 0; font-size: 11px; color: #778;';
    wrap.appendChild(mentionHint);

    const syncMentionEnabled = () => {
      mentionValue.disabled = mentionType.value === 'none';
      mentionValue.style.opacity = mentionValue.disabled ? '0.5' : '1';
    };
    mentionType.onchange = syncMentionEnabled;
    syncMentionEnabled();

    const ack = this.toggleRow('Acknowledge received messages (⌛)', settings.ackEnabled);
    ack.row.style.marginTop = '16px';
    wrap.appendChild(ack.row);

    const checkIn = this.toggleRow('Post interim check-ins on long turns', settings.checkInEnabled);
    checkIn.row.style.marginTop = '10px';
    wrap.appendChild(checkIn.row);

    const error = document.createElement('div');
    error.style.cssText = 'margin-top: 12px; font-size: 12px; color: #ff8888; min-height: 16px;';
    wrap.appendChild(error);

    const footer = document.createElement('div');
    footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px;';

    const cancelBtn = this.button('Cancel', '#2a3a4a');
    cancelBtn.onclick = () => this.close();
    footer.appendChild(cancelBtn);

    const saveBtn = this.button('Save', '#2a4a3a');
    saveBtn.style.color = '#88ffaa';
    saveBtn.onclick = async () => {
      error.textContent = '';
      const next: TeamsSettings = {
        ...settings,
        enabled: enabled.input.checked,
        defaultChannelUrl: channelInput.value.trim(),
        relayChannelUrl: relayInput.value.trim(),
        relayMentionType: mentionType.value as 'user' | 'tag' | 'none',
        relayMentionValue: mentionValue.value.trim(),
        ackEnabled: ack.input.checked,
        checkInEnabled: checkIn.input.checked,
      };
      try {
        const res = await window.copilotBridge.teamsSaveSettings(next);
        if (!res?.success) {
          error.textContent = res?.error || 'Failed to save settings.';
          return;
        }
        this.callbacks.onSaved?.(next);
        this.close();
      } catch (e) {
        error.textContent = (e as Error).message || 'Failed to save settings.';
      }
    };
    footer.appendChild(saveBtn);
    wrap.appendChild(footer);

    return wrap;
  }

  private toggleRow(label: string, checked: boolean): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement('label');
    row.style.cssText =
      'display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; font-size: 13px; color: #cdd;';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';
    row.appendChild(span);
    row.appendChild(input);
    return { row, input };
  }

  private button(text: string, bg: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = `
      background: ${bg}; border: 1px solid #4a5a6a; color: #cde; padding: 8px 18px;
      border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 13px;
    `;
    return b;
  }
}
