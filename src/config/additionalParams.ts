// Additional parameters setting — when enabled, the user-provided parameter
// string is appended to every Copilot CLI launch (e.g. "--model gpt-5.4").
// Persistence mirrors src/config/yoloMode.ts (localStorage, JSON-encoded).

export interface AdditionalParamsSettings {
  /** When true, `params` is appended to `copilot` launches. Default: false. */
  enabled: boolean;
  /** Raw parameter string, e.g. "--model gpt-5.4 --effort high". */
  params: string;
}

export const DEFAULT_ADDITIONAL_PARAMS_SETTINGS: AdditionalParamsSettings = {
  enabled: false,
  params: '',
};

export const STORAGE_KEY = 'copilot-office-additional-params';

function clone(): AdditionalParamsSettings {
  return { ...DEFAULT_ADDITIONAL_PARAMS_SETTINGS };
}

function readStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* SSR or restricted context */
  }
  return null;
}

export function getAdditionalParamsSettings(): AdditionalParamsSettings {
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
  const obj = parsed as Partial<AdditionalParamsSettings>;
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : false;
  const params = typeof obj.params === 'string' ? obj.params : '';
  return { enabled, params };
}

export function setAdditionalParamsSettings(next: AdditionalParamsSettings): void {
  const storage = readStorage();
  if (!storage) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ enabled: !!next.enabled, params: String(next.params ?? '') }),
    );
  } catch {
    /* quota or restricted — silently drop */
  }
}

export function resetAdditionalParamsSettings(): AdditionalParamsSettings {
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

/**
 * Single source of truth for the effective extra parameters appended to a
 * `copilot` launch. Returns the trimmed parameter string when the feature is
 * enabled, otherwise an empty string.
 */
export function getActiveAdditionalParams(): string {
  const settings = getAdditionalParamsSettings();
  if (!settings.enabled) return '';
  return settings.params.trim();
}
