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
import type { ControlCommandName, ControlCommandResult } from '../terminal/protocol';

export type AgentEventKind =
  | 'message'
  | 'turn-start'
  | 'turn-end'
  | 'tool-start'
  | 'user-message'
  | 'ask-user' // spec 015 — additive; existing kinds untouched.
  | 'ask-user-complete' // spec 015 hardening (h1) — precise local-resolve signal.
  | 'permission-request' // spec 016 (Workstream B) — orchestrator tool-approval gate relayed to a thread.
  | 'plan' // plan mode — an exit_plan_mode plan presented for approval.
  | 'plan-complete'; // plan mode — the exit_plan_mode interaction resolved (precise local-resolve signal).

export interface AgentEvent {
  agentId: string;
  kind: AgentEventKind;
  content?: string;
  toolName?: string;
  /**
   * Populated only when `kind === 'ask-user-complete'` (spec 015 hardening h1). The
   * SDK requestId of the interaction the runtime just resolved, so the consumer can
   * precisely clear a locally-answered pending question. '' when unavailable.
   */
  requestId?: string;
  /**
   * Populated only when `kind === 'permission-request'` (spec 016 Workstream B). The
   * orchestrator's always-on approval gate, relayed into the Teams thread as an
   * Approve/Deny question. `toolCallId` is the single-resolution key routed back via
   * {@link SessionGateway.respondPermission}.
   */
  permission?: {
    toolCallId: string;
    /** The gated tool (e.g. `bring_agent_online`). */
    toolName: string;
    /** Short human-readable summary of what will happen if approved. */
    summary: string;
  };
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
  /**
   * Populated only when `kind === 'plan'`. Carries the plan presented via
   * `exit_plan_mode`. `requestId` is the SDK single-resolution key (undefined/'' on the
   * node-pty path, which is render-only). Actions are the raw ordered exit-action ids.
   */
  plan?: {
    toolId: string;
    requestId?: string;
    summary: string;
    planContent: string;
    actions: string[];
    recommendedAction: string;
  };
  /**
   * Populated only when `kind === 'plan-complete'`. The runtime resolved an
   * `exit_plan_mode` interaction (e.g. approved locally in the TUI). `requestId` lets the
   * consumer precisely clear a locally-resolved pending plan (first-resolver-wins).
   */
  planComplete?: {
    requestId: string;
    approved: boolean;
    selectedAction?: string;
    feedback?: string;
  };
}

