// Teams service orchestrator (T016 + US1–US5 + lifecycle).
//
// Owns: the online-agent bindings, the receive transport, prompt dispatch, reply posting,
// reconnect/teardown/GC lifecycle. Injectable deps make it unit-testable without live
// network/auth/terminal.

import type { TokenProvider } from './auth';
import type { GraphSender } from './graphClient';
import type { MessageSource } from './chatsvcClient';
import type { SessionGateway, AgentEvent } from './sessionGateway';
import type { TeamsOnlineStore } from './onlineAgentsStore';
import { gcStale } from './onlineAgentsStore';
import { DispatchQueue, type DispatchItem } from './dispatchQueue';
import { MessageFilter } from './messageFilter';
import { normalizeHandle, assignHandle } from './handleRegistry';
import { parseChannelLink } from './channelLink';
import { resolveChannel, activeChannelSet } from './channelResolver';
import { chunkReply } from './chunk';
import { escapeHtml } from './htmlText';
import { extractImageMarkers, loadHostedImages, hostedImagesHtml } from './imageMarker';
import type { HostedImage } from './imageMarker';
import { extractFileMarkers, loadAttachmentFiles } from './fileMarker';
import type { AttachmentFile } from './fileMarker';
import { pickAckQuip } from './ackQuips';
import { tlog, twarn } from './log';
import { isAzLoginError } from './auth';
import type {
  TeamsSettings,
  OnlineAgentBinding,
  KnownThread,
  InboundMessage,
  OnlineAgentStatus,
  PendingQuestion,
  AskUserOption,
} from './types';

export interface TeamsToast {
  level: 'info' | 'warn' | 'error';
  message: string;
  /** Optional display duration (ms). Omitted ⇒ renderer default. */
  durationMs?: number;
}

export interface AgentInfo {
  displayName: string;
  workingDir: string;
}

/** Context the renderer supplies when bringing an agent online. */
export interface RegisterContext {
  officeId: string;
  agentId: string;
  displayName: string;
  workingDir: string;
  /** Per-office override channel deep-link (office.teamsChannelUrl); may be empty. */
  officeChannelUrl?: string;
  /**
   * Per-office relay @mention override (office.teamsMentionType/teamsMentionValue). When
   * type is 'none' or value is empty, the global operator-configured mention applies.
   */
  officeMentionType?: 'user' | 'tag' | 'none';
  officeMentionValue?: string;
}

export interface TeamsServiceDeps {
  store: TeamsOnlineStore;
  tokens: TokenProvider;
  graph: GraphSender;
  /**
   * Optional distinct-identity notifier used ONLY for the end-of-response completion
   * ping (the relay/Dump-channel sender). Reply content always posts via {@link graph}
   * (the signed-in user); this sends one message per response so a Power Automate flow
   * re-posts it under a distinct bot identity with an @mention. Omit to disable.
   */
  notifier?: GraphSender;
  /** Whether the completion notification is active (relay Dump channel configured + flag on). */
  isNotifyActive?: () => boolean;
  source: MessageSource;
  gateway: SessionGateway;
  /** Current global Teams settings. */
  getSettings: () => TeamsSettings;
  /** Emit a per-agent status change to the renderer. */
  emitStatus: (s: OnlineAgentStatus) => void;
  /** Emit a toast to the renderer. */
  emitToast: (t: TeamsToast) => void;
  now?: () => number;
  /**
   * Quiet period (ms) after a turn-end before a dispatch is closed out (forwarding
   * stopped, queue released). Bridges the gap between a tool-using response's turns
   * so no later turn is missed. Defaults to {@link TURN_SETTLE_MS}; tests may lower it.
   */
  turnSettleMs?: number;
}

interface PendingTurn {
  officeId: string;
  agentId: string;
  binding: OnlineAgentBinding;
  chunks: string[];
  resolve: () => void;
  startedAt: number;
  lastCheckIn: number;
  /**
   * Text of the most recent non-empty turn flushed during this dispatch. Drives the
   * end-of-response completion notification's preview. Undefined ⇒ the agent produced
   * no text this dispatch, so no completion ping is sent.
   */
  lastReplyText?: string;
  /**
   * Debounce timer armed on each `turn-end` and cancelled if the agent resumes
   * (new message/turn/tool) before it fires. Null when not waiting to settle.
   */
  settleTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Accumulator for a locally-driven (non-Teams) turn on an online agent. Mirrors the
 * subset of {@link PendingTurn} the ambient stream needs. No `resolve` (there is no
 * dispatch-queue promise to settle) — a local turn just streams its text into the
 * thread and, once idle, fires the same end-of-response completion notification as a
 * Teams-driven dispatch.
 */
interface AmbientTurn {
  officeId: string;
  agentId: string;
  binding: OnlineAgentBinding;
  chunks: string[];
  startedAt: number;
  /**
   * Text of the most recent non-empty turn flushed during this local response. Drives
   * the end-of-response completion notification's empty-turn skip. Undefined ⇒ the agent
   * produced no text this response, so no completion ping is sent.
   */
  lastReplyText?: string;
  settleTimer: ReturnType<typeof setTimeout> | null;
}

const RECONCILE_MS = 15_000;

/**
 * A single Teams-driven prompt can span MULTIPLE copilot turns: an agent that uses
 * a tool emits `message → tool → turn_end` and then resumes in a fresh
 * `turn_start → message → turn_end`. Finalizing on the first `turn_end` would post
 * only the pre-tool text and silently drop the real answer (and any office-image
 * sentinel it carries). Instead we debounce finalization by this quiet period on
 * each `turn_end`, cancelling if the agent produces more output first, so the whole
 * multi-turn response is accumulated and posted once the agent truly goes idle.
 */
const TURN_SETTLE_MS = 2500;

/** Long-lived duration (ms) for the actionable "run az login" credential toast. */
const AUTH_TOAST_DURATION_MS = 60_000;

/** While the credential stays broken, re-emit the az-login toast at most this often. */
const AUTH_TOAST_REPEAT_MS = 5 * 60 * 1000;

export class TeamsService {
  private bindings: OnlineAgentBinding[] = [];
  private knownThreads: KnownThread[] = [];
  private readonly filter: MessageFilter;
  private readonly queue: DispatchQueue;
  private readonly pending = new Map<string, PendingTurn>(); // key = agentId
  /**
   * Ambient (locally-driven) turn accumulators, keyed by agentId. Populated only
   * when an online agent produces output that was NOT triggered by a Teams dispatch
   * (i.e. someone drove the agent in the app's own terminal). Streams those turns
   * into the bound thread so the channel mirrors everything the online agent does,
   * not just replies to Teams-originated requests. Disjoint from {@link pending}:
   * an agent with an in-flight Teams dispatch never uses this map.
   */
  private readonly ambient = new Map<string, AmbientTurn>(); // key = agentId
  /**
   * Pending `ask_user` questions awaiting an answer, keyed by agentId (spec 015).
   * At most one per online agent — a new `ask-user` supersedes the prior record.
   * Transient, in-memory, main-process only (never persisted). Distinct from
   * {@link pending} (in-flight Teams dispatches) and {@link ambient}.
   */
  private readonly pendingQuestions = new Map<string, PendingQuestion>(); // key = agentId
  /**
   * Message ids of every message the app has posted (thread roots + replies).
   * Primary self-loop guard: an inbound message whose id is here is our own echo
   * and is dropped before all other processing. Deterministic — does not depend on
   * content markers surviving Teams' sanitizer. Capped FIFO to bound memory.
   */
  private readonly postedMessageIds = new Set<string>();
  private readonly postedOrder: string[] = [];
  private static readonly MAX_POSTED_IDS = 2000;
  private unsubEvent: (() => void) | null = null;
  private unsubExit: (() => void) | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private readonly now: () => number;
  private readonly settleMs: number;
  /** True once a hard token failure has been surfaced and not yet recovered. */
  private authBroken = false;
  /** Timestamp of the last az-login toast (throttle guard). 0 ⇒ never shown. */
  private lastAuthToastAt = 0;
  /** Last observed receive-transport health, to emit connect/reconnect notices once per transition. */
  private lastTransportHealth: 'connected' | 'disconnected' | 'error' | 'unknown' = 'unknown';

