// T003 — Global Teams settings shape + defaults (feature flag, default channel, check-in prefs).
// Re-exports the TeamsSettings type from the main-process module so the renderer shares one shape.

export interface TeamsSettings {
  /** Feature flag — gates whether the "Teams remote" control renders. */
  enabled: boolean;
  /** Default channel deep-link URL. */
  defaultChannelUrl: string;
  /** Post an immediate "message received" acknowledgment when a turn is dispatched. */
  ackEnabled: boolean;
  /** Long-running check-ins on/off. */
  checkInEnabled: boolean;
  /** Turn duration (ms) before the first check-in. */
  checkInThresholdMs: number;
  /** Minimum interval (ms) between check-ins. */
  checkInThrottleMs: number;
}

export const DEFAULT_TEAMS_SETTINGS: TeamsSettings = {
  enabled: false,
  defaultChannelUrl: '',
  ackEnabled: true,
  checkInEnabled: true,
  checkInThresholdMs: 120_000,
  checkInThrottleMs: 60_000,
};

/** Merge a partial (possibly persisted) settings object over the defaults. */
export function normalizeTeamsSettings(partial: Partial<TeamsSettings> | null | undefined): TeamsSettings {
  return {
    enabled: partial?.enabled ?? DEFAULT_TEAMS_SETTINGS.enabled,
    defaultChannelUrl: partial?.defaultChannelUrl ?? DEFAULT_TEAMS_SETTINGS.defaultChannelUrl,
    ackEnabled: partial?.ackEnabled ?? DEFAULT_TEAMS_SETTINGS.ackEnabled,
    checkInEnabled: partial?.checkInEnabled ?? DEFAULT_TEAMS_SETTINGS.checkInEnabled,
    checkInThresholdMs: partial?.checkInThresholdMs ?? DEFAULT_TEAMS_SETTINGS.checkInThresholdMs,
    checkInThrottleMs: partial?.checkInThrottleMs ?? DEFAULT_TEAMS_SETTINGS.checkInThrottleMs,
  };
}