/** Minimal surface of TerminalRelay the gateway depends on (for testability). */
export interface TerminalRelayLike {
  mainGetSessionId(officeId: string, agentId: string): Promise<string | null>;
  mainGetSessionMeta(officeId: string, agentId: string): Promise<{ title?: string } | null>;
  mainWrite(officeId: string, agentId: string, data: string): Promise<{ success: boolean; error?: string }>;
  mainSubmitPrompt(officeId: string, agentId: string, prompt: string, label?: string): Promise<{ success: boolean; error?: string }>;
  mainResetSession(officeId: string, agentId: string): Promise<{ success: boolean; sessionId?: string }>;
  mainRunControl(officeId: string, agentId: string, command: ControlCommandName, arg?: string): Promise<ControlCommandResult>;
  mainSubmitAnswer(officeId: string, agentId: string, a: { requestId?: string; answer: string; wasFreeform: boolean }): Promise<{ success: boolean; error?: string }>;
  mainSubmitPlanDecision(officeId: string, agentId: string, d: { requestId?: string; approved: boolean; selectedAction?: string; feedback?: string }): Promise<{ success: boolean; error?: string }>;
  mainSetAgentForwarding(officeId: string, agentId: string, enabled: boolean): void;
  mainIsAgentReady(officeId: string, agentId: string): Promise<boolean>;
  /**
   * Start (or reuse) an agent's session for main-process use without claiming a
   * renderer viewer, waiting boundedly for readiness. Optional for test relays.
   */
  mainEnsureSessionOnline?(
    officeId: string,
    agentId: string,
    workingDir?: string,
  ): Promise<{ success: boolean; sessionId?: string; reused?: boolean; ready?: boolean; error?: string }>;
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
  /**
   * Make sure the agent's session is running and ready for programmatic use
   * before it is brought online: reuse a live, ready session (e.g. an already
   * connected native bridge), otherwise resume the persisted session in
   * `workingDir` and wait boundedly for readiness. Never claims a renderer
   * viewer. Resolves `{ success: false, error }` with an explicit reason when the
   * session (bridge) cannot come up. Optional: gateways whose sessions are
   * always live (e.g. the orchestrator) may omit it.
   */
  ensureSessionOnline?(
    officeId: string,
    agentId: string,
    workingDir?: string,
  ): Promise<{ success: boolean; sessionId?: string; error?: string }>;
  submitPrompt(officeId: string, agentId: string, prompt: string, label?: string): Promise<void>;
  /**
   * Reset (close + re-mint) an agent's session — used by Teams `/new` and `/clear`.
   * Resolves with the freshly-minted session id (or null if the reset failed).
   * Optional: gateways that can't reset (or don't need to) may omit it.
   */
  resetSession?(officeId: string, agentId: string): Promise<string | null>;
  /**
   * Run a session control command (`/compact`, `/usage`, `/model`) — used by Teams
   * slash-command interception. Returns the structured result (SDK path), a keystroke
   * acknowledgement (node-pty path), or a failure the caller posts as a graceful notice.
   * Optional: gateways without SDK control support may omit it.
   */
  runControl?(officeId: string, agentId: string, command: ControlCommandName, arg?: string): Promise<ControlCommandResult>;
  /**
   * spec 015: answer a pending `ask_user` interaction. The single transport-agnostic
   * answer seam — resolves the pending user-input interaction (SDK/ui-server) or
   * injects keystrokes (node-pty). NOT `submitPrompt`/enqueue. `requestId` is the
   * single-resolution key.
   */
  submitAnswer(officeId: string, agentId: string, a: { requestId?: string; answer: string; wasFreeform: boolean }): Promise<void>;
  /**
   * Plan mode: approve or reject a pending `exit_plan_mode` plan (see `AgentEvent` kind
   * `plan`). Resolves the blocked SDK handler on the SDK/ui-server backend. On the
   * node-pty backend this rejects (render-only — the plan is resolved in the local TUI).
   * `approved` chooses accept vs. suggest-changes; `selectedAction` is the chosen exit
   * action; `feedback` carries change requests when `approved` is false.
   */
  respondPlan(officeId: string, agentId: string, d: { requestId?: string; approved: boolean; selectedAction?: string; feedback?: string }): Promise<void>;
  /**
   * Enable/disable mirroring of copilot-events to the main process for an agent
   * that has no active renderer viewer. Must be enabled around a Teams-driven turn
   * so the assistant's reply can be captured and posted back to the thread.
   */
  setForwarding(officeId: string, agentId: string, enabled: boolean): void;
  /**
   * spec 016 (Workstream B): resolve an orchestrator tool-approval gate that was
   * relayed into a Teams thread (see `AgentEvent` kind `permission-request`). Only
   * meaningful for the orchestrator gateway; office-agent gateways treat it as a
   * no-op (their gates are never relayed).
   */
  respondPermission(officeId: string, agentId: string, toolCallId: string, decision: 'approve' | 'deny'): Promise<void>;
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

  async ensureSessionOnline(
    officeId: string,
    agentId: string,
    workingDir?: string,
  ): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    // Relays without the seam (older/test relays) keep the previous contract:
    // the caller's getSessionId check decides.
    if (!this.relay.mainEnsureSessionOnline) return { success: true };
    const res = await this.relay.mainEnsureSessionOnline(officeId, agentId, workingDir || undefined);
    if (!res?.success) {
      return {
        success: false,
        error: res?.error || `Copilot session for ${officeId}:${agentId} could not be brought online`,
      };
    }
    return res.sessionId ? { success: true, sessionId: res.sessionId } : { success: true };
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

  async resetSession(officeId: string, agentId: string): Promise<string | null> {
    const res = await this.relay.mainResetSession(officeId, agentId);
    return res?.success ? (res.sessionId ?? null) : null;
  }

  runControl(officeId: string, agentId: string, command: ControlCommandName, arg?: string): Promise<ControlCommandResult> {
    return this.relay.mainRunControl(officeId, agentId, command, arg);
  }

