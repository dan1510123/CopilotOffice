// Orchestrator act-on-agent helpers (spec 017 — US4/US5/US6/US8, renderer).
//
// Back the gated `answer_agent` / `send_prompt_to_agent` / `stop_agent` /
// `restart_agent` / `set_agent_teams_presence` tools via the matching
// `orchestrator:*:request/respond` round-trips. Reached ONLY after the always-on
// permission gate approves (the manager never emits the request on denial).
//
// Each helper re-validates the office-qualified target at execution time (FR-019),
// refuses the synthetic orchestrator identity (FR-020), reuses the sanctioned
// per-agent session operations (warmAgentSession / terminalWrite / terminalKill /
// teamsRegister / teams:stop) via injected deps, and returns a typed ActOnResult.
// Reused ops preserve the agent-viewers.ts dual-key invariants (Principle III) —
// these helpers never touch activeAgentViewers directly.

import { officeManager } from './officeManager';
import { resolveStatusKey } from '../config/agentStatusPresentation';
import {
  ORCHESTRATOR_AGENT_ID,
  ORCHESTRATOR_OFFICE_ID,
  isOrchestratorKey,
} from '../../electron/orchestrator/orchestratorIdentity';
import type { ActOnResult } from '../../electron/orchestrator/types';

/** Injected side-effecting operations (reused per-agent session ops). */
export interface ActOnDeps {
  /** Ensure the target has a live session (warmAgentSession); resolves true on success. */
  ensureOnline: (officeId: string, agentId: string) => Promise<boolean>;
  /** Deliver a follow-up prompt to the target's session (submit-prompt, targeted by agentId). */
  deliverText: (officeId: string, agentId: string, text: string) => Promise<boolean>;
  /**
   * Answer a pending `ask_user` via the sanctioned submit-answer channel (resolves
   * the SDK/ui-server interaction or keystroke-injects for node-pty). Distinct from
   * `deliverText`: raw typing would only select a choice prompt's highlighted option.
   */
  submitAnswer: (officeId: string, agentId: string, answer: string) => Promise<boolean>;
  /** Stop / take an agent offline (terminalKill). */
  stopSession: (officeId: string, agentId: string) => Promise<boolean>;
  /** Restart an agent's session (stop + warm). */
  restartSession: (officeId: string, agentId: string) => Promise<boolean>;
  /** True when the Teams feature flag is enabled (teams:getSettings). */
  teamsEnabled: () => Promise<boolean>;
  /** Bring the target online in Teams (teamsRegister). */
  teamsRegister: (
    officeId: string,
    agentId: string,
  ) => Promise<{ success: boolean; threadWebUrl?: string; error?: string }>;
  /** Take the target offline in Teams (teams:stop; posts the closing notice). */
  teamsStop: (officeId: string, agentId: string) => Promise<boolean>;
  /** Set the target's session title (setSessionMeta); resolves true on success. */
  setTitle: (officeId: string, agentId: string, title: string) => Promise<boolean>;
}

interface ResolvedTarget {
  officeId: string;
  online: boolean;
  waiting: boolean;
}

/** Reject the synthetic orchestrator identity as an act-on target (FR-020). */
function isOrchestratorTarget(agentId: string, officeId?: string): boolean {
  if (agentId === ORCHESTRATOR_AGENT_ID) return true;
  if (officeId && isOrchestratorKey(officeId, agentId)) return true;
  if (officeId === ORCHESTRATOR_OFFICE_ID) return true;
  return false;
}

/**
 * Resolve the office-qualified target at execution time. Disambiguation order:
 * the provided office, else the current office, else any office with a status
 * entry. Returns null for unknown / orchestrator-identity targets.
 */
function resolveTarget(agentId: string, officeId?: string): ResolvedTarget | null {
  const target = (agentId ?? '').trim();
  if (!target || isOrchestratorTarget(target, officeId)) return null;

  const candidateOffices: string[] = [];
  if (officeId) candidateOffices.push(officeId);
  const current = officeManager.currentOfficeId;
  if (current && current !== officeId) candidateOffices.push(current);
  for (const config of officeManager.getAllOffices()) {
    if (!candidateOffices.includes(config.id)) candidateOffices.push(config.id);
  }

  for (const oid of candidateOffices) {
    const status = officeManager.getAgentStatus(oid, target);
    if (!status) continue;
    return {
      officeId: oid,
      online: status.state === 'active',
      waiting: resolveStatusKey(status) === 'waiting',
    };
  }
  return null;
}

