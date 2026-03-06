// NotificationService — central dispatch for all agent notifications
// Handles settings lookup, deduplication, message formatting, and routing

import {
  type NotificationEventType,
  type NotificationSettings,
  loadNotificationSettings,
  saveNotificationSettings,
} from '../config/notifications';
import { ToastNotificationManager } from './ToastNotification';

export interface NotifyContext {
  toolName?: string;
}

interface AgentInfo {
  name: string;
  color: number; // hex like 0x4488cc
}

type AgentResolver = (agentId: string) => AgentInfo | undefined;

export class NotificationService {
  private settings: NotificationSettings;
  private dedupeMap = new Map<string, number>(); // key → last-notified timestamp
  private toastManager: ToastNotificationManager;
  private resolveAgent: AgentResolver;
  private onClickAgent?: (agentId: string) => void;

  constructor(
    toastManager: ToastNotificationManager,
    resolveAgent: AgentResolver,
    onClickAgent?: (agentId: string) => void,
  ) {
    this.settings = loadNotificationSettings();
    this.toastManager = toastManager;
    this.resolveAgent = resolveAgent;
    this.onClickAgent = onClickAgent;
  }

  /** Reload settings from localStorage (call after settings UI saves). */
  reloadSettings(): void {
    this.settings = loadNotificationSettings();
  }

  /** Get current settings (for the settings UI). */
  getSettings(): NotificationSettings {
    return this.settings;
  }

  /** Update and persist settings. */
  updateSettings(settings: NotificationSettings): void {
    this.settings = settings;
    saveNotificationSettings(settings);
  }

  /**
   * Send a notification for an agent event.
   * @param agentId - The agent that triggered the event
   * @param eventType - Which event occurred
   * @param context - Optional context (e.g., toolName)
   * @param selectedAgentId - Currently selected agent (skip if same)
   */
  notify(
    agentId: string,
    eventType: NotificationEventType,
    context?: NotifyContext,
    selectedAgentId?: string | null,
  ): void {
    // Skip if this agent is currently selected (user is already looking at it)
    if (agentId === selectedAgentId) return;

    const eventConfig = this.settings.events[eventType];
    if (!eventConfig || !eventConfig.enabled) return;

    // Deduplication check
    const dedupeKey = `${agentId}:${eventType}`;
    const now = Date.now();
    const lastNotified = this.dedupeMap.get(dedupeKey);
    if (lastNotified && now - lastNotified < this.settings.dedupeWindowMs) {
      return;
    }
    this.dedupeMap.set(dedupeKey, now);

    // Resolve agent info
    const agent = this.resolveAgent(agentId);
    if (!agent) return;

    // Format message
    const message = this.formatMessage(eventConfig.message, agent.name, context);
    const colorHex = '#' + agent.color.toString(16).padStart(6, '0');

    // Toast notification
    if (eventConfig.toast) {
      this.toastManager.show({
        agentId,
        agentName: agent.name,
        agentColor: colorHex,
        message,
        onClick: () => this.onClickAgent?.(agentId),
      });
    }

    // Native OS notification
    if (eventConfig.osNotification) {
      window.copilotBridge?.showNativeNotification(
        `🏢 ${agent.name}`,
        message,
      );
    }
  }

  private formatMessage(template: string, agentName: string, context?: NotifyContext): string {
    let msg = template.replace(/\{agent\}/g, agentName);
    if (context?.toolName) {
      msg = msg.replace(/\{tool\}/g, context.toolName);
    } else {
      // Remove unreplaced {tool} placeholders gracefully
      msg = msg.replace(/\{tool\}/g, 'a tool');
    }
    return msg;
  }

  /** Periodically clean stale dedup entries (call sparingly). */
  cleanDedupeMap(): void {
    const now = Date.now();
    const cutoff = this.settings.dedupeWindowMs * 2;
    for (const [key, ts] of this.dedupeMap) {
      if (now - ts > cutoff) {
        this.dedupeMap.delete(key);
      }
    }
  }

  destroy(): void {
    this.dedupeMap.clear();
  }
}
