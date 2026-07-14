// T011 — Microsoft Graph sender: create thread + reply. Embeds the self-loop marker.
//
// Spike-validated 2026-07-06: works with the CLI Graph token (Directory.AccessAsUser.All;
// no ChannelMessage.Send consent needed). HTML body supported.

import type { TokenProvider } from './auth';
import type { HostedImage } from './imageMarker';
import type { AttachmentFile } from './fileMarker';
import { embedMarker } from './marker';
import { randomUUID } from 'crypto';

export interface CreateThreadParams {
  teamId: string;
  channelId: string;
  subject: string;
  html: string;
  /** Optional inline images referenced by the html via `../hostedContents/{id}/$value`. */
  hostedImages?: HostedImage[];
  /** Optional raw files uploaded to the channel and attached as reference attachments. */
  attachments?: AttachmentFile[];
  /**
   * Optional per-send relay @mention override. Honored only by the relay sender; the direct
   * Graph sender ignores it. When absent / 'none' / empty value, the sender falls back to the
   * global operator-configured mention. See {@link createRelaySender}.
   */
  mentionOverride?: { type: 'user' | 'tag' | 'none'; value: string };
}

export interface ReplyParams {
  teamId: string;
  channelId: string;
  threadRootId: string;
  html: string;
  /** Optional inline images referenced by the html via `../hostedContents/{id}/$value`. */
  hostedImages?: HostedImage[];
  /** Optional raw files uploaded to the channel and attached as reference attachments. */
  attachments?: AttachmentFile[];
  /**
   * Optional per-send relay @mention override. Honored only by the relay sender; the direct
   * Graph sender ignores it. When absent / 'none' / empty value, the sender falls back to the
   * global operator-configured mention. See {@link createRelaySender}.
   */
  mentionOverride?: { type: 'user' | 'tag' | 'none'; value: string };
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

/** A file uploaded to a channel's SharePoint folder, ready to reference from a message. */
interface UploadedAttachment {
  /** GUID used as BOTH the message attachment id and the `<attachment>` element id. */
  id: string;
  /** SharePoint webUrl of the uploaded file. */
  contentUrl: string;
  /** Display name (the file's basename). */
  name: string;
}

/** Build the message-level `attachments` array (reference attachments) from uploads. */
function buildReferenceAttachments(uploads: UploadedAttachment[]): Array<Record<string, unknown>> {
  return uploads.map((u) => ({
    id: u.id,
    contentType: 'reference',
    contentUrl: u.contentUrl,
    name: u.name,
  }));
}

/** Build the trailing `<attachment>` HTML that surfaces each reference attachment as a chiclet. */
function referenceAttachmentsHtml(uploads: UploadedAttachment[]): string {
  return uploads.map((u) => `<attachment id="${u.id}"></attachment>`).join('');
}

/** Extract the GUID from a driveItem eTag (`"{GUID},1"`); null when none present. */
function guidFromETag(eTag?: string): string | null {
  const m = (eTag ?? '').match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return m ? m[0] : null;
}

export interface GraphSender {
  createThread(p: CreateThreadParams): Promise<{ threadRootId: string; webUrl: string }>;
  replyToThread(p: ReplyParams): Promise<{ messageId: string }>;
  listChannels?(teamId: string): Promise<Array<{ id: string; displayName: string }>>;
  /** Probe access to a single channel; throws with the HTTP status on non-OK. */
  getChannel?(teamId: string, channelId: string): Promise<{ id: string; displayName: string }>;
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
    const uploads = await this.uploadAttachments(p.teamId, p.channelId, p.attachments);
    let content = embedMarker(p.html);
    if (uploads.length) content += referenceAttachmentsHtml(uploads);
    const body: Record<string, unknown> = {
      subject: p.subject,
      body: { contentType: 'html', content },
    };
    const hostedContents = buildHostedContents(p.hostedImages);
    if (hostedContents) body.hostedContents = hostedContents;
    if (uploads.length) body.attachments = buildReferenceAttachments(uploads);
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
    const uploads = await this.uploadAttachments(p.teamId, p.channelId, p.attachments);
    let content = embedMarker(p.html);
    if (uploads.length) content += referenceAttachmentsHtml(uploads);
    const body: Record<string, unknown> = { body: { contentType: 'html', content } };
    const hostedContents = buildHostedContents(p.hostedImages);
    if (hostedContents) body.hostedContents = hostedContents;
    if (uploads.length) body.attachments = buildReferenceAttachments(uploads);
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

  /**
   * Upload each raw file into the channel's SharePoint files folder and return the
   * reference-attachment descriptors. Returns [] when there are no attachments. A single
   * upload failure propagates so the caller can decide (teamsService retries text-only).
   */
  private async uploadAttachments(
    teamId: string,
    channelId: string,
    attachments?: AttachmentFile[],
  ): Promise<UploadedAttachment[]> {
    if (!attachments || attachments.length === 0) return [];
    const folder = await this.getChannelFilesFolder(teamId, channelId);
    const out: UploadedAttachment[] = [];
    for (const file of attachments) {
      out.push(await this.uploadChannelFile(folder.driveId, folder.itemId, file));
    }
    return out;
  }

