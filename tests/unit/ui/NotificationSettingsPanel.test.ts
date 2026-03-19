import { describe, expect, it, vi } from 'vitest';
import { getDefaultSettings } from '../../../src/config/notifications';
import { NotificationSettingsPanel } from '../../../src/ui/NotificationSettingsPanel';

describe('ui/NotificationSettingsPanel', () => {
  function createPanel() {
    const settings = getDefaultSettings();
    const service = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn(),
      notify: vi.fn(),
    };
    return {
      panel: new NotificationSettingsPanel(service as any),
      service,
    };
  }

  it('opens and closes overlay', () => {
    const { panel } = createPanel();
    panel.open();
    expect(panel.isOpen()).toBe(true);
    expect(document.querySelector('#notification-settings-overlay')).toBeTruthy();
    panel.close();
    expect(panel.isOpen()).toBe(false);
  });

  it('saves edited settings', () => {
    const { panel, service } = createPanel();
    panel.open();

    const dedupe = document.querySelector('#notif-dedupe-ms') as HTMLInputElement;
    dedupe.value = '4500';
    dedupe.dispatchEvent(new Event('input', { bubbles: true }));

    const enabled = document.querySelector(
      'input[data-event="turnStart"][data-field="enabled"]'
    ) as HTMLInputElement;
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));

    const save = document.querySelector('#notif-save-btn') as HTMLButtonElement;
    save.click();

    expect(service.updateSettings).toHaveBeenCalledTimes(1);
    const payload = service.updateSettings.mock.calls[0][0];
    expect(payload.dedupeWindowMs).toBe(4500);
    expect(payload.events.turnStart.enabled).toBe(true);
  });

  it('supports reset and test toast actions', () => {
    const { panel, service } = createPanel();
    panel.open();

    (document.querySelector('#notif-test-btn') as HTMLButtonElement).click();
    expect(service.notify).toHaveBeenCalledWith('test', 'turnEnd', undefined, null);

    (document.querySelector('#notif-reset-btn') as HTMLButtonElement).click();
    expect(service.updateSettings).toHaveBeenCalled();
    expect(panel.isOpen()).toBe(true);
  });
});

