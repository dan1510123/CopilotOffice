// OrchestratorSessionGateway (spec 016 — Workstream B, B2).
//
// A SessionGateway implementation backed by the main-process OrchestratorSessionManager
// instead of the terminal server. Lets the Teams service bring the Office Orchestrator
// "online" using the same register/route/reply machinery as office agents (spec 011),
// keyed by the synthetic `(__orchestrator__, orchestrator)` identity.
//
// Differences from RelaySessionGateway:
//   - No PTY/office session — session identity comes from the manager's lifecycle.
//   - The orchestrator registers NO ask_user handler, so `submitAnswer` is unsupported.
//   - Its always-on approval gate is relayed to the thread as a `permission-request`
//     AgentEvent and resolved via `respondPermission` → `manager.respondToPermission`.

import type { OrchestratorSessionManager } from '../orchestrator/orchestratorSessionManager';
import { describeOrchestratorPermission } from '../orchestrator/permissionSummary';
import { AGENTS, RESERVE_AGENTS } from '../../src/config/agents';
import {
  ORCHESTRATOR_AGENT_ID,
  ORCHESTRATOR_DISPLAY_NAME,
  isOrchestratorKey,
} from '../orchestrator/orchestratorIdentity';
import type { AgentEvent, SessionGateway } from './sessionGateway';
import { extractMessageContent } from './sessionGateway';

/**
 * Resolve an agent's friendly display name (e.g. "Alice") from the static roster
 * so relayed approval prompts read naturally instead of showing the raw agentId.
 * Mirrors the renderer's OrchestratorPanel resolver; per-office custom names are
 * not available in the main process, so seated + reserve agents are covered.
 */
function resolveAgentDisplayName(agentId?: string): string | undefined {
  if (!agentId) return undefined;
  const seated = AGENTS.find((a) => a.id === agentId);
  if (seated) return seated.name;
  for (const reserve of Object.values(RESERVE_AGENTS)) {
    if (reserve.id === agentId) return reserve.name;
  }
  return undefined;
}

export class OrchestratorSessionGateway implements SessionGateway {
  constructor(private readonly manager: OrchestratorSessionManager) {}
  async getSessionId(officeId: string, agentId: string): Promise<string | null> {
    if (!isOrchestratorKey(officeId, agentId)) return null;
    return this.manager.getInfo()?.sessionId ?? null;
  }

  async getSessionMeta(officeId: string, agentId: string): Promise<{ title?: string } | null> {
    if (!isOrchestratorKey(officeId, agentId)) return null;
    return { title: ORCHESTRATOR_DISPLAY_NAME };
  }

  async isAgentReady(officeId: string, agentId: string): Promise<boolean> {
    if (!isOrchestratorKey(officeId, agentId)) return false;
    return this.manager.getInfo()?.lifecycle === 'ready';
  }

  async submitPrompt(officeId: string, agentId: string, prompt: string): Promise<void> {
    if (!isOrchestratorKey(officeId, agentId)) {
      throw new Error(`OrchestratorSessionGateway cannot submit to ${officeId}:${agentId}`);
    }
    // spec 017 (FR-002): tag Teams-driven turns with origin 'teams' so they (and the
    // orchestrator's response) flow through the manager tap into the transcript marked
    // as Teams-origin.
    await this.manager.submitInput(prompt, 'teams');
  }

  async submitAnswer(): Promise<void> {
    // The orchestrator session registers no ask_user handler (it only gates tool
    // calls via onPermissionRequest). There is nothing to answer here; a thread
    // reply to a gated action is routed to respondPermission, not submitAnswer.
    throw new Error('Orchestrator session does not support ask_user answers');
  }

  setForwarding(): void {
    // No-op: the manager streams its whole session to any tap listener already;
    // there is no per-viewer forwarding toggle for the orchestrator.
  }

  async respondPermission(
    officeId: string,
    agentId: string,
    toolCallId: string,
    decision: 'approve' | 'deny',
  ): Promise<void> {
    if (!isOrchestratorKey(officeId, agentId)) return;
    this.manager.respondToPermission({ toolCallId, decision });
  }

  onAgentEvent(cb: (e: AgentEvent) => void): () => void {
    const offEvent = this.manager.onSessionEvent((event) => {
      switch (event.type) {
        case 'assistant.message': {
          const content = extractMessageContent(event);
          if (content) cb({ agentId: ORCHESTRATOR_AGENT_ID, kind: 'message', content });
          break;
        }
        case 'assistant.turn_start':
          cb({ agentId: ORCHESTRATOR_AGENT_ID, kind: 'turn-start' });
          break;
        case 'assistant.turn_end':
          cb({ agentId: ORCHESTRATOR_AGENT_ID, kind: 'turn-end' });
          break;
        case 'tool.execution_start': {
          const toolName = String((event.data as { toolName?: string })?.toolName ?? '');
          cb({ agentId: ORCHESTRATOR_AGENT_ID, kind: 'tool-start', toolName });
          break;
        }
        default:
          break;
      }
    });

    const offPermission = this.manager.onPermissionRequested((p) => {
      const reason = p.reason ? ` — ${p.reason}` : '';
      const summary = describeOrchestratorPermission(
        p.toolName,
        { agentId: p.agentId, online: p.online, title: p.title },
        p.agentName ?? resolveAgentDisplayName(p.agentId),
      );
      cb({
        agentId: ORCHESTRATOR_AGENT_ID,
        kind: 'permission-request',
        permission: {
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          summary: `${summary}${reason}`,
        },
      });
    });

    return () => {
      offEvent();
      offPermission();
    };
  }

  onSessionExit(cb: (agentId: string) => void): () => void {
    return this.manager.onSessionExit(() => cb(ORCHESTRATOR_AGENT_ID));
  }
}
