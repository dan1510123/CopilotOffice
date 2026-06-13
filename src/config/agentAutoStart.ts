// Agent auto-start settings — gates the spec-009 auto-startup feature.
// Persistence mirrors src/config/notifications.ts (localStorage, JSON-encoded).

export interface AgentAutoStartSettings {
  /** FR-016: gates cold-launch, office-switch, and post-New-Session triggers.
   *  Default: true (FR-019, US4 SC-005). */
  autoStartKnownAgents: boolean;
}

export const DEFAULT_AGENT_AUTO_START_SETTINGS: AgentAutoStartSettings = {
  autoStartKnownAgents: true,
};

export const STORAGE_KEY = 'copilot-office-agent-auto-start';

function clone(): AgentAutoStartSettings {
  return { ...DEFAULT_AGENT_AUTO_START_SETTINGS };
}

function readStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* SSR or restricted context */
  }
  return null;
}

export function getAgentAutoStartSettings(): AgentAutoStartSettings {
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
  const candidate = (parsed as Partial<AgentAutoStartSettings>).autoStartKnownAgents;
  if (typeof candidate !== 'boolean') return clone();
  return { autoStartKnownAgents: candidate };
}

export function setAgentAutoStartSettings(next: AgentAutoStartSettings): void {
  const storage = readStorage();
  if (!storage) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ autoStartKnownAgents: !!next.autoStartKnownAgents }),
    );
  } catch {
    /* quota or restricted — silently drop */
  }
}

export function resetAgentAutoStartSettings(): AgentAutoStartSettings {
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
 * Spec 009 FR-017: single source of truth for "should any auto-startup
 * behavior fire?". Used by both the spec-009 AutoStartCoordinator and the
 * spec-002 OfficeScene.preStartAgentSessions roster pre-start so that
 * setting=OFF gates every automatic spawn path uniformly.
 */
export function shouldAutoStart(): boolean {
  return getAgentAutoStartSettings().autoStartKnownAgents === true;
}