  constructor(private readonly deps: TeamsServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.settleMs = deps.turnSettleMs ?? TURN_SETTLE_MS;
    this.filter = new MessageFilter(this.now);
    this.queue = new DispatchQueue((item) => this.processDispatch(item));
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    tlog('Service starting…');

    const state = await this.deps.store.load();
    // 30-day GC (FR-024a).
    const { kept, removed } = gcStale(state.bindings, this.now());
    this.bindings = kept.map((b) => ({ ...b, online: false })); // reconnect is event-driven
    this.knownThreads = state.knownThreads;
    tlog(`Loaded ${this.bindings.length} persisted binding(s), ${this.knownThreads.length} known thread(s).`);
    if (removed.length > 0) {
      await this.persist();
      tlog(`GC removed ${removed.length} stale binding(s) (>30 days).`);
      this.deps.emitToast({
        level: 'info',
        message: `Teams: cleaned up ${removed.length} stale agent binding(s) (>30 days).`,
      });
    }

    this.unsubEvent = this.deps.gateway.onAgentEvent((e) => this.onAgentEvent(e));
    this.unsubExit = this.deps.gateway.onSessionExit((agentId) => this.onSessionExit(agentId));

    await this.deps.source.start((m) => {
      void this.handleInbound(m);
    });
    tlog(`Receive transport started (health=${this.deps.source.health}).`);

    this.reconcileTimer = setInterval(() => void this.reconcile(), RECONCILE_MS);
    // Attempt immediate reconnect for persisted bindings.
    void this.reconcile();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
    this.unsubEvent?.();
    this.unsubExit?.();
    this.unsubEvent = this.unsubExit = null;
    // Clear any in-flight ambient turn timers so nothing fires after stop.
    for (const rec of this.ambient.values()) {
      if (rec.settleTimer) clearTimeout(rec.settleTimer);
    }
    this.ambient.clear();
    // Forwarding is enabled for an agent's whole online lifetime (register/reconnect),
    // so stopping the service — e.g. when Teams remote is disabled in settings, which
    // calls stop() WITHOUT goOffline — must disable it for every online binding, else
    // the terminal server keeps mirroring events for agents that are no longer served.
    for (const b of this.bindings) {
      if (b.online) this.deps.gateway.setForwarding(b.officeId, b.agentId, false);
    }
    // Drop all queued work BEFORE resolving in-flight dispatches: resolving a dispatch
    // promise lets DispatchQueue.drain() advance, so a non-empty queue would otherwise
    // start a NEW dispatch mid-shutdown (re-enabling forwarding + submitting a prompt).
    // With queues cleared, the drain loop simply finds nothing and exits. (started is
    // already false above, so processDispatch also self-guards as defense in depth.)
    for (const [agentId, rec] of this.pending) {
      this.queue.clear(rec.officeId, agentId);
      this.cancelSettle(rec);
      rec.resolve();
      this.pending.delete(agentId);
    }
    await this.deps.source.stop();
    tlog('Service stopped.');
  }

  // ── Public API (invoked from IPC) ────────────────────────────

  getStatuses(): OnlineAgentStatus[] {
    return this.bindings.map((b) => this.toStatus(b));
  }

  getStatus(officeId: string, agentId: string): OnlineAgentStatus | null {
    const b = this.findBinding(officeId, agentId);
    return b ? this.toStatus(b) : null;
  }

  /** Bring an agent online: resolve channel, create thread, bind, start listening. */
  async register(
    ctx: RegisterContext,
  ): Promise<{ success: boolean; handle?: string; threadWebUrl?: string; error?: string }> {
    const { officeId, agentId } = ctx;
    const settings = this.deps.getSettings();
    if (!settings.enabled) return { success: false, error: 'Teams remote is disabled in settings.' };

    const channelUrl = resolveChannel({ teamsChannelUrl: ctx.officeChannelUrl }, settings);
    const coords = parseChannelLink(channelUrl);
    if (!coords) {
      return { success: false, error: 'no-channel' };
    }
    tlog(`Register requested: ${ctx.displayName} (${officeId}:${agentId}) → channel ${coords.channelId}`);

    const sessionId = await this.deps.gateway.getSessionId(officeId, agentId);
    if (!sessionId) {
      return { success: false, error: 'No active session for this agent. Open its terminal first.' };
    }

    const displayName = ctx.displayName || agentId;
    const workingDir = ctx.workingDir || '';

    // Already online? Return existing binding.
    const existing = this.findBinding(officeId, agentId);
    if (existing && existing.online) {
      return { success: true, handle: existing.handle, threadWebUrl: existing.threadWebUrl };
    }

    const meta = await this.deps.gateway.getSessionMeta(officeId, agentId);
    const sessionTitle = meta?.title?.trim() || '';

    const base = normalizeHandle(displayName);
    let handle: string;
    try {
      handle = assignHandle(base, this.onlineHandles());
    } catch {
      return { success: false, error: 'Could not derive a valid handle from the agent name.' };
    }

    const subject = sessionTitle ? `${displayName}: ${sessionTitle}` : `${displayName}: ${handle}`;
    const introHtml = this.buildIntro({ displayName, workingDir }, handle, sessionTitle);

    let thread: { threadRootId: string; webUrl: string };
    try {
      thread = await this.deps.graph.createThread({
        teamId: coords.teamId,
        channelId: coords.channelId,
        subject,
        html: introHtml,
      });
    } catch (e) {
      return { success: false, error: `Failed to create Teams thread: ${(e as Error).message}` };
    }
    tlog(`Thread created (root=${thread.threadRootId}) for @${handle}.`);
    // Record our own post id so its Trouter echo is dropped (self-loop guard, D9).
    this.rememberPosted(thread.threadRootId);

    const binding: OnlineAgentBinding = {
      agentId,
      officeId,
      sessionId,
      handle,
      displayName,
      workingDir,
      sessionTitle,
      teamId: coords.teamId,
      channelId: coords.channelId,
      tenantId: coords.tenantId,
      mentionType: ctx.officeMentionType,
      mentionValue: ctx.officeMentionValue,
      threadRootId: thread.threadRootId,
      threadWebUrl: thread.webUrl,
      online: true,
      lastConnected: this.now(),
    };
    // Replace any stale binding for this agent.
    this.bindings = this.bindings.filter((b) => !(b.officeId === officeId && b.agentId === agentId));
    this.bindings.push(binding);
    this.rememberThread(thread.threadRootId);
    await this.persist();
    this.updateSourceChannels();
    // Keep event mirroring on for the WHOLE time the agent is online (not just during
    // a Teams-driven turn) so locally-driven turns are captured and streamed to the
    // thread too. Disabled again in goOffline.
    this.deps.gateway.setForwarding(officeId, agentId, true);
    this.deps.emitStatus(this.toStatus(binding));
    tlog(`ONLINE: @${handle} (${officeId}:${agentId}). Active channels: ${activeChannelSet(this.bindings).size}.`);

    return { success: true, handle, threadWebUrl: thread.webUrl };
  }

