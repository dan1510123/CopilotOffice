// YOLO mode setting — when ON, every Copilot CLI terminal launches with the
// `--yolo` flag (auto-approves all tool/file/URL permissions).
// Persistence mirrors src/config/agentAutoStart.ts (localStorage, JSON-encoded).

export interface YoloModeSettings {
  /** When true, terminals spin up with `copilot --yolo`. Default: false (opt-in). */
  yoloEnabled: boolean;
}

export const DEFAULT_YOLO_MODE_SETTINGS: YoloModeSettings = {
  yoloEnabled: false,
};

export const STORAGE_KEY = 'copilot-office-yolo-mode';

function clone(): YoloModeSettings {
  return { ...DEFAULT_YOLO_MODE_SETTINGS };
}

function readStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* SSR or restricted context */
  }
  return null;
}

export function getYoloModeSettings(): YoloModeSettings {
  const storage = readStorage();
  if (!storage) return clone();
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return clone();
  }
  if (raw === null || raw === undefined) return clone();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt JSON — fail open and clear the bad key.
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return clone();
  }
  if (!parsed || typeof parsed !== 'object') return clone();
  const candidate = (parsed as Partial<YoloModeSettings>).yoloEnabled;
  if (typeof candidate !== 'boolean') return clone();
  return { yoloEnabled: candidate };
}

export function setYoloModeSettings(next: YoloModeSettings): void {
  const storage = readStorage();
  if (!storage) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ yoloEnabled: !!next.yoloEnabled }),
    );
  } catch {
    /* quota or restricted — silently drop */
  }
}

export function resetYoloModeSettings(): YoloModeSettings {
  const storage = readStorage();
  if (storage) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  return clone();
}

/** Single source of truth for "should new terminals launch with --yolo?". */
export function isYoloEnabled(): boolean {
  return getYoloModeSettings().yoloEnabled === true;
}
