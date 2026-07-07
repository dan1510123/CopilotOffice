// T011 — Microsoft Graph sender: create thread + reply. Embeds the self-loop marker.
//
// Spike-validated 2026-07-06: works with the CLI Graph token (Directory.AccessAsUser.All;
// no ChannelMessage.Send consent needed). HTML body supported.

import type { TokenProvider } from './auth';
import type { HostedImage } from './imageMarker';
import { embedMarker } from './marker';

export interface CreateThreadParams {
  teamId: string;
  channelId: string;
  subject: string;
  html: string;
  /** Optional inline images referenced by the html via `../hostedContents/{id}/$value`. */
  hostedImages?: HostedImage[];
}

export interface ReplyParams {
  teamId: string;
  channelId: string;
  threadRootId: string;
  html: string;
  /** Optional inline images referenced by the html via `../hostedContents/{id}/$value`. */
  hostedImages?: HostedImage[];
}

/** Build the Graph `hostedContents` array (temporaryId + base64 bytes) for inline images. */
function buildHostedContents(images?: HostedImage[]): Array<Record<string, unknown>> | undefined {
  if (!images || images.length === 0) return undefined;
  return images.map((img) => ({
    '@microsoft.graph.temporaryId': img.id,
    contentBytes: img.contentBytesBase64,
    contentType: img.contentType,
  }));
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
    const body: Record<string, unknown> = {
      subject: p.subject,
      body: { contentType: 'html', content: embedMarker(p.html) },
    };
    const hostedContents = buildHostedContents(p.hostedImages);
    if (hostedContents) body.hostedContents = hostedContents;
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
    const body: Record<string, unknown> = { body: { contentType: 'html', content: embedMarker(p.html) } };
    const hostedContents = buildHostedContents(p.hostedImages);
    if (hostedContents) body.hostedContents = hostedContents;
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
