import {
  getDefaultSettings,
  type NotificationSettings,
} from '../../src/config/notifications';

export function createNotificationSettings(
  overrides: Partial<NotificationSettings> = {}
): NotificationSettings {
  const defaults = getDefaultSettings();
  return {
    ...defaults,
    ...overrides,
    events: {
      ...defaults.events,
      ...(overrides.events || {}),
    },
  };
}

