// Notification settings — global config for which events trigger toasts/OS notifications

export type NotificationEventType =
  | 'turnEnd'
  | 'askUser'
  | 'turnStart'
  | 'toolStart'
  | 'toolComplete'
  | 'sessionReady'
  | 'sessionError';

export interface NotificationEventConfig {
  enabled: boolean;
  toast: boolean;
  osNotification: boolean;
  message: string;
}

export type NotificationSettings = {
  events: Record<NotificationEventType, NotificationEventConfig>;
  dedupeWindowMs: number;
};

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  turnEnd: 'Turn Complete',
  askUser: 'Needs Input',
  turnStart: 'Turn Started',
  toolStart: 'Tool Started',
  toolComplete: 'Tool Finished',
  sessionReady: 'Session Ready',
  sessionError: 'Session Error',
};

const DEFAULT_SETTINGS: NotificationSettings = {
  dedupeWindowMs: 3000,
  events: {
    turnEnd: {
      enabled: true,
      toast: true,
      osNotification: false,
      message: '☕ {agent} wrapped up — ready when you are!',
    },
    askUser: {
      enabled: true,
      toast: true,
      osNotification: true,
      message: '🙋 Hey! {agent} has a question for you',
    },
    turnStart: {
      enabled: false,
      toast: false,
      osNotification: false,
      message: '⚡ {agent} just got to work',
    },
    toolStart: {
      enabled: false,
      toast: false,
      osNotification: false,
      message: '🔧 {agent} picked up {tool}',
    },
    toolComplete: {
      enabled: false,
      toast: false,
      osNotification: false,
      message: '✅ {agent} finished with {tool}',
    },
    sessionReady: {
      enabled: true,
      toast: true,
      osNotification: false,
      message: '👋 {agent} clocked in and is good to go!',
    },
    sessionError: {
      enabled: true,
      toast: true,
      osNotification: true,
      message: '😬 Uh oh — {agent} ran into trouble',
    },
  },
};

const STORAGE_KEY = 'copilot-notification-settings';

export function loadNotificationSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    // Merge with defaults so new event types get their defaults
    const merged = structuredClone(DEFAULT_SETTINGS);
    if (typeof parsed.dedupeWindowMs === 'number') {
      merged.dedupeWindowMs = parsed.dedupeWindowMs;
    }
    if (parsed.events) {
      for (const key of Object.keys(merged.events) as NotificationEventType[]) {
        if (parsed.events[key]) {
          merged.events[key] = { ...merged.events[key], ...parsed.events[key] };
        }
      }
    }
    return merged;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveNotificationSettings(settings: NotificationSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function resetNotificationSettings(): NotificationSettings {
  localStorage.removeItem(STORAGE_KEY);
  return structuredClone(DEFAULT_SETTINGS);
}

export function getDefaultSettings(): NotificationSettings {
  return structuredClone(DEFAULT_SETTINGS);
}
