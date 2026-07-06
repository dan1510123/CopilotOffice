// T011 — Microsoft Graph sender: create thread + reply. Embeds the self-loop marker.
//
// Spike-validated 2026-07-06: works with the CLI Graph token (Directory.AccessAsUser.All;
// no ChannelMessage.Send consent needed). HTML body supported.

import type { TokenProvider } from './auth';
import { embedMarker } from './marker';

export interface CreateThreadParams {
  teamId: string;
  channelId: string;
  subject: string;
  html: string;
}

export interface ReplyParams {
  teamId: string;
  channelId: string;
  threadRootId: string;
  html: string;
}

export interface GraphSender {
  createThread(p: CreateThreadParams): Promise<{ threadRootId: string; webUrl: string }>;
  replyToThread(p: ReplyParams): Promise<{ messageId: string }>;
  listChannels?(teamId: string): Promise<Array<{ id: string; displayName: string }>>;
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export class GraphClient implements GraphSender {
  constructor(private readonly tokens: TokenProvider) {}

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.tokens.getToken('graph');
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  async createThread(p: CreateThreadParams): Promise<{ threadRootId: string; webUrl: string }> {
    const url = `${GRAPH_BASE}/teams/${encodeURIComponent(p.teamId)}/channels/${encodeURIComponent(
      p.channelId,
    )}/messages`;
    const body = {
      subject: p.subject,
      body: { contentType: 'html', content: embedMarker(p.html) },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Graph createThread failed: ${res.status} ${await safeText(res)}`);
    }
    const json = (await res.json()) as { id?: string; webUrl?: string };
    if (!json.id) throw new Error('Graph createThread: response missing message id');
    return { threadRootId: json.id, webUrl: json.webUrl || '' };
  }

  async replyToThread(p: ReplyParams): Promise<{ messageId: string }> {
    const url = `${GRAPH_BASE}/teams/${encodeURIComponent(p.teamId)}/channels/${encodeURIComponent(
      p.channelId,
    )}/messages/${encodeURIComponent(p.threadRootId)}/replies`;
    const body = { body: { contentType: 'html', content: embedMarker(p.html) } };
    const res = await fetch(url, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Graph replyToThread failed: ${res.status} ${await safeText(res)}`);
    }
    const json = (await res.json()) as { id?: string };
    return { messageId: json.id || '' };
  }

  async listChannels(teamId: string): Promise<Array<{ id: string; displayName: string }>> {
    const url = `${GRAPH_BASE}/teams/${encodeURIComponent(teamId)}/channels`;
    const res = await fetch(url, { headers: await this.authHeaders() });
    if (!res.ok) throw new Error(`Graph listChannels failed: ${res.status}`);
    const json = (await res.json()) as { value?: Array<{ id: string; displayName: string }> };
    return json.value || [];
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}
