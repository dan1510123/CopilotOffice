import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway, AgentEvent } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { InboundMessage, TeamsSettings } from '../../../electron/teams/types';
import type { AutoImageRenderer, AutoRenderResult } from '../../../electron/teams/autoImageRenderer';

// Spec 018 — auto-render markdown replies as Teams images.
// These integration tests drive the finalize hook end-to-end with an injected fake
// renderer, asserting the augment (US1), never-drop fallback (US2), no-double-render
// (US3), opt-in/out gate (US4), and security-path (FR-011) behaviors.

const RELATIVE_PNG = '.office-images/reply.png';
const SENTINEL = `<!--office-image:${RELATIVE_PNG}-->`;

/** 8-byte PNG signature + a little payload, enough to pass sniffImageType/loadHostedImages. */
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('minimal-png-body'),
]);

/** A >1000-char reply containing a block-level markdown table (qualifies for FR-002). */
function qualifyingMarkdown(): string {
  const table = '| Col A | Col B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
  const filler = 'This is a detailed explanation of the results shown above. '.repeat(30);
  const text = `${table}\n\n${filler}`;
  return text;
}

function baseSettings(over: Partial<TeamsSettings> = {}): TeamsSettings {
  return {
    enabled: true,
    defaultChannelUrl:
      'https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Agent%20Hub?groupId=team-1&tenantId=tenant-1',
    relayChannelUrl: '',
    relayMentionType: 'none',
    relayMentionValue: '',
    notifyOnCompleteEnabled: false,
    ackEnabled: false,
    checkInEnabled: false,
    checkInThresholdMs: 120000,
    checkInThrottleMs: 60000,
    autoRenderMarkdownImages: true,
    ...over,
  };
}

interface HarnessOpts {
  settings?: TeamsSettings;
  renderResult?: AutoRenderResult;
  isAvailable?: boolean;
  workingDir?: string;
}

function makeHarness(opts: HarnessOpts = {}) {
  const store = new InMemoryTeamsOnlineStore();
  const tokens: TokenProvider = { getToken: async () => 'fake' };

  const replies: string[] = [];
  const replyImages: (unknown[] | undefined)[] = [];
  const graph: GraphSender = {
    createThread: vi.fn(async () => ({ threadRootId: 'root-1', webUrl: 'https://web/thread' })),
    replyToThread: vi.fn(async (p: any) => {
      replies.push(p.html);
      replyImages.push(p.hostedImages);
      return { messageId: `reply-${replies.length}` };
    }),
  };

  let emit: (m: InboundMessage) => void = () => {};
  const source: MessageSource = {
    health: 'connected',
    start: async (cb) => {
      emit = cb;
    },
    stop: async () => {},
  };

  let agentCb: (e: AgentEvent) => void = () => {};
  const submitted: string[] = [];
  const gateway: SessionGateway = {
    getSessionId: async () => 'session-1',
    getSessionMeta: async () => ({ title: '' }),
    isAgentReady: async () => true,
    submitPrompt: async (_o, _a, prompt) => {
      submitted.push(prompt);
    },
    setForwarding: () => {},
    onAgentEvent: (cb) => {
      agentCb = cb;
      return () => {};
    },
    onSessionExit: () => () => {},
  };

  const renderSpy = vi.fn(
    async (): Promise<AutoRenderResult> =>
      opts.renderResult ?? { ok: true, sentinel: SENTINEL },
  );
  const autoRenderer: AutoImageRenderer = {
    isAvailable: () => opts.isAvailable ?? true,
    render: renderSpy,
  };

  const settings = opts.settings ?? baseSettings();
  const workingDir = opts.workingDir ?? '.';

  const service = new TeamsService({
    store,
    tokens,
    graph,
    source,
    gateway,
    getSettings: () => settings,
    emitStatus: () => {},
    emitToast: () => {},
    turnSettleMs: 5,
    autoRenderer,
  });

  return {
    service,
    graph,
    replies,
    replyImages,
    submitted,
    renderSpy,
    workingDir,
    inbound: () => emit,
    agent: () => agentCb,
  };
}

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/** Drive a dispatched (Teams-originated) turn with the given reply text and settle. */
async function driveDispatch(h: ReturnType<typeof makeHarness>, replyText: string) {
  h.inbound()({
    messageId: 'm-1',
    channelId: '19:abc@thread.tacv2',
    threadRootId: 'root-1',
    senderName: 'Alice',
    content: 'summarize',
    composeTime: new Date().toISOString(),
    hasMarker: false,
  });
  await tick(20);
  h.agent()({ agentId: 'generalist', kind: 'message', content: replyText });
  h.agent()({ agentId: 'generalist', kind: 'turn-end' });
  await tick(60);
}