  /** Take an agent offline (connection only; session untouched). */
  async goOffline(officeId: string, agentId: string, postNotice = true): Promise<{ success: boolean }> {
    const b = this.findBinding(officeId, agentId);
    if (!b) return { success: true };
    tlog(`OFFLINE: @${b.handle} (${officeId}:${agentId}).`);
    // spec 015 (FR-009): an outstanding ask_user question is no longer answerable once the
    // agent leaves. Clear the record and notice the thread (before the generic offline notice).
    const abandoned = this.pendingQuestions.get(agentId);
    if (abandoned) {
      this.pendingQuestions.delete(agentId);
      if (postNotice && b.online && b.threadRootId) {
        await this.safeReply(b, `${this.agentLabel(b)} ⚠️ This question is no longer answerable (agent offline).`);
      }
    }
    if (postNotice && b.online && b.threadRootId) {
      await this.safeReply(b, '🔌 This agent has gone offline. Replies here will not be answered.');
    }
    this.queue.clear(officeId, agentId);
    // Stop event mirroring now that the agent is leaving (enabled for the whole online
    // lifetime in register/reconnect). Also discard any in-flight ambient turn.
    this.deps.gateway.setForwarding(officeId, agentId, false);
    const amb = this.ambient.get(agentId);
    if (amb) {
      if (amb.settleTimer) clearTimeout(amb.settleTimer);
      this.ambient.delete(agentId);
    }
    // If a turn is in flight, resolve its dispatch promise so the per-agent queue
    // can't wedge (finalizeDispatch would otherwise never run).
    const inFlight = this.pending.get(agentId);
    if (inFlight) {
      this.cancelSettle(inFlight);
      this.pending.delete(agentId);
      inFlight.resolve();
    }
    this.bindings = this.bindings.filter((x) => !(x.officeId === officeId && x.agentId === agentId));
    await this.persist();
    this.updateSourceChannels();
    this.deps.emitStatus({ agentId, officeId, online: false, handle: b.handle, health: 'disconnected', workingDir: b.workingDir });
    return { success: true };
  }

  // ── Inbound handling ─────────────────────────────────────────

  async handleInbound(msg: InboundMessage): Promise<void> {
    // Primary self-loop guard (research D9): drop the Trouter echo of any message
    // this app posted, keyed on message id. Deterministic — does not rely on the
    // content marker surviving Teams' sanitizer.
    if (msg.messageId && this.postedMessageIds.has(msg.messageId)) {
      return;
    }
    const result = this.filter.evaluate(msg, this.bindings, this.knownThreads);
    if (result.action === 'ignore') {
      if (result.reason && result.reason !== 'duplicate' && result.reason !== 'root-message' && result.reason !== 'inactive-channel') {
        tlog(`Ignored inbound (${result.reason}) from "${msg.senderName}".`);
      }
      return;
    }

    if (result.action === 'orphaned-notice') {
      tlog(`Orphaned thread ${msg.threadRootId} messaged by "${msg.senderName}" — posting inactive notice.`);
      await this.postOrphanedNotice(msg);
      return;
    }

    // dispatch
    const binding = result.binding;
    if (!binding) return;

    const content = msg.content.trim();
    if (content === '/stop') {
      tlog(`/stop received in @${binding.handle}'s thread — taking offline.`);
      await this.goOffline(binding.officeId, binding.agentId, true);
      return;
    }

    // spec 015 (FR-012): if this agent has a pending `ask_user` question, a thread reply is
    // an ANSWER, not a new prompt. Route it to the resolver instead of the dispatch queue.
    // A record that is already resolved (near-simultaneous second reply, or the brief window
    // before the record clears) drops the reply as a no-op (single-resolution — FR-007).
    const pendingQ = this.pendingQuestions.get(binding.agentId);
    if (pendingQ) {
      if (!pendingQ.resolved) {
        await this.resolveAnswer(pendingQ, msg.content);
      }
      return;
    }

    tlog(`Dispatch: "${msg.senderName}" → @${binding.handle} (queued=${this.queue.pending(binding.officeId, binding.agentId)}): ${truncate(msg.content, 80)}`);
    this.queue.enqueue({
      officeId: binding.officeId,
      agentId: binding.agentId,
      sessionId: binding.sessionId,
      threadRootId: binding.threadRootId,
      prompt: msg.content,
      senderName: msg.senderName,
    });

    // Immediately acknowledge receipt so the sender knows the message landed, even
    // if a prior turn is still draining. Routed through safeReply so its own Teams
    // echo is recorded in postedMessageIds and never dispatched back (self-loop guard).
    if (this.deps.getSettings().ackEnabled) {
      void this.safeReply(binding, `${this.agentLabel(binding)} ⌛ ${escapeHtml(pickAckQuip())} <i>(message received)</i>`);
    }
  }

  private async postOrphanedNotice(msg: InboundMessage): Promise<void> {
    const known = this.knownThreads.find((t) => t.threadRootId === msg.threadRootId);
    if (!known || known.noticePosted) return;
    known.noticePosted = true;
    await this.persist();
    // Reply into the orphaned thread using any resolvable channel coords.
    const coords = this.coordsForChannel(msg.channelId);
    if (!coords) return;
    try {
      const posted = await this.deps.graph.replyToThread({
        teamId: coords.teamId,
        channelId: msg.channelId,
        threadRootId: msg.threadRootId,
        html: 'ℹ️ This thread is no longer active and will not receive responses.',
      });
      if (posted?.messageId) this.rememberPosted(posted.messageId);
    } catch (e) {
      twarn('Failed to post orphaned-thread notice:', (e as Error).message);
    }
  }

  // ── Dispatch + response capture ──────────────────────────────

  private processDispatch(item: DispatchItem): Promise<void> {
    return new Promise<void>((resolve) => {
      const binding = this.findBinding(item.officeId, item.agentId);
      if (!this.started || !binding || !binding.online) {
        resolve();
        return;
      }
      const record: PendingTurn = {
        officeId: item.officeId,
        agentId: item.agentId,
        binding,
        chunks: [],
        resolve,
        startedAt: this.now(),
        lastCheckIn: this.now(),
        settleTimer: null,
      };
      this.pending.set(item.agentId, record);

      // Forwarding is already enabled for the agent's whole online lifetime (register/
      // reconnect); re-assert it here defensively in case a set message was dropped.
      this.deps.gateway.setForwarding(item.officeId, item.agentId, true);

      const label = item.senderName ? `Teams · ${item.senderName}` : 'Teams';
      this.deps.gateway.submitPrompt(item.officeId, item.agentId, item.prompt, label).catch((e) => {
        twarn('submitPrompt failed:', (e as Error).message);
        this.pending.delete(item.agentId);
        resolve();
      });

      // Safety timeout so the queue never wedges if turn-end is missed.
      setTimeout(() => {
        if (this.pending.get(item.agentId) === record) {
          void this.finalizeDispatch(item.agentId);
        }
      }, 10 * 60 * 1000);
    });
  }

