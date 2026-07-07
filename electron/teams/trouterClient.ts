// T013 — Trouter WebSocket receive (primary). Port of agency-cowork trouter_client.py.
//
// Connects one account-wide WebSocket to the Teams Trouter gateway, authenticates with the
// ic3 token, registers with the Registrar (V3 surl + V2 fallback), and emits normalized
// InboundMessage objects for every pushed channel/chat message. Channel conversation ids
// carry a `;messageid=<rootId>` suffix — the thread routing key.
//
// Socket.IO-style frames:
//   1::            connect
//   5[:N]::json    named event (auth / trouter.connected / ping)
//   3:::json       push message (ACK required)
//   6:::...        ack / pong

import WebSocket from 'ws';
import * as crypto from 'crypto';
import type { TokenProvider } from './auth';
import type { InboundMessage } from './types';
import type { MessageSource } from './chatsvcClient';
import { hasMarker } from './marker';
import { stripHtml } from './htmlText';
import { tlog, twarn } from './log';

const DEFAULT_GATEWAY = 'go-msit.trouter.teams.microsoft.com';
const V2_REGISTRAR = 'https://teams.cloud.microsoft/registrar/prod/V2/registrations';
const ORIGIN = 'https://teams.cloud.microsoft';
const HEARTBEAT_MS = 30_000;
const REREGISTER_MS = 45 * 60 * 1000;

interface TrouterConnected {
  surl?: string;
  registrarUrl?: string;
  connectparams?: string;
}

/** Extract the thread root id from a channel conversation link/id `;messageid=<rootId>`. */
export function extractThreadRootId(conversationLink: string): string {
  if (!conversationLink) return '';
  const m = /;messageid=([^;&/?]+)/i.exec(conversationLink);
  return m ? m[1] : '';
}

/** Extract the channel id (`19:...@thread.tacv2`) from a conversation link. */
export function extractChannelId(conversationLink: string): string {
  if (!conversationLink) return '';
  // conversationLink: ".../conversations/19:...@thread.tacv2;messageid=..."
  let convo = conversationLink;
  const idx = convo.indexOf('/conversations/');
  if (idx >= 0) convo = convo.slice(idx + '/conversations/'.length);
  // Strip any ;messageid= suffix and decode.
  convo = convo.split(';')[0];
  try {
    convo = decodeURIComponent(convo);
  } catch {
    /* keep as-is */
  }
  return convo;
}

interface ParsedFrame {
  type: 'connect' | 'event' | 'message' | 'ack' | 'unknown';
  payload?: unknown;
}

export function parseFrame(raw: string): ParsedFrame {
  if (raw.startsWith('1::')) return { type: 'connect' };
  if (raw.startsWith('5')) {
    const m = /^5(?::[^:]*)?::([\s\S]*)$/.exec(raw);
    if (m) {
      try {
        return { type: 'event', payload: JSON.parse(m[1]) };
      } catch {
        return { type: 'event', payload: m[1] };
      }
    }
  }
  if (raw.startsWith('3:::')) {
    try {
      return { type: 'message', payload: JSON.parse(raw.slice(4)) };
    } catch {
      return { type: 'message', payload: raw.slice(4) };
    }
  }
  if (raw.startsWith('6:::')) return { type: 'ack', payload: raw.slice(4) };
  return { type: 'unknown', payload: raw };
}

/** Parse a Trouter push message body → InboundMessage (or null if not a NewMessage). */
export function parseEventMessage(body: unknown): InboundMessage | null {
  let data = body;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const d = data as Record<string, unknown>;
  if (!d || d.type !== 'EventMessage' || d.resourceType !== 'NewMessage') return null;
  const resource = (d.resource || {}) as Record<string, unknown>;
  const convLink = String(resource.conversationLink || '');
  const content = String(resource.content || '');
  return {
    messageId: String(resource.id || ''),
    channelId: extractChannelId(convLink),
    threadRootId: extractThreadRootId(convLink),
    senderName: String(resource.imdisplayname || ''),
    content: stripHtml(content),
    composeTime: String(resource.composetime || ''),
    hasMarker: hasMarker(content),
  };
}

/**
 * Decide whether a pushed message's channel should be processed. Trouter delivers
 * the whole account firehose, so once the active-channel set is known we drop any
 * channel without an online agent. Before initialization (setChannels never called)
 * the gate stays open so nothing is black-holed by unforeseen wiring.
 */
export function passesChannelGate(
  channelId: string,
  activeChannels: Set<string>,
  initialized: boolean,
): boolean {
  if (!initialized) return true;
  return activeChannels.has(channelId);
}

export class TrouterClient implements MessageSource {
  public health: 'connected' | 'disconnected' | 'error' = 'disconnected';
  private ws: WebSocket | null = null;
  private running = false;
  private frameCounter = 0;
  private surl = '';
  private registrarUrl = '';
  private registrationId = '';
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reregisterTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onMessage: ((m: InboundMessage) => void) | null = null;
  private activeChannels: Set<string> = new Set();
  private channelsInitialized = false;

  constructor(
    private readonly tokens: TokenProvider,
    private readonly gateway: string = DEFAULT_GATEWAY,
  ) {}

  async start(onMessage: (m: InboundMessage) => void): Promise<void> {
    this.onMessage = onMessage;
    this.running = true;
    await this.connect();
  }