/** Drive an ambient (locally-driven) turn with the given reply text and settle. */
async function driveAmbient(h: ReturnType<typeof makeHarness>, replyText: string) {
  h.agent()({ agentId: 'generalist', kind: 'user-message', content: 'do it locally' });
  h.agent()({ agentId: 'generalist', kind: 'turn-start' });
  h.agent()({ agentId: 'generalist', kind: 'message', content: replyText });
  h.agent()({ agentId: 'generalist', kind: 'turn-end' });
  await tick(60);
}

const imagePosts = (h: ReturnType<typeof makeHarness>) =>
  h.replies.filter((html) => html.includes('../hostedContents/'));

describe('spec 018 — Teams auto-image render (US1 augment)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-img-'));
    fs.mkdirSync(path.join(tmpDir, '.office-images'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, RELATIVE_PNG), PNG_BYTES);
  });
  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('appends a rendered image AFTER the plain-text reply on a dispatched turn (FR-004/FR-005)', async () => {
    const h = makeHarness({ workingDir: tmpDir });
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: tmpDir });

    const md = qualifyingMarkdown();
    await driveDispatch(h, md);

    // Plain text streamed first.
    const textIdx = h.replies.findIndex((r) => r.includes('detailed explanation'));
    expect(textIdx).toBeGreaterThanOrEqual(0);
    // An additional image post came AFTER the plain text.
    const imgIdx = h.replies.findIndex((r) => r.includes('../hostedContents/'));
    expect(imgIdx).toBeGreaterThan(textIdx);
    expect(imagePosts(h)).toHaveLength(1);
    expect(h.renderSpy).toHaveBeenCalledTimes(1);
    // The image reply carried hostedImages (inline attachment).
    const imgReplyPos = h.replyImages[imgIdx];
    expect(Array.isArray(imgReplyPos) && imgReplyPos!.length).toBeTruthy();
  });

  it('appends a rendered image on an ambient (locally-driven) turn (FR-005)', async () => {
    const h = makeHarness({ workingDir: tmpDir });
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: tmpDir });

    await driveAmbient(h, qualifyingMarkdown());

    expect(imagePosts(h)).toHaveLength(1);
    expect(h.renderSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT render a non-qualifying plain-prose reply (no image, plain text intact)', async () => {
    const h = makeHarness({ workingDir: tmpDir });
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: tmpDir });

    const prose = 'Just some plain prose reply. '.repeat(50); // >1000, no structure
    await driveDispatch(h, prose);

    expect(h.renderSpy).not.toHaveBeenCalled();
    expect(imagePosts(h)).toHaveLength(0);
    expect(h.replies.join('\n')).toContain('plain prose reply');
  });

  it('does NOT render a short (<=1000-char) structured reply', async () => {
    const h = makeHarness({ workingDir: tmpDir });
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: tmpDir });

    await driveDispatch(h, '| A | B |\n| --- | --- |\n| 1 | 2 |'); // short structured

    expect(h.renderSpy).not.toHaveBeenCalled();
    expect(imagePosts(h)).toHaveLength(0);
  });
});