  private onAgentEvent(e: AgentEvent): void {
    // spec 015: an `ask-user` question is handled regardless of whether the current turn
    // was Teams- or locally-initiated (FR-013). Intercept before the dispatch/ambient
    // split so it never streams as ordinary output.
    if (e.kind === 'ask-user') {
      void this.onAskUserEvent(e);
      return;
    }
    // spec 015 hardening (h1): the SDK explicitly signalled that an ask_user interaction
    // resolved (user_input.completed). This is the PRECISE local-answer signal for the
    // SDK/ui-server path — clear only the matching pending record by requestId. If a Teams
    // answer already resolved+deleted it, there's no record → no false notice.
    if (e.kind === 'ask-user-complete') {
      this.maybeLocalResolveByRequestId(e.agentId, e.requestId ?? '');
      return;
    }
    // spec 015 §C: on the node-pty degraded path there is no user_input.completed event,
    // so fall back to the heuristic — any non-`ask-user` event for an agent with a
    // still-pending node-pty question (empty requestId) implies a local answer. SDK records
    // (non-empty requestId) are NOT resolved here; they wait for `ask-user-complete` above.
    this.maybeLocalResolve(e.agentId);

    const rec = this.pending.get(e.agentId);
    if (!rec) {
      // No in-flight Teams dispatch → this output was driven locally (app terminal).
      // Stream it into the thread if the agent is online.
      this.onAmbientEvent(e);
      return;
    }
    if (e.kind === 'message' && e.content) {
      // Agent produced more output — it hasn't gone idle. Cancel any pending
      // dispatch close-out and accumulate this chunk for the current turn.
      this.cancelSettle(rec);
      rec.chunks.push(e.content);
    } else if (e.kind === 'turn-start') {
      // A new turn began (e.g. resuming after a tool). Keep forwarding open.
      this.cancelSettle(rec);
    } else if (e.kind === 'user-message') {
      // The Teams prompt was accepted by the CLI. It already appears in the thread as
      // the sender's own message, so don't echo it back. (Only local user-messages,
      // handled in the ambient path, are mirrored.)
      return;
    } else if (e.kind === 'turn-end') {
      // Forward everything up to this turn-end NOW (as its own Teams message, like
      // long-session chunking) instead of holding it until the whole response ends.
      // Then arm the idle debounce: a tool-using response continues in a later turn,
      // so we keep pending + forwarding alive and only close out once the agent is
      // quiet. This guarantees no post-tool turn (e.g. one carrying an office-image
      // sentinel) is ever dropped.
      void this.flushTurn(rec);
      this.scheduleSettle(e.agentId, rec);
    } else if (e.kind === 'tool-start') {
      // A tool means more work is coming; don't let a stale close-out fire.
      this.cancelSettle(rec);
      void this.maybeCheckIn(rec, e.toolName);
    }
  }

  /** Clear the pending dispatch close-out timer, if armed. */
  private cancelSettle(rec: PendingTurn): void {
    if (rec.settleTimer) {
      clearTimeout(rec.settleTimer);
      rec.settleTimer = null;
    }
  }

  /** (Re)arm the debounce that closes out the dispatch once the agent goes idle. */
  private scheduleSettle(agentId: string, rec: PendingTurn): void {
    this.cancelSettle(rec);
    rec.settleTimer = setTimeout(() => {
      rec.settleTimer = null;
      void this.finalizeDispatch(agentId);
    }, this.settleMs);
  }

  /**
   * Post everything accumulated for the current turn as a Teams reply, then clear
   * the buffer. Does NOT stop forwarding or end the dispatch — a multi-turn
   * response keeps flushing per turn. No-op when the turn produced no text.
   */
  private async flushTurn(rec: PendingTurn): Promise<void> {
    const text = rec.chunks.join('\n\n').trim();
    rec.chunks = [];
    if (!text) return;
    const elapsed = Math.round((this.now() - rec.startedAt) / 1000);
    tlog(`Reply → @${rec.binding.handle} thread (${text.length} chars, ${elapsed}s): ${truncate(text, 80)}`);
    rec.lastReplyText = text;
    await this.postReply(rec.binding, text);
  }

  // ── Ambient (locally-driven) turn streaming ──────────────────

  /**
   * Handle a copilot event for an online agent that has NO in-flight Teams dispatch —
   * i.e. the agent was driven from the app's own terminal. Streams the resulting
   * request + reply into the bound thread so the channel mirrors everything the online
   * agent does. Silently ignores agents that are offline / not bound.
   */
  private onAmbientEvent(e: AgentEvent): void {
    const binding = this.bindings.find((b) => b.agentId === e.agentId && b.online);
    if (!binding) return;

    if (e.kind === 'user-message') {
      // Mirror the locally-typed request into the thread (clean prompt text only —
      // empty when the CLI omitted content, in which case we skip silently).
      const text = (e.content ?? '').trim();
      if (text) void this.postLocalRequest(binding, text);
      return;
    }

    if (e.kind === 'message' && e.content) {
      const rec = this.ensureAmbient(e.agentId, binding);
      this.cancelAmbientSettle(rec);
      rec.chunks.push(e.content);
    } else if (e.kind === 'turn-start') {
      const rec = this.ensureAmbient(e.agentId, binding);
      this.cancelAmbientSettle(rec);
    } else if (e.kind === 'turn-end') {
      const rec = this.ambient.get(e.agentId);
      if (!rec) return;
      // Flush this turn now (per-turn posting, like Teams dispatches), then debounce
      // close-out so a tool-using multi-turn response streams whole.
      void this.flushAmbient(rec);
      this.scheduleAmbientSettle(e.agentId, rec);
    }
    // tool-start is intentionally not mirrored for ambient turns (no check-ins) — a
    // local operator is already watching the terminal.
  }

  private ensureAmbient(agentId: string, binding: OnlineAgentBinding): AmbientTurn {
    let rec = this.ambient.get(agentId);
    if (!rec) {
      rec = {
        officeId: binding.officeId,
        agentId,
        binding,
        chunks: [],
        startedAt: this.now(),
        settleTimer: null,
      };
      this.ambient.set(agentId, rec);
    }
    return rec;
  }

  private cancelAmbientSettle(rec: AmbientTurn): void {
    if (rec.settleTimer) {
      clearTimeout(rec.settleTimer);
      rec.settleTimer = null;
    }
  }

  private scheduleAmbientSettle(agentId: string, rec: AmbientTurn): void {
    this.cancelAmbientSettle(rec);
    rec.settleTimer = setTimeout(() => {
      rec.settleTimer = null;
      void this.finalizeAmbient(agentId);
    }, this.settleMs);
  }

  /** Post the current ambient turn's accumulated text; clears the buffer. No-op when empty. */
  private async flushAmbient(rec: AmbientTurn): Promise<void> {
    const text = rec.chunks.join('\n\n').trim();
    rec.chunks = [];
    if (!text) return;
    const elapsed = Math.round((this.now() - rec.startedAt) / 1000);
    tlog(`Local reply → @${rec.binding.handle} thread (${text.length} chars, ${elapsed}s): ${truncate(text, 80)}`);
    rec.lastReplyText = text;
    await this.postReply(rec.binding, text);
  }

