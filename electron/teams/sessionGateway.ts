// T015 — SessionGateway: adapter over the existing terminal server (via TerminalRelay).
//
// Bridges the Teams service to CopilotOffice's terminal infrastructure without touching
// `activeAgentViewers` or introducing a new session lifecycle. Prompt submission reuses the
// PTY write path (`write` = `proc.write(prompt + '\r')`, the same mechanism as pre-seeded
// prompts). Response capture consumes the server's structured copilot events.
//
// NOTE: server→main events carry only `agentId` (not officeId). The Teams service maps an
// agentId to its single online binding; concurrent online bindings for the same agentId
// across offices are out of scope for v1.

import type { CopilotEvent } from '../terminal/events-watcher';

export type AgentEventKind = 'message' | 'turn-start' | 'turn-end' | 'tool-start';

export interface AgentEvent {
  agentId: string;
  kind: AgentEventKind;
  content?: string;
  toolName?: string;
}

/** Minimal surface of TerminalRelay the gateway depends on (for testability). */
export interface TerminalRelayLike {
  mainGetSessionId(officeId: string, agentId: string): Promise<string | null>;
  mainGetSessionMeta(officeId: string, agentId: string): Promise<{ title?: string } | null>;
  mainWrite(officeId: string, agentId: string, data: string): Promise<{ success: boolean; error?: string }>;
  mainSubmitPrompt(officeId: string, agentId: string, prompt: string): Promise<{ success: boolean; error?: string }>;
  mainEvents: {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    off(event: string, listener: (...args: unknown[]) => void): unknown;
  };
}

export interface SessionGateway {
  getSessionId(officeId: string, agentId: string): Promise<string | null>;
  getSessionMeta(officeId: string, agentId: string): Promise<{ title?: string } | null>;
  submitPrompt(officeId: string, agentId: string, prompt: string): Promise<void>;
  onAgentEvent(cb: (e: AgentEvent) => void): () => void;
  /** Fires when a session ends (agentId's PTY exits). */
  onSessionExit(cb: (agentId: string) => void): () => void;
}

export class RelaySessionGateway implements SessionGateway {
  constructor(private readonly relay: TerminalRelayLike) {}

  getSessionId(officeId: string, agentId: string): Promise<string | null> {
    return this.relay.mainGetSessionId(officeId, agentId);
  }

  getSessionMeta(officeId: string, agentId: string): Promise<{ title?: string } | null> {
    return this.relay.mainGetSessionMeta(officeId, agentId);
  }

  async submitPrompt(officeId: string, agentId: string, prompt: string): Promise<void> {
    // Use the backend's atomic submit (SDK enqueue) rather than simulating
    // keystrokes; the server falls back to bracketed-paste for raw PTY backends.
    const res = await this.relay.mainSubmitPrompt(officeId, agentId, prompt);
    if (!res.success) {
      throw new Error(res.error || `Failed to submit prompt to ${officeId}:${agentId}`);
    }
  }

  onAgentEvent(cb: (e: AgentEvent) => void): () => void {
    const onCopilotEvent = (...args: unknown[]) => {
      const agentId = args[0] as string;
      const event = args[1] as CopilotEvent;
      if (event?.type === 'assistant.message') {
        const content = extractMessageContent(event);
        if (content) cb({ agentId, kind: 'message', content });
      }
    };
    const onTurnStart = (...args: unknown[]) => cb({ agentId: args[0] as string, kind: 'turn-start' });
    const onTurnEnd = (...args: unknown[]) => cb({ agentId: args[0] as string, kind: 'turn-end' });
    const onToolStart = (...args: unknown[]) =>
      cb({ agentId: args[0] as string, kind: 'tool-start', toolName: args[1] as string });

    this.relay.mainEvents.on('copilot-event', onCopilotEvent);
    this.relay.mainEvents.on('copilot-turn-start', onTurnStart);
    this.relay.mainEvents.on('copilot-turn-end', onTurnEnd);
    this.relay.mainEvents.on('copilot-tool-start', onToolStart);

    return () => {
      this.relay.mainEvents.off('copilot-event', onCopilotEvent);
      this.relay.mainEvents.off('copilot-turn-start', onTurnStart);
      this.relay.mainEvents.off('copilot-turn-end', onTurnEnd);
      this.relay.mainEvents.off('copilot-tool-start', onToolStart);
    };
  }

  onSessionExit(cb: (agentId: string) => void): () => void {
    const onExit = (...args: unknown[]) => cb(args[0] as string);
    this.relay.mainEvents.on('terminal-exit', onExit);
    return () => this.relay.mainEvents.off('terminal-exit', onExit);
  }
}

/** Pull assistant text out of a copilot `assistant.message` event. */
export function extractMessageContent(event: CopilotEvent): string {
  const data = (event?.data ?? {}) as Record<string, unknown>;
  const content = data.content ?? data.text ?? data.message;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : (c as Record<string, unknown>)?.text))
      .filter((s): s is string => typeof s === 'string')
      .join('');
  }
  return '';
}