function invalidTarget(agentId: string, officeId?: string): ActOnResult {
  return {
    agentId,
    officeId: officeId ?? '',
    outcome: 'invalid-target',
    message: `"${agentId}" is not a valid agent to act on${
      officeId ? ` in office "${officeId}"` : ''
    }.`,
  };
}

// ── US4: answer a waiting agent ──────────────────────────────────────────────

export async function answerAgent(
  args: { agentId: string; officeId?: string; answer: string },
  deps: ActOnDeps,
): Promise<ActOnResult> {
  const resolved = resolveTarget(args.agentId, args.officeId);
  if (!resolved) return invalidTarget(args.agentId, args.officeId);
  const { officeId } = resolved;
  if (!resolved.online) {
    return { agentId: args.agentId, officeId, outcome: 'not-online', message: `${args.agentId} is not online.` };
  }
  if (!resolved.waiting) {
    return {
      agentId: args.agentId,
      officeId,
      outcome: 'not-waiting',
      message: `${args.agentId} is not waiting for input.`,
    };
  }
  try {
    await deps.ensureOnline(officeId, args.agentId);
    const ok = await deps.submitAnswer(officeId, args.agentId, args.answer);
    return ok
      ? { agentId: args.agentId, officeId, outcome: 'delivered', message: `Answer delivered to ${args.agentId}.` }
      : { agentId: args.agentId, officeId, outcome: 'failed', message: `Failed to deliver the answer to ${args.agentId}.` };
  } catch (err) {
    return failed(args.agentId, officeId, err);
  }
}

// ── US5: send a follow-up prompt to an online agent ──────────────────────────

export async function sendPromptToAgent(
  args: { agentId: string; officeId?: string; prompt: string },
  deps: ActOnDeps,
): Promise<ActOnResult> {
  const resolved = resolveTarget(args.agentId, args.officeId);
  if (!resolved) return invalidTarget(args.agentId, args.officeId);
  const { officeId } = resolved;
  if (!resolved.online) {
    return {
      agentId: args.agentId,
      officeId,
      outcome: 'not-online',
      message: `${args.agentId} is not online — bring it online first, then try again.`,
    };
  }
  try {
    const ok = await deps.deliverText(officeId, args.agentId, args.prompt);
    return ok
      ? { agentId: args.agentId, officeId, outcome: 'sent', message: `Prompt sent to ${args.agentId}.` }
      : { agentId: args.agentId, officeId, outcome: 'failed', message: `Failed to send the prompt to ${args.agentId}.` };
  } catch (err) {
    return failed(args.agentId, officeId, err);
  }
}

// ── US6: stop / restart an agent ─────────────────────────────────────────────

export async function stopAgent(
  args: { agentId: string; officeId?: string },
  deps: ActOnDeps,
): Promise<ActOnResult> {
  const resolved = resolveTarget(args.agentId, args.officeId);
  if (!resolved) return invalidTarget(args.agentId, args.officeId);
  const { officeId } = resolved;
  if (!resolved.online) {
    return { agentId: args.agentId, officeId, outcome: 'not-online', message: `${args.agentId} is not online.` };
  }
  try {
    const ok = await deps.stopSession(officeId, args.agentId);
    return ok
      ? { agentId: args.agentId, officeId, outcome: 'stopped', message: `${args.agentId} has been taken offline.` }
      : { agentId: args.agentId, officeId, outcome: 'failed', message: `Failed to stop ${args.agentId}.` };
  } catch (err) {
    return failed(args.agentId, officeId, err);
  }
}