describe('spec 018 — never drop a reply on render failure (US2, FR-008)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-img-'));
    fs.mkdirSync(path.join(tmpDir, '.office-images'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, RELATIVE_PNG), PNG_BYTES);
  });
  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('falls back to plain text when isAvailable() is false (renderer never invoked)', async () => {
    const h = makeHarness({ workingDir: tmpDir, isAvailable: false });
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: tmpDir });

    await driveDispatch(h, qualifyingMarkdown());

    expect(h.renderSpy).not.toHaveBeenCalled();
    expect(imagePosts(h)).toHaveLength(0);
    expect(h.replies.join('\n')).toContain('detailed explanation');
  });

  it('falls back to plain text when render returns ok:false (spawn/exit/timeout/no-sentinel)', async () => {
    for (const bad of [
      { ok: false, reason: 'exit-1' },
      { ok: false, reason: 'timeout' },
      { ok: false, reason: 'no-sentinel' },
    ] as AutoRenderResult[]) {
      const h = makeHarness({ workingDir: tmpDir, renderResult: bad });
      await h.service.start();
      await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: tmpDir });

      await driveDispatch(h, qualifyingMarkdown());

      expect(imagePosts(h)).toHaveLength(0);
      expect(h.replies.join('\n')).toContain('detailed explanation');
    }
  });

  it('falls back to plain text when the produced image is rejected (loadHostedImages returns [])', async () => {
    // workingDir is a valid dir but the sentinel points to a non-existent file → rejected.
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-img-empty-'));
    try {
      const h = makeHarness({ workingDir: emptyDir });
      await h.service.start();
      await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: emptyDir });

      await driveDispatch(h, qualifyingMarkdown());

      expect(h.renderSpy).toHaveBeenCalledTimes(1);
      expect(imagePosts(h)).toHaveLength(0);
      expect(h.replies.join('\n')).toContain('detailed explanation');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('spec 018 — no double render (US3, FR-009)', () => {
  it('skips auto-render when the reply already contains a valid office-image sentinel', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-img-'));
    fs.mkdirSync(path.join(tmpDir, '.office-images'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, RELATIVE_PNG), PNG_BYTES);
    try {
      const h = makeHarness({ workingDir: tmpDir });
      await h.service.start();
      await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: tmpDir });

      // A qualifying >1000-char markdown reply that ALSO carries the agent's own sentinel.
      const md = `${qualifyingMarkdown()}\n\n${SENTINEL}`;
      await driveDispatch(h, md);

      // Auto-renderer never invoked (the existing sentinel path handles the image).
      expect(h.renderSpy).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('spec 018 — opt-in / opt-out gate (US4, FR-010)', () => {
  it('is fully inert when autoRenderMarkdownImages is false (renderer never invoked)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-img-'));
    fs.mkdirSync(path.join(tmpDir, '.office-images'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, RELATIVE_PNG), PNG_BYTES);
    try {
      const h = makeHarness({ workingDir: tmpDir, settings: baseSettings({ autoRenderMarkdownImages: false }) });
      await h.service.start();
      await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: tmpDir });

      await driveDispatch(h, qualifyingMarkdown());

      expect(h.renderSpy).not.toHaveBeenCalled();
      expect(imagePosts(h)).toHaveLength(0);
      expect(h.replies.join('\n')).toContain('detailed explanation');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('spec 018 — security invariant: images only via loadHostedImages (FR-011)', () => {
  it('rejects an absolute-path sentinel and falls back to plain text', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-img-'));
    // Put a real PNG OUTSIDE the sandbox and have the renderer return an absolute path to it.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-img-outside-'));
    const outsidePng = path.join(outsideDir, 'secret.png');
    fs.writeFileSync(outsidePng, PNG_BYTES);
    try {
      const h = makeHarness({
        workingDir: tmpDir,
        renderResult: { ok: true, sentinel: `<!--office-image:${outsidePng.replace(/\\/g, '/')}-->` },
      });
      await h.service.start();
      await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: tmpDir });

      await driveDispatch(h, qualifyingMarkdown());

      // Absolute path escapes the sandbox → rejected by loadHostedImages → no image post.
      expect(imagePosts(h)).toHaveLength(0);
      expect(h.replies.join('\n')).toContain('detailed explanation');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('rejects a `..` traversal sentinel and falls back to plain text', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-img-parent-'));
    const tmpDir = path.join(parent, 'sandbox');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(parent, 'escape.png'), PNG_BYTES);
    try {
      const h = makeHarness({
        workingDir: tmpDir,
        renderResult: { ok: true, sentinel: '<!--office-image:../escape.png-->' },
      });
      await h.service.start();
      await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: tmpDir });

      await driveDispatch(h, qualifyingMarkdown());

      expect(imagePosts(h)).toHaveLength(0);
      expect(h.replies.join('\n')).toContain('detailed explanation');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});