  /** Close out an ambient turn once the agent goes idle: flush residual text, drop record. */
  private async finalizeAmbient(agentId: string): Promise<void> {
    const rec = this.ambient.get(agentId);
    if (!rec) return;
    this.cancelAmbientSettle(rec);
    this.ambient.delete(agentId);
    // Flush anything that arrived without a trailing turn-end (defensive).
    await this.flushAmbient(rec);
    // Same distinct-identity completion ping as a Teams-driven dispatch, now that the
    // locally-driven agent is idle — so the operator gets notified in Teams even though
    // the reply content itself was posted under their own (un-notifying) identity.
    await this.maybeNotifyComplete(rec.binding, rec.lastReplyText);
  }

  /** Post a locally-typed user request into the thread, tagged so it's distinct from replies. */
  private async postLocalRequest(binding: OnlineAgentBinding, text: string): Promise<void> {
    const chunks = chunkReply(text, 3500);
    for (const chunk of chunks) {
      await this.safeReply(
        binding,
        `👤 <b>Human</b> 💬 <i>local request:</i><br>${escapeHtml(chunk).replace(/\n/g, '<br>')}`,
      );
    }
  }

  /**
   * Close out a dispatch once the agent has gone idle: flush any residual text,
   * drop the pending record, and resolve the dispatch promise so the per-agent
   * queue advances. Event mirroring stays on for the agent's whole online lifetime
   * (it's toggled in register/reconnect ↔ goOffline), so it is NOT disabled here.
   */
  private async finalizeDispatch(agentId: string): Promise<void> {
    const rec = this.pending.get(agentId);
    if (!rec) return;
    this.cancelSettle(rec);
    this.pending.delete(agentId);
    // Flush anything that arrived without a trailing turn-end (defensive).
    await this.flushTurn(rec);
    // One distinct-identity completion ping per response (via the relay/Dump channel),
    // now that the agent is idle — so the operator gets notified even though the reply
    // content itself was posted under their own identity.
    await this.maybeNotifyComplete(rec.binding, rec.lastReplyText);
    rec.resolve();
  }

  /**
   * Post a single end-of-response notification via the distinct-identity {@link
   * TeamsServiceDeps.notifier} (relay/Dump channel) so a Power Automate flow re-posts it
   * under the Flow-bot identity with an @mention. Active only when a notifier is wired and
   * {@link TeamsServiceDeps.isNotifyActive} is true. Skips silently when the response
   * produced no text. Never throws — a notification failure must not wedge the queue.
   * Shared by the Teams-dispatch ({@link finalizeDispatch}) and locally-driven ambient
   * ({@link finalizeAmbient}) idle-finalize paths.
   */
  private async maybeNotifyComplete(binding: OnlineAgentBinding, lastReplyText?: string): Promise<void> {
    const notifier = this.deps.notifier;
    if (!notifier || !(this.deps.isNotifyActive?.() ?? false)) return;
    if (!lastReplyText) return; // nothing was said this response → nothing to notify
    // The reply content itself already posted directly in the thread; this ping only
    // signals completion (a distinct-identity notification), so no preview is needed.
    // Include the session title when known so a notification for one of several agents
    // is self-identifying, e.g. "<b>Alice</b> has finished responding in "Bot in Teams"".
    const title = (binding.sessionTitle || '').trim();
    const where = title ? ` in “${escapeHtml(title)}”` : '';
    const html = `${this.agentLabel(binding)} has finished responding${where}`;
    try {
      const posted = await notifier.replyToThread({
        teamId: binding.teamId,
        channelId: binding.channelId,
        threadRootId: binding.threadRootId,
        html,
        // Per-office relay @mention override (frozen at register); empty ⇒ global mention.
        mentionOverride: { type: binding.mentionType ?? 'none', value: binding.mentionValue ?? '' },
      });
      if (posted?.messageId) this.rememberPosted(posted.messageId);
    } catch (e) {
      twarn('completion notify failed:', (e as Error).message);
    }
  }

  private async maybeCheckIn(rec: PendingTurn, toolName?: string): Promise<void> {
    const settings = this.deps.getSettings();
    if (!settings.checkInEnabled) return;
    const t = this.now();
    if (t - rec.startedAt < settings.checkInThresholdMs) return;
    if (t - rec.lastCheckIn < settings.checkInThrottleMs) return;
    rec.lastCheckIn = t;
    const label = toolName ? ` (running: ${escapeHtml(toolName)})` : '';
    await this.safeReply(rec.binding, `${this.agentLabel(rec.binding)} ⏳ Still working…${label}`);
  }

  /**
   * Bold agent-name prefix for every app-posted message. Since replies are posted
   * under the operator's own Teams identity, this makes automated agent output
   * visually distinct from messages the operator typed by hand.
   */
  // ── ask_user question / answer flow (spec 015) ───────────────

  /**
   * Handle an `ask-user` AgentEvent for an online agent (contract §A). Resolves the
   * binding, assigns stable selector labels (A, B, C…) to options in order, supersedes any
   * existing record for the agent, and posts one framed question message listing all
   * options (+ a freeform hint iff allowed). Ignored when the agent isn't online.
   */
  private async onAskUserEvent(e: AgentEvent): Promise<void> {
    if (!e.askUser) return;
    const binding = this.bindings.find((b) => b.agentId === e.agentId && b.online);
    if (!binding) return;

    const options: AskUserOption[] = e.askUser.options.map((o, i) => ({
      label: selectorLabel(i),
      text: o.text,
    }));
    const record: PendingQuestion = {
      agentId: e.agentId,
      officeId: binding.officeId,
      binding,
      toolId: e.askUser.toolId,
      requestId: e.askUser.requestId ?? '',
      question: e.askUser.question,
      options,
      freeform: e.askUser.freeform,
      resolved: false,
      createdAt: this.now(),
    };
    // Supersede any prior pending question for this agent (keyed by agentId; the new
    // requestId/toolId replaces the old — data-model "one pending per agent" invariant).
    this.pendingQuestions.set(e.agentId, record);

    tlog(`ask_user → @${binding.handle}: "${truncate(record.question, 80)}" (${options.length} options, freeform=${record.freeform}, requestId=${record.requestId || '∅'})`);

    const html = this.composeQuestion(record);
    let firstId: string | undefined;
    for (const chunk of chunkReply(html, 3500)) {
      const id = await this.safeReply(binding, chunk);
      if (!firstId) firstId = id;
    }
    // Only stamp the posted id if this record is still the current pending one (it may
    // have been superseded/cleared while awaiting the post).
    if (this.pendingQuestions.get(e.agentId) === record) {
      record.postedMessageId = firstId;
    }
  }

  /** Compose the HTML for a pending question: attention framing + question + labeled
   *  options + optional freeform hint (contract §A, FR-001/002/006; framing per FR-002/T031). */
  private composeQuestion(record: PendingQuestion): string {
    const lines: string[] = [
      `${this.agentLabel(record.binding)} ❓ <b>needs your answer</b>`,
      `<br><br>${escapeHtml(record.question)}`,
    ];
    for (const opt of record.options) {
      lines.push(`<br><b>${escapeHtml(opt.label)}</b> — ${escapeHtml(opt.text)}`);
    }
    lines.push(`<br><br><i>Reply with a letter (${record.options.map((o) => escapeHtml(o.label)).join(', ')}) to choose.</i>`);
    if (record.freeform) {
      lines.push(`<br><i>Or reply with your own answer.</i>`);
    }
    return lines.join('');
  }