export async function restartAgent(
  args: { agentId: string; officeId?: string },
  deps: ActOnDeps,
): Promise<ActOnResult> {
  const resolved = resolveTarget(args.agentId, args.officeId);
  if (!resolved) return invalidTarget(args.agentId, args.officeId);
  const { officeId } = resolved;
  if (!resolved.online) {
    return { agentId: args.agentId, officeId, outcome: 'not-online', message: `${args.agentId} is not online.` };
  }
  try {
    const ok = await deps.restartSession(officeId, args.agentId);
    return ok
      ? { agentId: args.agentId, officeId, outcome: 'restarted', message: `${args.agentId} has been restarted and is ready.` }
      : { agentId: args.agentId, officeId, outcome: 'failed', message: `Failed to restart ${args.agentId}.` };
  } catch (err) {
    return failed(args.agentId, officeId, err);
  }
}

// ── US8: set an agent's Teams presence ───────────────────────────────────────

export async function setAgentTeamsPresence(
  args: { agentId: string; officeId?: string; online: boolean },
  deps: ActOnDeps,
): Promise<ActOnResult> {
  const resolved = resolveTarget(args.agentId, args.officeId);
  if (!resolved) return invalidTarget(args.agentId, args.officeId);
  const { officeId } = resolved;
  try {
    const enabled = await deps.teamsEnabled();
    if (!enabled) {
      return {
        agentId: args.agentId,
        officeId,
        outcome: 'unavailable',
        message: 'Teams is disabled or not configured, so agents cannot be brought online in Teams.',
      };
    }
    if (args.online) {
      // Auto-warm: TeamsService.registerAgent requires a live session (it fails
      // with "Open its terminal first" otherwise). If the target has no session,
      // bring it up first so a single approval covers "bring up + go online".
      if (!resolved.online) {
        const up = await deps.ensureOnline(officeId, args.agentId);
        if (!up) {
          return {
            agentId: args.agentId,
            officeId,
            outcome: 'failed',
            message: `Could not bring ${args.agentId} up before Teams registration.`,
          };
        }
      }
      const res = await deps.teamsRegister(officeId, args.agentId);
      if (res.success) {
        return {
          agentId: args.agentId,
          officeId,
          outcome: 'online-in-teams',
          message: `${args.agentId} is now online in Teams.`,
          ...(res.threadWebUrl ? { threadWebUrl: res.threadWebUrl } : {}),
        };
      }
      return {
        agentId: args.agentId,
        officeId,
        outcome: 'failed',
        message: `Failed to bring ${args.agentId} online in Teams${res.error ? `: ${res.error}` : '.'}`,
      };
    }
    const ok = await deps.teamsStop(officeId, args.agentId);
    return ok
      ? {
          agentId: args.agentId,
          officeId,
          outcome: 'taken-offline',
          message: `${args.agentId} has been taken offline in Teams.`,
        }
      : {
          agentId: args.agentId,
          officeId,
          outcome: 'failed',
          message: `Failed to take ${args.agentId} offline in Teams.`,
        };
  } catch (err) {
    return failed(args.agentId, officeId, err);
  }
}

// ── set an agent's session title ─────────────────────────────────────────────

export async function setAgentTitle(
  args: { agentId: string; officeId?: string; title: string },
  deps: ActOnDeps,
): Promise<ActOnResult> {
  const resolved = resolveTarget(args.agentId, args.officeId);
  if (!resolved) return invalidTarget(args.agentId, args.officeId);
  const { officeId } = resolved;
  const title = (args.title ?? '').trim();
  if (!title) {
    return {
      agentId: args.agentId,
      officeId,
      outcome: 'invalid-target',
      message: 'A non-empty title is required.',
    };
  }
  try {
    const ok = await deps.setTitle(officeId, args.agentId, title);
    return ok
      ? { agentId: args.agentId, officeId, outcome: 'title-set', message: `${args.agentId} title set to "${title}".` }
      : { agentId: args.agentId, officeId, outcome: 'failed', message: `Failed to set the title for ${args.agentId}.` };
  } catch (err) {
    return failed(args.agentId, officeId, err);
  }
}

function failed(agentId: string, officeId: string, err: unknown): ActOnResult {
  return {
    agentId,
    officeId,
    outcome: 'failed',
    message: `Error acting on ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
  };
}
