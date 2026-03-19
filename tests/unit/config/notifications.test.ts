import { describe, expect, it } from 'vitest';
import {
  getDefaultSettings,
  loadNotificationSettings,
  resetNotificationSettings,
  saveNotificationSettings,
} from '../../../src/config/notifications';

describe('config/notifications', () => {
  it('loads defaults when storage is empty', () => {
    localStorage.removeItem('copilot-notification-settings');
    const settings = loadNotificationSettings();
    const defaults = getDefaultSettings();
    expect(settings).toEqual(defaults);
    expect(settings).not.toBe(defaults);
  });

  it('merges partial persisted settings with defaults', () => {
    localStorage.setItem(
      'copilot-notification-settings',
      JSON.stringify({
        dedupeWindowMs: 5000,
        events: {
          turnEnd: { enabled: false },
        },
      })
    );

    const settings = loadNotificationSettings();
    expect(settings.dedupeWindowMs).toBe(5000);
    expect(settings.events.turnEnd.enabled).toBe(false);
    expect(settings.events.turnEnd.toast).toBe(true);
    expect(settings.events.askUser.enabled).toBe(true);
  });

  it('falls back to defaults on malformed JSON', () => {
    localStorage.setItem('copilot-notification-settings', '{bad json');
    const settings = loadNotificationSettings();
    expect(settings).toEqual(getDefaultSettings());
  });

  it('saves and resets settings', () => {
    const settings = getDefaultSettings();
    settings.dedupeWindowMs = 1234;

    saveNotificationSettings(settings);
    expect(loadNotificationSettings().dedupeWindowMs).toBe(1234);

    const reset = resetNotificationSettings();
    expect(reset).toEqual(getDefaultSettings());
    expect(localStorage.getItem('copilot-notification-settings')).toBeNull();
  });
});