  setForwarding(officeId: string, agentId: string, enabled: boolean): void {
    this.relay.mainSetAgentForwarding(officeId, agentId, enabled);
  }

  async respondPermission(): Promise<void> {
    // Office agents never relay a permission gate into Teams (only the orchestrator
    // does, via its own gateway). No-op so the composite/default path is total.
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

  async respondPlan(
    officeId: string,
    agentId: string,
    d: { requestId?: string; approved: boolean; selectedAction?: string; feedback?: string },
  ): Promise<void> {
    // Plan mode: resolve the blocked exit_plan_mode handler (SDK/ui-server). node-pty
    // reports failure (render-only) → surfaced as a thrown error for the caller to notice.
    const res = await this.relay.mainSubmitPlanDecision(officeId, agentId, d);
    if (!res.success) {
      throw new Error(res.error || `Failed to submit plan decision to ${officeId}:${agentId}`);
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
    // spec 015 hardening (h1): the SDK resolved an ask_user interaction. Carries the
    // requestId so TeamsService can PRECISELY clear a locally-answered pending question
    // (SDK path) instead of the "any subsequent event" heuristic (node-pty only).
    const onAskUserComplete = (...args: unknown[]) => {
      const agentId = args[0] as string;
      const requestId = (args[1] as string) ?? '';
      cb({ agentId, kind: 'ask-user-complete', requestId });
    };
    // Plan mode: map the copilot-plan relay to a 'plan' AgentEvent. Transport-only —
    // selector labels and HTML formatting are assigned by the consumer (TeamsService).
    const onPlan = (...args: unknown[]) => {
      const agentId = args[0] as string;
      const toolId = (args[1] as string) ?? '';
      const requestId = (args[2] as string) ?? '';
      const summary = (args[3] as string) ?? '';
      const planContent = (args[4] as string) ?? '';
      const actions = (args[5] as string[]) ?? [];
      const recommendedAction = (args[6] as string) ?? '';
      cb({ agentId, kind: 'plan', plan: { toolId, requestId, summary, planContent, actions, recommendedAction } });
    };
    // Plan mode: the runtime resolved an exit_plan_mode interaction (e.g. approved in the
    // local TUI). Carries the requestId so TeamsService can precisely clear a pending plan.
    const onPlanComplete = (...args: unknown[]) => {
      const agentId = args[0] as string;
      const requestId = (args[1] as string) ?? '';
      const approved = Boolean(args[2]);
      const selectedAction = (args[3] as string) ?? undefined;
      const feedback = (args[4] as string) ?? undefined;
      cb({ agentId, kind: 'plan-complete', planComplete: { requestId, approved, selectedAction, feedback } });
    };

    this.relay.mainEvents.on('copilot-event', onCopilotEvent);
    this.relay.mainEvents.on('copilot-turn-start', onTurnStart);
    this.relay.mainEvents.on('copilot-turn-end', onTurnEnd);
    this.relay.mainEvents.on('copilot-tool-start', onToolStart);
    this.relay.mainEvents.on('copilot-user-message', onUserMessage);
    this.relay.mainEvents.on('copilot-ask-user', onAskUser);
    this.relay.mainEvents.on('copilot-ask-user-complete', onAskUserComplete);
    this.relay.mainEvents.on('copilot-plan', onPlan);
    this.relay.mainEvents.on('copilot-plan-complete', onPlanComplete);

    return () => {
      this.relay.mainEvents.off('copilot-event', onCopilotEvent);
      this.relay.mainEvents.off('copilot-turn-start', onTurnStart);
      this.relay.mainEvents.off('copilot-turn-end', onTurnEnd);
      this.relay.mainEvents.off('copilot-tool-start', onToolStart);
      this.relay.mainEvents.off('copilot-user-message', onUserMessage);
      this.relay.mainEvents.off('copilot-ask-user', onAskUser);
      this.relay.mainEvents.off('copilot-ask-user-complete', onAskUserComplete);
      this.relay.mainEvents.off('copilot-plan', onPlan);
      this.relay.mainEvents.off('copilot-plan-complete', onPlanComplete);
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