  /** Compose the nudge re-listing options when a choices-only reply doesn't match a label
   *  (contract §B, FR-005/SC-005). Leaves the record pending. */
  private composeNudge(record: PendingQuestion): string {
    const lines: string[] = [
      `${this.agentLabel(record.binding)} 🤔 I didn't recognize that as one of the choices. Reply with a letter:`,
    ];
    for (const opt of record.options) {
      lines.push(`<br><b>${escapeHtml(opt.label)}</b> — ${escapeHtml(opt.text)}`);
    }
    return lines.join('');
  }

  /**
   * Resolve a thread reply against a pending question (contract §B). Selector-label-only
   * matching (FR-014). The `resolved` check-and-set is synchronous (main process is
   * single-threaded) so the first resolver wins — a near-simultaneous second reply finds
   * `resolved === true` and is dropped (single-resolution, FR-007/SC-004). The record is
   * deleted after the answer is submitted so genuine follow-up prompts dispatch normally.
   */
  private async resolveAnswer(record: PendingQuestion, rawText: string): Promise<void> {
    const token = (rawText.trim().split(/\s+/)[0] ?? '').replace(/[).:]$/, '');
    const matched = token
      ? record.options.find((o) => o.label.toLowerCase() === token.toLowerCase())
      : undefined;

    if (matched) {
      if (record.resolved) return; // latch: already claimed
      record.resolved = true;
      tlog(`answer → @${record.binding.handle}: label "${matched.label}" ⇒ "${truncate(matched.text, 60)}"`);
      const ok = await this.submitAnswerSafe(record, matched.text, false);
      this.settleResolution(record, ok);
      return;
    }

    if (record.freeform) {
      if (record.resolved) return;
      record.resolved = true;
      tlog(`answer → @${record.binding.handle}: freeform "${truncate(rawText, 60)}"`);
      const ok = await this.submitAnswerSafe(record, rawText.trim(), true);
      this.settleResolution(record, ok);
      return;
    }

    // Choices-only and no label match → nudge and leave the record pending (FR-005).
    await this.safeReply(record.binding, this.composeNudge(record));
  }

  /**
   * Finalize a resolution attempt (spec 015 hardening h2). On success, delete the record
   * so genuine follow-up prompts dispatch normally. On transport FAILURE, RELEASE the
   * single-resolution latch and KEEP the record so the human can simply reply again, and
   * post a thread notice — instead of silently dropping the answer and hanging the agent.
   */
  private settleResolution(record: PendingQuestion, ok: boolean): void {
    if (ok) {
      this.pendingQuestions.delete(record.agentId);
      return;
    }
    // Only roll back if this record is still the current pending one and still latched by
    // us (it may have been superseded by a newer question while awaiting the transport).
    if (this.pendingQuestions.get(record.agentId) === record) {
      record.resolved = false;
      void this.safeReply(
        record.binding,
        `${this.agentLabel(record.binding)} ⚠️ I couldn't deliver that answer — please reply again.`,
      );
    }
  }

  /** Submit an answer through the gateway. Returns true iff the transport reported success;
   *  a failure (thrown by the gateway when the runtime had no pending interaction to resolve,
   *  or a transient IPC error) returns false so the caller can keep the question open and
   *  re-prompt (FR hardening h2). The submitted value is the option TEXT (never the label)
   *  or the raw freeform text — identical to a local answer (FR-003/004/014). */
  private async submitAnswerSafe(record: PendingQuestion, answer: string, wasFreeform: boolean): Promise<boolean> {
    try {
      await this.deps.gateway.submitAnswer(record.officeId, record.agentId, {
        requestId: record.requestId || undefined,
        answer,
        wasFreeform,
      });
      return true;
    } catch (e) {
      twarn('submitAnswer failed:', (e as Error).message);
      return false;
    }
  }

  /**
   * Local-resolution detection for the node-pty degraded path (contract §C, FR-008): if
   * `agentId` has a still-pending, unresolved node-pty question (empty requestId) and a
   * non-`ask-user` event arrives, the ask_user was answered in-app. Latch it, clear the
   * record, and post a one-time "answered in the app" notice. SDK records (non-empty
   * requestId) are ignored here — they resolve precisely via {@link maybeLocalResolveByRequestId}
   * on the explicit `user_input.completed` signal, avoiding false positives when an agent
   * emits events while still blocked on the question.
   */
  private maybeLocalResolve(agentId: string): void {
    const record = this.pendingQuestions.get(agentId);
    if (!record || record.resolved) return;
    if (record.requestId) return; // SDK path: wait for the precise ask-user-complete signal.
    record.resolved = true;
    this.pendingQuestions.delete(agentId);
    tlog(`ask_user answered locally (node-pty) for @${record.binding.handle} — posting in-app notice.`);
    void this.safeReply(record.binding, `${this.agentLabel(record.binding)} ✅ Answered in the app.`);
  }

  /**
   * Precise local-resolution for the SDK/ui-server path (spec 015 hardening h1). Fired on
   * `user_input.completed`: clear the pending question ONLY when its requestId matches the
   * resolved interaction. A Teams answer clears the record synchronously before this fires,
   * so a matching record here means the answer came from the app → post the one-time notice.
   */
  private maybeLocalResolveByRequestId(agentId: string, requestId: string): void {
    const record = this.pendingQuestions.get(agentId);
    if (!record || record.resolved) return;
    // Only clear when the completed interaction is the one we're tracking. An empty
    // completed requestId can't be safely matched to a specific SDK question, so ignore it.
    if (!requestId || record.requestId !== requestId) return;
    record.resolved = true;
    this.pendingQuestions.delete(agentId);
    tlog(`ask_user answered locally (SDK requestId=${requestId}) for @${record.binding.handle} — posting in-app notice.`);
    void this.safeReply(record.binding, `${this.agentLabel(record.binding)} ✅ Answered in the app.`);
  }

  private agentLabel(binding: OnlineAgentBinding): string {
    return `🤖 <b>${escapeHtml(binding.displayName)}</b>`;
  }