  /**
   * Restrict processing to channels that currently have an online agent. Trouter is
   * an account-wide firehose (no server-side channel scoping), so this is our only
   * lever to stop foreign-channel traffic from being parsed, logged, or routed.
   * Called by teamsService.updateSourceChannels whenever bindings change. Until this
   * is first called, the gate stays open (avoids black-holing traffic if unwired).
   */
  setChannels(channels: string[]): void {
    this.activeChannels = new Set(channels);
    this.channelsInitialized = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.health = 'disconnected';
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reregisterTimer) clearInterval(this.reregisterTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = this.reregisterTimer = null;
    this.reconnectTimer = null;
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running) this.connect().catch((e) => twarn('Trouter reconnect failed:', e.message));
    }, 5000);
  }

  private async connect(): Promise<void> {
    const token = await this.tokens.getToken('ic3');
    const epid = crypto.randomUUID();
    this.registrationId = epid;
    const tc = JSON.stringify({ cv: '2026.03.01.1', ua: 'TeamsCDL', hr: '', v: '1415/26020101120' });
    const qs = new URLSearchParams({
      tc,
      timeout: '40',
      epid,
      ccid: '',
      dom: 'teams.cloud.microsoft',
      cor_id: crypto.randomUUID(),
      con_num: `${Date.now()}_0`,
    });
    const wsUrl = `wss://${this.gateway}/v4/c?${qs.toString()}`;

    const ws = new WebSocket(wsUrl, { headers: { Origin: ORIGIN }, maxPayload: 2 ** 22 });
    this.ws = ws;

    ws.on('open', () => {
      // Auth frame is sent after the 1:: connect frame arrives.
    });

    ws.on('message', (data: WebSocket.RawData) => {
      this.handleRaw(String(data), token, epid).catch((e) =>
        twarn('Trouter frame handler error:', (e as Error).message),
      );
    });

    ws.on('error', (err) => {
      this.health = 'error';
      twarn('Trouter socket error:', err.message);
    });

    ws.on('close', () => {
      this.health = 'disconnected';
      this.clearTimers();
      this.scheduleReconnect();
    });
  }

  private send(frame: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(frame);
  }

  private async handleRaw(raw: string, token: string, epid: string): Promise<void> {
    const { type, payload } = parseFrame(raw);

    if (type === 'connect') {
      // Send user.authenticate.
      const now = Math.floor(Date.now() / 1000);
      const auth = JSON.stringify({
        name: 'user.authenticate',
        args: [
          {
            headers: {
              'X-Ms-Test-User': 'False',
              Authorization: `Bearer ${token}`,
              'X-MS-Migration': 'True',
            },
            connectparams: {
              issuer: '',
              scae: '1',
              sig: '',
              sr: epid,
              sp: '',
              se: String((now + 600) * 1000),
              st: String(now * 1000),
            },
          },
        ],
      });
      this.send(`5:::${auth}`);
      return;
    }

    if (type === 'event' && payload && typeof payload === 'object') {
      const evt = payload as { name?: string; args?: unknown[] };
      if (evt.name === 'trouter.connected') {
        const info = (evt.args?.[0] || {}) as TrouterConnected;
        this.surl = info.surl || '';
        this.registrarUrl = info.registrarUrl || V2_REGISTRAR;
        this.health = 'connected';
        tlog('Trouter connected — registering for channel push…');
        await this.register(token);
        this.startHeartbeat(token);
        return;
      }
      if (evt.name === 'ping') {
        this.frameCounter += 1;
        this.send(`6:::${this.frameCounter}["pong"]`);
        return;
      }
      if (evt.name === 'trouter.message_loss') {
        this.frameCounter += 1;
        const ack = JSON.stringify({ name: 'trouter.processed_message_loss', args: evt.args || [{}] });
        this.send(`5:${this.frameCounter}+::${ack}`);
        return;
      }
      return;
    }

    if (type === 'message' && payload && typeof payload === 'object') {
      const msg = payload as { id?: string; body?: unknown };
      if (msg.id) {
        const ack = JSON.stringify({ id: msg.id, status: 200, headers: {}, body: '' });
        this.send(`3:::${ack}`);
      }
      const inbound = parseEventMessage(msg.body);
      if (!inbound || !this.onMessage) return;
      // Channel gate: Trouter pushes every message the signed-in user can see. Once
      // we know which channels have an online agent, silently drop pushes for any
      // other channel — no logging, no routing — so foreign traffic never surfaces.
      if (!passesChannelGate(inbound.channelId, this.activeChannels, this.channelsInitialized)) {
        return;
      }
      if (inbound.threadRootId) {
        tlog(`Push: "${inbound.senderName}" in ${inbound.channelId.slice(0, 24)}… thread ${inbound.threadRootId}${inbound.hasMarker ? ' [self]' : ''}`);
      }
      this.onMessage(inbound);
    }
  }

  private startHeartbeat(token: string): void {
    this.clearTimers();
    this.heartbeatTimer = setInterval(() => {
      this.frameCounter += 1;
      this.send(`5:${this.frameCounter}+::{"name":"ping"}`);
    }, HEARTBEAT_MS);
    this.reregisterTimer = setInterval(() => {
      this.register(token).catch((e) => twarn('Trouter re-register failed:', e.message));
    }, REREGISTER_MS);
  }

  private async register(token: string): Promise<void> {
    const payload = {
      clientDescription: {
        appId: 'TeamsCDLWebWorker',
        aesKey: '',
        languageId: 'en-US',
        platform: 'edge',
        templateKey: 'TeamsCDLWebWorker_2.6',
        platformUIVersion: '1415/26020101120',
      },
      registrationId: this.registrationId,
      nodeId: '',
      transports: { TROUTER: [{ context: '', path: this.surl, ttl: 3600 }] },
    };
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: ORIGIN,
    };
    const urls = Array.from(new Set([this.registrarUrl, V2_REGISTRAR].filter(Boolean)));
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
        if (!res.ok && res.status !== 202) {
          twarn(`Registrar ${url.slice(0, 60)} returned ${res.status}`);
        }
      } catch (e) {
        twarn(`Registrar ${url.slice(0, 60)} failed:`, (e as Error).message);
      }
    }
  }
}
