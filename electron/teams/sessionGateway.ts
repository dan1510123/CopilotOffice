// T015 — SessionGateway: adapter over the existing terminal server (via TerminalRelay).
//
// Bridges the Teams service to CopilotOffice's terminal infrastructure without touching
// `activeAgentViewers` or introducing a new session lifecycle. Prompt submission goes through
// the backend's atomic submit (`TerminalRelay.mainSubmitPrompt` → server `submit-prompt`):
// the ui-server/SDK backend enqueues programmatically (`session.send({ mode: 'enqueue' })`),
// and the node-pty backend falls back to keystroke injection via `submitViaKeystrokes`
// (idle-gated Ctrl+U → bracketed paste → Enter — not a bare `write(prompt + '\r')`).
// Response capture consumes the server's structured copilot events.
//
// NOTE: server→main events carry only `agentId` (not officeId). The Teams service maps an
// agentId to its single online binding; concurrent online bindings for the same agentId
// across offices are out of scope for v1.

import type { CopilotEvent } from '../terminal/events-watcher';

export type AgentEventKind =
  | 'message'
  | 'turn-start'
  | 'turn-end'
  | 'tool-start'
  | 'user-message'
  | 'ask-user'; // spec 015 — additive; existing kinds untouched.

export interface AgentEvent {
  agentId: string;
  kind: AgentEventKind;
  content?: string;
  toolName?: string;
  /**
   * Populated only when `kind === 'ask-user'` (spec 015). Carries the raw ordered
   * option display text; selector labels (A/B/C…) are assigned by the consumer
   * (TeamsService), NOT here — the gateway is transport-only.
   */
  askUser?: {
    toolId: string;
    /** SDK single-resolution key; undefined on the node-pty degraded path. */
    requestId?: string;
    question: string;
    options: { text: string }[];
    freeform: boolean;
  };
}

/** Minimal surface of TerminalRelay the gateway depends on (for testability). */
export interface TerminalRelayLike {
  mainGetSessionId(officeId: string, agentId: string): Promise<string | null>;
  mainGetSessionMeta(officeId: string, agentId: string): Promise<{ title?: string } | null>;
  mainWrite(officeId: string, agentId: string, data: string): Promise<{ success: boolean; error?: string }>;
  mainSubmitPrompt(officeId: string, agentId: string, prompt: string, label?: string): Promise<{ success: boolean; error?: string }>;
  mainSubmitAnswer(officeId: string, agentId: string, a: { requestId?: string; answer: string; wasFreeform: boolean }): Promise<{ success: boolean; error?: string }>;
  mainSetAgentForwarding(officeId: string, agentId: string, enabled: boolean): void;
  mainIsAgentReady(officeId: string, agentId: string): Promise<boolean>;
  mainEvents: {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    off(event: string, listener: (...args: unknown[]) => void): unknown;
  };
}

export interface SessionGateway {
  getSessionId(officeId: string, agentId: string): Promise<string | null>;
  getSessionMeta(officeId: string, agentId: string): Promise<{ title?: string } | null>;
  /** True only when the agent's PTY is alive AND the CLI has signalled ready. */
  isAgentReady(officeId: string, agentId: string): Promise<boolean>;
  submitPrompt(officeId: string, agentId: string, prompt: string, label?: string): Promise<void>;
  /**
   * spec 015: answer a pending `ask_user` interaction. The single transport-agnostic
   * answer seam — resolves the pending user-input interaction (SDK/ui-server) or
   * injects keystrokes (node-pty). NOT `submitPrompt`/enqueue. `requestId` is the
   * single-resolution key.
   */
  submitAnswer(officeId: string, agentId: string, a: { requestId?: string; answer: string; wasFreeform: boolean }): Promise<void>;
  /**
   * Enable/disable mirroring of copilot-events to the main process for an agent
   * that has no active renderer viewer. Must be enabled around a Teams-driven turn
   * so the assistant's reply can be captured and posted back to the thread.
   */
  setForwarding(officeId: string, agentId: string, enabled: boolean): void;
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

  isAgentReady(officeId: string, agentId: string): Promise<boolean> {
    return this.relay.mainIsAgentReady(officeId, agentId);
  }

  async submitPrompt(officeId: string, agentId: string, prompt: string, label?: string): Promise<void> {
    // Use the backend's atomic submit (SDK enqueue) rather than simulating
    // keystrokes; the server falls back to bracketed-paste for raw PTY backends.
    // `label` is a display-only tag echoed in the terminal (never sent to the agent).
    const res = await this.relay.mainSubmitPrompt(officeId, agentId, prompt, label);
    if (!res.success) {
      throw new Error(res.error || `Failed to submit prompt to ${officeId}:${agentId}`);
    }
  }

  setForwarding(officeId: string, agentId: string, enabled: boolean): void {
    this.relay.mainSetAgentForwarding(officeId, agentId, enabled);
  }

  async submitAnswer(
    officeId: string,
    agentId: string,
    a: { requestId?: string; answer: string; wasFreeform: boolean },
  ): Promise<void> {
    // spec 015: resolve the pending user-input interaction (SDK) or inject keystrokes
    // (node-pty) via the dedicated submit-answer IPC — never submitPrompt/enqueue.
    const res = await this.relay.mainSubmitAnswer(officeId, agentId, a);
    if (!res.success) {
      throw new Error(res.error || `Failed to submit answer to ${officeId}:${agentId}`);
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
    const onUserMessage = (...args: unknown[]) =>
      cb({ agentId: args[0] as string, kind: 'user-message', content: (args[1] as string) ?? '' });
    // spec 015: map the additive copilot-ask-user relay to an 'ask-user' AgentEvent.
    // Transport-only — selector labels (A/B/C) are assigned by the consumer (TeamsService).
    const onAskUser = (...args: unknown[]) => {
      const agentId = args[0] as string;
      const toolId = (args[1] as string) ?? '';
      const requestId = (args[2] as string) ?? '';
      const question = (args[3] as string) ?? '';
      const options = (args[4] as { text: string }[]) ?? [];
      const freeform = Boolean(args[5]);
      cb({ agentId, kind: 'ask-user', askUser: { toolId, requestId, question, options, freeform } });
    };

    this.relay.mainEvents.on('copilot-event', onCopilotEvent);
    this.relay.mainEvents.on('copilot-turn-start', onTurnStart);
    this.relay.mainEvents.on('copilot-turn-end', onTurnEnd);
    this.relay.mainEvents.on('copilot-tool-start', onToolStart);
    this.relay.mainEvents.on('copilot-user-message', onUserMessage);
    this.relay.mainEvents.on('copilot-ask-user', onAskUser);

    return () => {
      this.relay.mainEvents.off('copilot-event', onCopilotEvent);
      this.relay.mainEvents.off('copilot-turn-start', onTurnStart);
      this.relay.mainEvents.off('copilot-turn-end', onTurnEnd);
      this.relay.mainEvents.off('copilot-tool-start', onToolStart);
      this.relay.mainEvents.off('copilot-user-message', onUserMessage);
      this.relay.mainEvents.off('copilot-ask-user', onAskUser);
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