  private async postReply(binding: OnlineAgentBinding, text: string): Promise<void> {
    const prefix = this.agentLabel(binding);
    // Recognize `<!--office-image:PATH-->` sentinels: pull them out of the reply
    // text (before markdown→HTML conversion) and attach the referenced files as
    // inline Graph hosted-content images. Paths resolve against the agent's cwd.
    const { text: noImages, paths } = extractImageMarkers(text);
    // Recognize `<!--office-file:PATH-->` sentinels on the image-stripped text and
    // attach the referenced files as raw Graph reference attachments (not inline).
    const { text: cleaned, paths: filePaths } = extractFileMarkers(noImages);
    let images: HostedImage[] = [];
    if (paths.length) {
      tlog(`office-image: @${binding.handle} reply has ${paths.length} sentinel(s): ${paths.join(', ')} (baseDir=${binding.workingDir})`);
      images = await loadHostedImages(paths, { baseDir: binding.workingDir, warn: (m) => twarn(m) });
      if (images.length) {
        tlog(`office-image: loaded ${images.length}/${paths.length} image(s) for @${binding.handle} — will attach inline.`);
      } else {
        twarn(`office-image: no images loaded for @${binding.handle} despite ${paths.length} sentinel(s) — all paths rejected (see warnings above).`);
      }
    }

    let attachments: AttachmentFile[] = [];
    if (filePaths.length) {
      tlog(`office-file: @${binding.handle} reply has ${filePaths.length} sentinel(s): ${filePaths.join(', ')} (baseDir=${binding.workingDir})`);
      attachments = await loadAttachmentFiles(filePaths, { baseDir: binding.workingDir, warn: (m) => twarn(m) });
      if (attachments.length) {
        tlog(`office-file: loaded ${attachments.length}/${filePaths.length} file(s) for @${binding.handle} — will attach as raw upload(s).`);
      } else {
        twarn(`office-file: no files loaded for @${binding.handle} despite ${filePaths.length} sentinel(s) — all paths rejected (see warnings above).`);
      }
    }

    if (cleaned) {
      const chunks = chunkReply(cleaned, 3500);
      for (const chunk of chunks) {
        await this.safeReply(binding, `${prefix}<br>${escapeHtml(chunk).replace(/\n/g, '<br>')}`);
      }
    }

    if (images.length) {
      tlog(`office-image: posting ${images.length} inline image reply to @${binding.handle} thread.`);
      await this.safeReply(binding, `${prefix}<br>${hostedImagesHtml(images)}`, images);
    }

    if (attachments.length) {
      const names = attachments.map((a) => a.name).join(', ');
      tlog(`office-file: posting ${attachments.length} attachment(s) to @${binding.handle} thread: ${names}`);
      await this.safeReply(binding, `${prefix}<br>📎 ${escapeHtml(names)}`, undefined, attachments);
    }
  }

  /** Reply to a thread, swallowing errors (logs only) so the queue keeps moving.
   *  Returns the posted messageId when Graph reports one (used to record the ask_user
   *  question's message id — spec 015 T021), or undefined on failure. */
  private async safeReply(
    binding: OnlineAgentBinding,
    html: string,
    hostedImages?: HostedImage[],
    attachments?: AttachmentFile[],
  ): Promise<string | undefined> {
    try {
      const posted = await this.deps.graph.replyToThread({
        teamId: binding.teamId,
        channelId: binding.channelId,
        threadRootId: binding.threadRootId,
        html,
        hostedImages,
        attachments,
      });
      // Record our own reply id so its Trouter echo is dropped (self-loop guard).
      if (posted?.messageId) this.rememberPosted(posted.messageId);
      return posted?.messageId;
    } catch (e) {
      twarn('replyToThread failed:', (e as Error).message);
      return undefined;
    }
  }

  // ── Reconnect / teardown reconcile (FR-022/024) ──────────────

  // ── Credential / connection health (auth + transport) ────────

  /** True when at least one agent is bound (online or persisted); gates health noise. */
  private hasBoundAgents(): boolean {
    return this.bindings.length > 0;
  }

  /**
   * Called by the token provider (wired in main.ts) on every acquisition outcome.
   * Owns the actionable credential toast and its throttle, and clears the warning once a
   * token is acquired again. Only surfaces while an agent is bound (avoid noise when Teams
   * isn't in use). A soft failure (cached-token fallback) is not user-facing — the agent is
   * still working — so only hard failures raise the prompt. `err` is used only to tailor the
   * message (az-login vs generic connectivity); it is never logged or shown verbatim.
   */
  onTokenOutcome(kind: 'acquire' | 'fail', _resource: string, usedCache: boolean, err?: Error): void {
    if (kind === 'acquire') {
      if (this.authBroken) {
        const hadToast = this.lastAuthToastAt > 0; // only announce recovery if we warned
        this.authBroken = false;
        this.lastAuthToastAt = 0;
        if (hadToast && this.hasBoundAgents()) {
          this.deps.emitToast({ level: 'info', message: 'Teams: Azure credential restored — reconnected.' });
          // Suppress the redundant transport "reconnected" toast for this same recovery.
          this.lastTransportHealth = 'unknown';
        }
      }
      return;
    }
    // kind === 'fail'
    if (usedCache) return; // soft degradation — still have a usable token, stay quiet
    if (!this.hasBoundAgents()) {
      // Remember it's broken so recovery still fires later, but don't toast when idle.
      this.authBroken = true;
      return;
    }
    const now = this.now();
    const dueForRepeat = now - this.lastAuthToastAt >= AUTH_TOAST_REPEAT_MS;
    if (!this.authBroken || dueForRepeat) {
      this.authBroken = true;
      this.lastAuthToastAt = now;
      // Any hard failure is actionable, but only an actual expired/missing login should
      // tell the user to run `az login`; a network/DNS blip gets a generic message.
      const looksLikeLogin = !err || isAzLoginError(err);
      this.deps.emitToast({
        level: 'error',
        message: looksLikeLogin
          ? 'Teams: Azure credential expired. Run "az login" in a new terminal to reconnect.'
          : 'Teams: can\u2019t reach Azure to authenticate (network issue?). Retrying automatically.',
        durationMs: AUTH_TOAST_DURATION_MS,
      });
    }
  }

  /**
   * Emit a one-shot notice when the receive transport (re)connects. Called each reconcile
   * tick. The az-login prompt is owned by {@link onTokenOutcome}; a transport drop that is
   * NOT an auth failure (e.g. a network blip) stays quiet — only its eventual recovery is
   * announced. Gated on bound agents to avoid noise when Teams isn't in use.
   */
  private checkTransportHealth(): void {
    const health = this.deps.source.health;
    const prev = this.lastTransportHealth;
    this.lastTransportHealth = health;
    if (!this.hasBoundAgents()) return;
    if (health === 'connected' && prev !== 'connected' && prev !== 'unknown') {
      this.deps.emitToast({ level: 'info', message: 'Teams: reconnected.' });
    }
  }