  /** Resolve the driveId + item id of a channel's SharePoint files folder. */
  private async getChannelFilesFolder(
    teamId: string,
    channelId: string,
  ): Promise<{ driveId: string; itemId: string }> {
    const url = `${GRAPH_BASE}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(
      channelId,
    )}/filesFolder`;
    const res = await fetch(url, { headers: await this.authHeaders() });
    if (!res.ok) throw new Error(`Graph filesFolder failed: ${res.status} ${await safeText(res)}`);
    const json = (await res.json()) as { id?: string; parentReference?: { driveId?: string } };
    const driveId = json.parentReference?.driveId;
    const itemId = json.id;
    if (!driveId || !itemId) throw new Error('Graph filesFolder: response missing driveId/itemId');
    return { driveId, itemId };
  }

  /** Upload one file's raw bytes into the folder and return its reference descriptor. */
  private async uploadChannelFile(
    driveId: string,
    folderItemId: string,
    file: AttachmentFile,
  ): Promise<UploadedAttachment> {
    const url = `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(
      folderItemId,
    )}:/${encodeURIComponent(file.name)}:/content`;
    const headers = await this.authHeaders();
    headers['Content-Type'] = file.contentType || 'application/octet-stream';
    const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(file.bytes) });
    if (!res.ok) {
      throw new Error(`Graph upload failed for ${file.name}: ${res.status} ${await safeText(res)}`);
    }
    const json = (await res.json()) as { webUrl?: string; eTag?: string };
    if (!json.webUrl) throw new Error(`Graph upload for ${file.name}: response missing webUrl`);
    return {
      id: guidFromETag(json.eTag) ?? randomUUID(),
      contentUrl: json.webUrl,
      name: file.name,
    };
  }

  async listChannels(teamId: string): Promise<Array<{ id: string; displayName: string }>> {
    const url = `${GRAPH_BASE}/teams/${encodeURIComponent(teamId)}/channels`;
    const res = await fetch(url, { headers: await this.authHeaders() });
    if (!res.ok) throw new Error(`Graph listChannels failed: ${res.status}`);
    const json = (await res.json()) as { value?: Array<{ id: string; displayName: string }> };
    return json.value || [];
  }

  /**
   * Probe access to a single channel (`GET /teams/{teamId}/channels/{channelId}`). Used by
   * the settings-save access check to confirm the signed-in user can actually reach the
   * configured default / Dump channels. Throws with the HTTP status on non-OK so the caller
   * can classify 401/403 (permission) vs 404 (wrong link).
   */
  async getChannel(teamId: string, channelId: string): Promise<{ id: string; displayName: string }> {
    const url = `${GRAPH_BASE}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(
      channelId,
    )}?$select=id,displayName`;
    const res = await fetch(url, { headers: await this.authHeaders() });
    if (!res.ok) throw new Error(`Graph getChannel failed: ${res.status} ${await safeText(res)}`);
    const json = (await res.json()) as { id?: string; displayName?: string };
    return { id: json.id || channelId, displayName: json.displayName || '' };
  }

  /** List a team's tags (id + displayName) — used to resolve a tag name to its tagId. */
  async listTags(teamId: string): Promise<Array<{ id: string; displayName: string }>> {
    const url = `${GRAPH_BASE}/teams/${encodeURIComponent(teamId)}/tags?$select=id,displayName`;
    const res = await fetch(url, { headers: await this.authHeaders() });
    if (!res.ok) throw new Error(`Graph listTags failed: ${res.status} ${await safeText(res)}`);
    const json = (await res.json()) as { value?: Array<{ id: string; displayName: string }> };
    return json.value || [];
  }

  /**
   * Resolve a user reference to an AAD object id. A UPN (contains '@') or a GUID is
   * looked up / passed through directly; anything else is treated as a display name and
   * matched (exact, case-insensitive) against Graph. Returns '' when unresolved.
   */
  async findUserId(query: string): Promise<string> {
    const q = query.trim();
    if (!q) return '';
    const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
    const isUpn = q.includes('@');
    if (isGuid || isUpn) {
      const url = `${GRAPH_BASE}/users/${encodeURIComponent(q)}?$select=id`;
      const res = await fetch(url, { headers: await this.authHeaders() });
      if (!res.ok) return '';
      const json = (await res.json()) as { id?: string };
      return json.id || '';
    }
    const filter = `displayName eq '${q.replace(/'/g, "''")}'`;
    const url = `${GRAPH_BASE}/users?$filter=${encodeURIComponent(filter)}&$select=id&$top=1`;
    const res = await fetch(url, { headers: await this.authHeaders() });
    if (!res.ok) return '';
    const json = (await res.json()) as { value?: Array<{ id: string }> };
    return json.value?.[0]?.id || '';
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}
