// T012 — chatsvc receive fallback (polling).
//
// Used when Trouter is unavailable/dropped. Polls the channel's message list with a
// `sequenceId` cursor and normalizes results into InboundMessage. Region default `amer`.

import type { TokenProvider } from './auth';
import type { InboundMessage } from './types';
import { hasMarker } from './marker';
import { stripHtml } from './htmlText';
import { twarn } from './log';

export interface MessageSource {
  /** Emits normalized InboundMessage objects. */
  start(onMessage: (m: InboundMessage) => void): Promise<void>;
  stop(): Promise<void>;
  readonly health: 'connected' | 'disconnected' | 'error';
}

interface ChatsvcMessage {
  id?: string;
  messagetype?: string;
  sequenceId?: number;
  imdisplayname?: string;
  content?: string;
  composetime?: string;
  properties?: { parentMessageId?: string };
  rootMessageId?: string;
  conversationLink?: string;
}

/** Poll-based receive fallback over chatsvc. */
export class ChatsvcPollSource implements MessageSource {
  public health: 'connected' | 'disconnected' | 'error' = 'disconnected';
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSeq = new Map<string, number>();

  constructor(
    private readonly tokens: TokenProvider,
    /** Channels to poll (channelId list); may change over time via setChannels(). */
    private channels: string[],
    private readonly region: string = 'amer',
    private readonly pollIntervalMs: number = 4000,
  ) {}

  setChannels(channels: string[]): void {
    this.channels = channels;
  }

  async start(onMessage: (m: InboundMessage) => void): Promise<void> {
    this.health = 'connected';
    const tick = async () => {
      try {
        for (const channelId of this.channels) {
          const msgs = await this.poll(channelId);
          for (const m of msgs) onMessage(m);
        }
      } catch (e) {
        this.health = 'error';
        twarn('chatsvc poll error:', (e as Error).message);
      }
    };
    this.timer = setInterval(tick, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.health = 'disconnected';
  }

  private async poll(channelId: string): Promise<InboundMessage[]> {
    const token = await this.tokens.getToken('ic3');
    const enc = encodeURIComponent(channelId);
    const url = `https://teams.cloud.microsoft/api/chatsvc/${this.region}/v1/users/ME/conversations/${enc}/messages?pageSize=20`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return [];
    const json = (await res.json()) as { messages?: ChatsvcMessage[] };
    const since = this.lastSeq.get(channelId) ?? 0;
    let maxSeq = since;
    const out: InboundMessage[] = [];
    for (const m of json.messages || []) {
      const seq = Number(m.sequenceId || 0);
      if (seq <= since) continue;
      if (seq > maxSeq) maxSeq = seq;
      if (m.messagetype && m.messagetype !== 'RichText/Html' && m.messagetype !== 'Text') continue;
      const threadRootId = m.properties?.parentMessageId || m.rootMessageId || '';
      out.push({
        messageId: m.id || '',
        channelId,
        threadRootId,
        senderName: m.imdisplayname || '',
        content: stripHtml(m.content || ''),
        composeTime: m.composetime || '',
        hasMarker: hasMarker(m.content || ''),
      });
    }
    this.lastSeq.set(channelId, maxSeq);
    return out;
  }
}