  /**
   * One-shot access check run when the feature is enabled + saved in Settings. Confirms the
   * signed-in user can actually reach the configured default + relay/Dump channels. Acquiring
   * the graph token here exercises `az`, so a broken credential trips the token observer →
   * az-login toast automatically. Purely reports via toast; never throws.
   */
  async verifyAccess(settings: TeamsSettings): Promise<void> {
    const targets: Array<{ label: string; url: string }> = [];
    if (settings.defaultChannelUrl?.trim()) targets.push({ label: 'default', url: settings.defaultChannelUrl });
    if (settings.relayChannelUrl?.trim()) targets.push({ label: 'Dump', url: settings.relayChannelUrl });
    if (targets.length === 0) return; // nothing configured to verify

    const getChannel = this.deps.graph.getChannel?.bind(this.deps.graph);
    if (!getChannel) return; // sender can't probe — skip silently

    const ok: string[] = [];
    const failed: string[] = []; // membership / wrong-link problems (403/404/unparseable)
    const authFailed: string[] = []; // 401 — token rejected (expired / wrong tenant)
    let unknownFailure = false; // token-acquisition / transient error — don't claim success
    for (const t of targets) {
      const coords = parseChannelLink(t.url);
      if (!coords) {
        failed.push(`${t.label} (unparseable link)`);
        continue;
      }
      try {
        await getChannel(coords.teamId, coords.channelId);
        ok.push(t.label);
      } catch (e) {
        const msg = (e as Error).message || '';
        if (/\b401\b/.test(msg)) {
          authFailed.push(t.label);
        } else if (/\b(403|404)\b/.test(msg)) {
          failed.push(t.label);
        } else {
          // Likely a token acquisition failure — the token observer owns that az-login
          // prompt; just make sure a partial success here isn't reported as all-clear.
          unknownFailure = true;
        }
      }
    }

    if (authFailed.length > 0) {
      this.deps.emitToast({
        level: 'error',
        message: `Teams: Azure sign-in was rejected for the ${authFailed.join(' + ')} channel${authFailed.length > 1 ? 's' : ''}. Run "az login" (correct tenant) and re-enable.`,
        durationMs: AUTH_TOAST_DURATION_MS,
      });
    }
    if (failed.length > 0) {
      this.deps.emitToast({
        level: 'warn',
        message: `Teams: can't access the ${failed.join(' + ')} channel${failed.length > 1 ? 's' : ''}. Check the link and your Teams membership.`,
      });
    }
    // Only claim success when EVERY configured target was confirmed reachable.
    if (authFailed.length === 0 && failed.length === 0 && !unknownFailure && ok.length > 0) {
      this.deps.emitToast({
        level: 'info',
        message: `Teams: verified access to the ${ok.join(' + ')} channel${ok.length > 1 ? 's' : ''}.`,
      });
    }
  }

  /**
   * Run a reconcile pass on demand (e.g. right after the renderer re-attaches
   * terminal sessions on startup / office switch), so Teams bindings re-online
   * immediately instead of waiting for the next periodic tick. No-op until started.
   */
  async reconcileNow(): Promise<void> {
    if (!this.started) return;
    await this.reconcile();
  }

  private async reconcile(): Promise<void> {
    this.checkTransportHealth();
    let changed = false;
    for (const b of [...this.bindings]) {
      // Abort cleanly if the service is stopping — a reconnect below would otherwise
      // re-enable forwarding / post a "Reconnected" notice after shutdown began.
      if (!this.started) return;
      let current: string | null = null;
      try {
        current = await this.deps.gateway.getSessionId(b.officeId, b.agentId);
      } catch {
        continue;
      }
      if (!this.started) return; // re-check after the await
      if (b.online) {
        if (current !== b.sessionId) {
          // Session was replaced or ended → tear down Teams (FR-022).
          tlog(`Session changed for @${b.handle} (${b.sessionId} → ${current ?? 'none'}) — taking offline (FR-022).`);
          await this.goOffline(b.officeId, b.agentId, true);
          changed = true;
        } else {
          b.lastConnected = this.now();
        }
      } else {
        // Event-driven reconnect (FR-024): the stored session reappeared. Only
        // re-online (and post the "reconnected" notice) once the agent's PTY is
        // actually alive AND the CLI has signalled ready — get-session-id returns
        // the disk-persisted id even before the PTY is running, so a bare id match
        // would prematurely notify the thread for a session that can't yet answer.
        if (current && current === b.sessionId) {
          const ready = await this.deps.gateway.isAgentReady(b.officeId, b.agentId).catch(() => false);
          if (!ready) continue; // session exists but not ready yet — wait for a later pass
          if (!this.started) return; // service stopped during the await — don't reconnect
          b.online = true;
          b.lastConnected = this.now();
          // Re-enable online-lifetime event mirroring (see register).
          this.deps.gateway.setForwarding(b.officeId, b.agentId, true);
          this.deps.emitStatus(this.toStatus(b));
          tlog(`Reconnected @${b.handle} to its persisted thread (session ${b.sessionId}).`);
          void this.safeReply(b, `${this.agentLabel(b)} 🔄 Reconnected — back online and ready. Reply here to continue.`);
          changed = true;
        }
      }
    }
    if (changed) {
      await this.persist();
      this.updateSourceChannels();
    }
  }

  private async onSessionExit(agentId: string): Promise<void> {
    const b = this.bindings.find((x) => x.agentId === agentId && x.online);
    if (b) {
      tlog(`Session exited for @${b.handle} — taking offline.`);
      await this.goOffline(b.officeId, b.agentId, true);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  private buildIntro(info: AgentInfo, handle: string, sessionTitle: string): string {
    const lines = [
      `<p>🟢 <b>${escapeHtml(info.displayName)}</b> is now online via Copilot Office.</p>`,
      `<p>Reply in this thread to talk to the agent. Send <code>/stop</code> to take it offline.</p>`,
      `<ul>`,
      `<li><b>Handle:</b> ${escapeHtml(handle)}</li>`,
      `<li><b>Folder:</b> ${escapeHtml(info.workingDir)}</li>`,
    ];
    if (sessionTitle) lines.push(`<li><b>Session:</b> ${escapeHtml(sessionTitle)}</li>`);
    lines.push(`</ul>`);
    return lines.join('');
  }

  private toStatus(b: OnlineAgentBinding): OnlineAgentStatus {
    return {
      agentId: b.agentId,
      officeId: b.officeId,
      online: b.online,
      handle: b.handle,
      threadWebUrl: b.threadWebUrl,
      health: b.online ? this.deps.source.health : 'disconnected',
      workingDir: b.workingDir,
    };
  }

  private findBinding(officeId: string, agentId: string): OnlineAgentBinding | undefined {
    return this.bindings.find((b) => b.officeId === officeId && b.agentId === agentId);
  }

  private onlineHandles(): Set<string> {
    return new Set(this.bindings.filter((b) => b.online).map((b) => b.handle));
  }

  private rememberThread(threadRootId: string): void {
    if (!this.knownThreads.some((t) => t.threadRootId === threadRootId)) {
      this.knownThreads.push({ threadRootId, noticePosted: false });
    }
  }

  /** Record a message id the app posted, so its Trouter echo is dropped (D9). Capped FIFO. */
  private rememberPosted(messageId: string): void {
    if (!messageId || this.postedMessageIds.has(messageId)) return;
    this.postedMessageIds.add(messageId);
    this.postedOrder.push(messageId);
    if (this.postedOrder.length > TeamsService.MAX_POSTED_IDS) {
      const old = this.postedOrder.shift();
      if (old) this.postedMessageIds.delete(old);
    }
  }

  private coordsForChannel(channelId: string): { teamId: string; tenantId: string } | null {
    const b = this.bindings.find((x) => x.channelId === channelId);
    if (b) return { teamId: b.teamId, tenantId: b.tenantId };
    return null;
  }

  /** Push the current active-channel set to a pollable source (chatsvc fallback). */
  private updateSourceChannels(): void {
    const src = this.deps.source as MessageSource & { setChannels?: (c: string[]) => void };
    if (typeof src.setChannels === 'function') {
      src.setChannels([...activeChannelSet(this.bindings)]);
    }
  }

  private async persist(): Promise<void> {
    await this.deps.store.save({ bindings: this.bindings, knownThreads: this.knownThreads });
  }
}

/** Single-line, length-capped preview of message text for logs (never a secret). */
function truncate(text: string, max: number): string {
  const oneLine = (text ?? '').replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}

/**
 * Generate a stable selector label for an option at `index` (spec 015 FR-014):
 * A, B, …, Z, AA, AB, … (Excel-style) so very long option lists still get unique labels.
 */
function selectorLabel(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

