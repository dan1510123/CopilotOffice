// T003 — Global Teams settings shape + defaults (feature flag, default channel, check-in prefs).
// Re-exports the TeamsSettings type from the main-process module so the renderer shares one shape.

export interface TeamsSettings {
  /** Feature flag — gates whether the "Teams remote" control renders. */
  enabled: boolean;
  /** Default channel deep-link URL. */
  defaultChannelUrl: string;
  /**
   * Optional relay/trigger channel deep-link (watched by a Power Automate flow).
   * Non-empty ⇒ outbound Teams posts go to this trigger channel and the flow re-posts
   * them under a distinct bot identity (so you get notified). Empty ⇒ fall back to the
   * signed-in-user Graph sender.
   */
  relayChannelUrl: string;
  /** Mention target kind for the relay flow: 'user' (person), 'tag' (Teams tag), or 'none'. */
  relayMentionType: 'user' | 'tag' | 'none';
  /** Mention target value — a UPN/oid/display-name (user) or tag display-name/tagId (tag). */
  relayMentionValue: string;
  /**
   * When true (and a relay Dump channel is configured), post one distinct-identity
   * @mention notification via the relay flow when an agent finishes replying (once per
   * response, at idle). Reply content always posts directly as the signed-in user.
   */
  notifyOnCompleteEnabled: boolean;
  /** Post an immediate "message received" acknowledgment when a turn is dispatched. */
  ackEnabled: boolean;
  /** Long-running check-ins on/off. */
  checkInEnabled: boolean;
  /** Turn duration (ms) before the first check-in. */
  checkInThresholdMs: number;
  /** Minimum interval (ms) between check-ins. */
  checkInThrottleMs: number;
  /**
   * Gate for the spec-018 auto-render feature (FR-010): when ON (default), a qualifying
   * markdown reply posts as an inline Teams image in place of its plain text (replace-with-
   * fallback). When false the auto-render path is inert and replies post as plain text.
   */
  autoRenderMarkdownImages: boolean;
}

export const DEFAULT_TEAMS_SETTINGS: TeamsSettings = {
  enabled: false,
  defaultChannelUrl: '',
  relayChannelUrl: '',
  relayMentionType: 'none',
  relayMentionValue: '',
  notifyOnCompleteEnabled: false,
  ackEnabled: true,
  checkInEnabled: true,
  checkInThresholdMs: 120_000,
  checkInThrottleMs: 60_000,
  autoRenderMarkdownImages: true,
};

/** Merge a partial (possibly persisted) settings object over the defaults. */
export function normalizeTeamsSettings(partial: Partial<TeamsSettings> | null | undefined): TeamsSettings {
  return {
    enabled: partial?.enabled ?? DEFAULT_TEAMS_SETTINGS.enabled,
    defaultChannelUrl: partial?.defaultChannelUrl ?? DEFAULT_TEAMS_SETTINGS.defaultChannelUrl,
    relayChannelUrl: partial?.relayChannelUrl ?? DEFAULT_TEAMS_SETTINGS.relayChannelUrl,
    relayMentionType: partial?.relayMentionType ?? DEFAULT_TEAMS_SETTINGS.relayMentionType,
    relayMentionValue: partial?.relayMentionValue ?? DEFAULT_TEAMS_SETTINGS.relayMentionValue,
    notifyOnCompleteEnabled: partial?.notifyOnCompleteEnabled ?? DEFAULT_TEAMS_SETTINGS.notifyOnCompleteEnabled,
    ackEnabled: partial?.ackEnabled ?? DEFAULT_TEAMS_SETTINGS.ackEnabled,
    checkInEnabled: partial?.checkInEnabled ?? DEFAULT_TEAMS_SETTINGS.checkInEnabled,
    checkInThresholdMs: partial?.checkInThresholdMs ?? DEFAULT_TEAMS_SETTINGS.checkInThresholdMs,
    checkInThrottleMs: partial?.checkInThrottleMs ?? DEFAULT_TEAMS_SETTINGS.checkInThrottleMs,
    autoRenderMarkdownImages: partial?.autoRenderMarkdownImages ?? DEFAULT_TEAMS_SETTINGS.autoRenderMarkdownImages,
  };
}
