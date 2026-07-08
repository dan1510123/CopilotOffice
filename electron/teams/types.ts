// Shared Teams-domain types for the main-process Teams Remote Agents service.
// Types only — no runtime code. See specs/011-teams-remote-agents/data-model.md.

/** Global Teams settings (feature flag + default channel + check-in prefs). */
export interface TeamsSettings {
  /** Feature flag — gates whether the "Teams remote" control renders at all. */
  enabled: boolean;
  /** Default channel deep-link URL (parsed → team/channel/tenant). */
  defaultChannelUrl: string;
  /**
   * Optional relay/trigger channel deep-link (a dedicated Teams channel watched by a
   * Power Automate "When a new channel message is added" flow). When non-empty it acts
   * as a feature flag: all outbound Teams posts are posted to this trigger channel so
   * the flow re-posts them under a distinct bot identity with an @mention (so YOU get
   * notified, since Teams never notifies you about your own messages). Send-only — no
   * threaded reply routing on this path. Empty ⇒ fall back to the signed-in-user Graph
   * sender.
   */
  relayChannelUrl: string;
  /** Mention target kind for the relay flow: 'user' (person), 'tag' (Teams tag), or 'none'. */
  relayMentionType: 'user' | 'tag' | 'none';
  /** Mention target value — a UPN/oid/display-name (user) or tag display-name/tagId (tag). */
  relayMentionValue: string;
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
}

/** Normalized inbound message under evaluation (not persisted). */
export interface InboundMessage {
  messageId: string;
  channelId: string;
  /** Extracted from conversationid `;messageid=` suffix; empty for root posts. */
  threadRootId: string;
  senderName: string;
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
