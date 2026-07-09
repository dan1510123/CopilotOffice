// Shared Teams-domain types for the main-process Teams Remote Agents service.
// Types only — no runtime code. See specs/011-teams-remote-agents/data-model.md.

/** Global Teams settings (feature flag + default channel + check-in prefs). */
export interface TeamsSettings {
  /** Feature flag — gates whether the "Teams remote" control renders at all. */
  enabled: boolean;
  /** Default channel deep-link URL (parsed → team/channel/tenant). */
  defaultChannelUrl: string;
  /**
   * Optional relay/trigger channel deep-link (a dedicated "Dump" Teams channel watched by
   * a Power Automate "When a new channel message is added" flow). When non-empty it gates
   * the completion-notification feature: at each turn-end the app posts ONE notification to
   * this Dump channel carrying routing metadata, and the flow re-posts it under a distinct
   * bot identity — replying inside the agent's own thread with an @mention (so YOU get
   * notified, since Teams never notifies you about your own messages). Reply content itself
   * always posts directly as the signed-in user. Empty ⇒ completion notifications are off.
   */
  relayChannelUrl: string;
  /** Mention target kind for the relay flow: 'user' (person), 'tag' (Teams tag), or 'none'. */
  relayMentionType: 'user' | 'tag' | 'none';
  /** Mention target value — a UPN/oid/display-name (user) or tag display-name/tagId (tag). */
  relayMentionValue: string;
  /**
   * When true (and a relay Dump channel is configured), post ONE distinct-identity
   * @mention notification via the relay flow each time an agent finishes replying to a
   * Teams message — once per response, when the agent goes idle. The reply content itself
   * always posts directly as the signed-in user; this only controls the end-of-response
   * ping. No effect when {@link relayChannelUrl} is empty.
   */
  notifyOnCompleteEnabled: boolean;
  /** Post an immediate "message received" acknowledgment when a turn is dispatched. */
  ackEnabled: boolean;
  /** Long-running check-ins on/off. */
  checkInEnabled: boolean;
  /** Turn duration (ms) before the first check-in is posted. */
  checkInThresholdMs: number;
  /** Minimum interval (ms) between check-ins. */
  checkInThrottleMs: number;
}

/** Parsed channel coordinates from a Teams deep-link. */
export interface ChannelCoords {
  teamId: string;
  channelId: string;
  tenantId: string;
}

/** One online agent bound to one channel thread. */
export interface OnlineAgentBinding {
  agentId: string;
  officeId: string;
  sessionId: string;
  handle: string;
  displayName: string;
  workingDir: string;
  sessionTitle: string;
  teamId: string;
  channelId: string;
  tenantId: string;
  /** Root message id of the agent's thread (routing target). Empty while pending. */
  threadRootId: string;
  /** Thread web URL (for surfacing in the UI). */
  threadWebUrl?: string;
  online: boolean;
  /** Unix ms; drives 30-day GC. */
  lastConnected: number;
}

/** A thread the app has ever created (retained beyond binding removal). */
export interface KnownThread {
  threadRootId: string;
  /** Whether the one-time "no longer active" notice was already posted. */
  noticePosted: boolean;
}

/** Persisted store shape. */
export interface TeamsStoreState {
  bindings: OnlineAgentBinding[];
  knownThreads: KnownThread[];
}

/** Per-agent online status surfaced to the renderer. */
export interface OnlineAgentStatus {
  agentId: string;
  officeId: string;
  online: boolean;
  handle: string;
  threadWebUrl?: string;
  health: 'connected' | 'disconnected' | 'error';
  /** Working dir captured at register time. Lets the renderer warm a binding's
   *  session even when the agent belongs to a non-current office (whose roster
   *  is not in the active global AGENTS list). */
  workingDir: string;
}

/** Normalized inbound message under evaluation (not persisted). */
export interface InboundMessage {
  messageId: string;
  channelId: string;
  /** Extracted from conversationid `;messageid=` suffix; empty for root posts. */
  threadRootId: string;
  senderName: string;
  /**
   * Sender identity (MRI) when available, e.g. `8:orgid:{oid}` for a user or `28:{appId}`
   * for a bot/app. Used to drop bot-authored messages (e.g. the relay Flow bot's re-posts)
   * so they never route back into an agent. Absent when the transport didn't supply it.
   */
  senderId?: string;
  content: string;
  composeTime: string;
  hasMarker: boolean;
}

/** Filter classification for an inbound message's thread. */
export type ThreadClassification = 'bound' | 'orphaned' | 'foreign';

export type FilterAction = 'dispatch' | 'orphaned-notice' | 'ignore';

export interface FilterResult {
  action: FilterAction;
  classification?: ThreadClassification;
  binding?: OnlineAgentBinding;
  reason?: string;
}
