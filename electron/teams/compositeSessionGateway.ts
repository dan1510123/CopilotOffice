// CompositeSessionGateway (spec 016 — Workstream B, B4).
//
// Routes SessionGateway calls by key: the synthetic orchestrator identity
// (`__orchestrator__`, `orchestrator`) goes to the OrchestratorSessionGateway;
// every other `(officeId, agentId)` goes to the office RelaySessionGateway. This
// lets TeamsService keep its uniform `(officeId, agentId)` keying while bringing
// either kind of session online. Event/exit subscriptions fan in from BOTH
// underlying gateways so a single `onAgentEvent`/`onSessionExit` callback sees
// orchestrator AND office-agent events.

import { isOrchestratorKey } from '../orchestrator/orchestratorIdentity';
import type { AgentEvent, SessionGateway } from './sessionGateway';

export class CompositeSessionGateway implements SessionGateway {
  constructor(
    private readonly office: SessionGateway,
    private readonly orchestrator: SessionGateway,
  ) {}

  private pick(officeId: string, agentId: string): SessionGateway {
    return isOrchestratorKey(officeId, agentId) ? this.orchestrator : this.office;
  }

  getSessionId(officeId: string, agentId: string): Promise<string | null> {
    return this.pick(officeId, agentId).getSessionId(officeId, agentId);
  }

  getSessionMeta(officeId: string, agentId: string): Promise<{ title?: string } | null> {
    return this.pick(officeId, agentId).getSessionMeta(officeId, agentId);
  }

  isAgentReady(officeId: string, agentId: string): Promise<boolean> {
    return this.pick(officeId, agentId).isAgentReady(officeId, agentId);
  }

  submitPrompt(officeId: string, agentId: string, prompt: string, label?: string): Promise<void> {
    return this.pick(officeId, agentId).submitPrompt(officeId, agentId, prompt, label);
  }

  submitAnswer(
    officeId: string,
    agentId: string,
    a: { requestId?: string; answer: string; wasFreeform: boolean },
  ): Promise<void> {
    return this.pick(officeId, agentId).submitAnswer(officeId, agentId, a);
  }

  setForwarding(officeId: string, agentId: string, enabled: boolean): void {
    this.pick(officeId, agentId).setForwarding(officeId, agentId, enabled);
  }

  respondPermission(
    officeId: string,
    agentId: string,
    toolCallId: string,
    decision: 'approve' | 'deny',
  ): Promise<void> {
    return this.pick(officeId, agentId).respondPermission(officeId, agentId, toolCallId, decision);
  }

  onAgentEvent(cb: (e: AgentEvent) => void): () => void {
    const offOffice = this.office.onAgentEvent(cb);
    const offOrchestrator = this.orchestrator.onAgentEvent(cb);
    return () => {
      offOffice();
      offOrchestrator();
    };
  }

  onSessionExit(cb: (agentId: string) => void): () => void {
    const offOffice = this.office.onSessionExit(cb);
    const offOrchestrator = this.orchestrator.onSessionExit(cb);
    return () => {
      offOffice();
      offOrchestrator();
    };
  }
}
