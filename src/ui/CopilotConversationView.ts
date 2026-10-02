import { marked } from 'marked';

type CopilotEvent = {
  type: string;
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
  parentId: string | null;
};

type ConversationRole = 'user' | 'assistant' | 'system';

export type ConversationItem =
  | {
      kind: 'message';
      id: string;
      role: ConversationRole;
      content: string;
      streaming?: boolean;
      timestamp: string;
    }
  | {
      kind: 'tool';
      id: string;
      name: string;
      status: 'running' | 'complete' | 'failed';
      detail?: string;
      timestamp: string;
    };

export interface ConversationState {
  items: ConversationItem[];
  inTurn: boolean;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstText(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = stringValue(data[key]);
    if (value) return value;
  }
  return '';
}

function toolId(data: Record<string, unknown>, fallback: string): string {
  return firstText(data, ['toolCallId', 'toolId', 'id']) || fallback;
}

export function reduceConversationEvent(
  state: ConversationState,
  event: CopilotEvent,
): ConversationState {
  const items = [...state.items];
  const data = event.data ?? {};

  switch (event.type) {
    case 'assistant.turn_start':
      return { items, inTurn: true };
    case 'assistant.turn_end':
    case 'session.idle':
      return {
        items: items.map((item) =>
          item.kind === 'message' && item.streaming ? { ...item, streaming: false } : item,
        ),
        inTurn: false,
      };
    case 'user.message': {
      const content = firstText(data, ['content', 'message', 'text', 'input', 'prompt', 'body']);
      if (!content) return state;
      const optimisticIndex = items.findIndex(
        (item) =>
          item.kind === 'message' &&
          item.role === 'user' &&
          item.id.startsWith('local-') &&
          item.content === content,
      );
      if (optimisticIndex >= 0) {
        const optimistic = items[optimisticIndex];
        if (optimistic.kind === 'message') {
          items[optimisticIndex] = { ...optimistic, id: event.id, timestamp: event.timestamp };
        }
        return { items, inTurn: true };
      }
      return {
        items: [
          ...items,
          { kind: 'message', id: event.id, role: 'user', content, timestamp: event.timestamp },
        ],
        inTurn: true,
      };
    }
    case 'assistant.message_delta': {
      const delta = firstText(data, ['deltaContent', 'content', 'delta']);
      if (!delta) return state;
      const messageId = firstText(data, ['messageId']) || event.parentId || event.id;
      const existingIndex = items.findIndex(
        (item) => item.kind === 'message' && item.role === 'assistant' && item.id === messageId,
      );
      if (existingIndex >= 0) {
        const existing = items[existingIndex];
        if (existing.kind === 'message') {
          items[existingIndex] = {
            ...existing,
            content: existing.content + delta,
            streaming: true,
          };
        }
      } else {
        items.push({
          kind: 'message',
          id: messageId,
          role: 'assistant',
          content: delta,
          streaming: true,
          timestamp: event.timestamp,
        });
      }
      return { items, inTurn: true };
    }
    case 'assistant.message': {
      const content = firstText(data, ['content', 'message', 'text']);
      if (!content) return state;
      const messageId = firstText(data, ['messageId']) || event.id;
      const existingIndex = items.findIndex(
        (item) => item.kind === 'message' && item.role === 'assistant' && item.id === messageId,
      );
      if (existingIndex >= 0) {
        const existing = items[existingIndex];
        if (existing.kind === 'message') {
          items[existingIndex] = { ...existing, content, streaming: false };
        }
      } else {
        items.push({
          kind: 'message',
          id: messageId,
          role: 'assistant',
          content,
          timestamp: event.timestamp,
        });
      }
      return { items, inTurn: state.inTurn };
    }
    case 'tool.execution_start': {
      const id = toolId(data, event.id);
      const name = firstText(data, ['toolName', 'name']) || 'Tool';
      const detail = firstText(data, ['status', 'description']);
      items.push({
        kind: 'tool',
        id,
        name,
        status: 'running',
        detail: detail || undefined,
        timestamp: event.timestamp,
      });
      return { items, inTurn: true };
    }
    case 'tool.execution_partial_result': {
      const id = toolId(data, event.parentId || event.id);
      const detail = firstText(data, ['partialOutput', 'output', 'content']);
      if (!detail) return state;
      const index = items.findIndex((item) => item.kind === 'tool' && item.id === id);
      if (index >= 0) {
        const existing = items[index];
        if (existing.kind === 'tool') items[index] = { ...existing, detail };
      }
      return { items, inTurn: state.inTurn };
    }
    case 'tool.execution_complete': {
      const id = toolId(data, event.parentId || event.id);
      const failed = Boolean(data.error) || data.success === false;
      const index = items.findIndex((item) => item.kind === 'tool' && item.id === id);
      if (index >= 0) {
        const existing = items[index];
        if (existing.kind === 'tool') {
          items[index] = {
            ...existing,
            status: failed ? 'failed' : 'complete',
            detail: firstText(data, ['result', 'output']) || existing.detail,
          };
        }
      }
      return { items, inTurn: state.inTurn };
    }
    default:
      return state;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(value: string): string {
  return marked.parse(escapeHtml(value), { async: false, breaks: true }) as string;
}

function ensureStyles(): void {
  if (document.getElementById('copilot-conversation-view-styles')) return;
  const style = document.createElement('style');
  style.id = 'copilot-conversation-view-styles';
  style.textContent = `
    .copilot-conversation {
      display: none;
      height: 100%;
      min-height: 0;
      flex-direction: column;
      color: var(--co-text);
      background:
        radial-gradient(circle at 85% -10%, rgba(111, 142, 216, .13), transparent 32%),
        #0d111b;
      font-family: "Segoe UI", system-ui, sans-serif;
    }
    .copilot-conversation.is-visible { display: flex; }
    .copilot-conversation__notice {
      margin: 12px 16px 0;
      padding: 9px 11px;
      border: 1px solid rgba(111, 142, 216, .22);
      border-radius: 9px;
      color: var(--co-text-secondary);
      background: rgba(111, 142, 216, .07);
      font: 11px "Cascadia Code", Consolas, monospace;
    }
    .copilot-conversation__timeline {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 18px 18px 12px;
      scroll-behavior: smooth;
    }
    .copilot-conversation__empty {
      display: grid;
      place-items: center;
      min-height: 100%;
      color: var(--co-text-muted);
      text-align: center;
    }
    .copilot-conversation__empty-card {
      max-width: 440px;
      padding: 24px;
      border: 1px solid var(--co-border-subtle);
      border-radius: 14px;
      background: rgba(24, 30, 47, .72);
      box-shadow: 0 18px 48px rgba(0, 0, 0, .2);
    }
    .copilot-conversation__empty-title {
      margin-bottom: 7px;
      color: var(--co-heading);
      font-size: 15px;
      font-weight: 700;
    }
    .copilot-conversation__message {
      display: grid;
      grid-template-columns: 30px minmax(0, 1fr);
      gap: 10px;
      margin: 0 auto 16px;
      max-width: 820px;
    }
    .copilot-conversation__message--user { grid-template-columns: minmax(0, 1fr) 30px; }
    .copilot-conversation__avatar {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border: 1px solid var(--co-border);
      border-radius: 8px;
      color: #b8c7ff;
      background: #18223a;
      font: 700 11px "Cascadia Code", Consolas, monospace;
    }
    .copilot-conversation__message--user .copilot-conversation__avatar {
      grid-column: 2;
      color: #c5f2da;
      background: #173328;
    }
    .copilot-conversation__bubble {
      min-width: 0;
      padding: 12px 14px;
      border: 1px solid var(--co-border-subtle);
      border-radius: 12px;
      background: rgba(20, 25, 39, .92);
      box-shadow: 0 8px 20px rgba(0, 0, 0, .12);
    }
    .copilot-conversation__message--user .copilot-conversation__bubble {
      grid-column: 1;
      grid-row: 1;
      justify-self: end;
      width: min(88%, 680px);
      border-color: rgba(74, 222, 128, .18);
      background: rgba(22, 47, 38, .9);
    }
    .copilot-conversation__meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 7px;
      color: var(--co-text-muted);
      font: 10px "Cascadia Code", Consolas, monospace;
      letter-spacing: .02em;
      text-transform: uppercase;
    }
    .copilot-conversation__body {
      color: var(--co-text);
      font-size: 13px;
      line-height: 1.58;
      overflow-wrap: anywhere;
    }
    .copilot-conversation__body > :first-child { margin-top: 0; }
    .copilot-conversation__body > :last-child { margin-bottom: 0; }
    .copilot-conversation__body pre {
      overflow: auto;
      padding: 11px 12px;
      border: 1px solid var(--co-border-subtle);
      border-radius: 8px;
      background: #090d15;
    }
    .copilot-conversation__body code {
      font: 12px "Cascadia Code", Consolas, monospace;
      color: #c8d6ff;
    }
    .copilot-conversation__tool {
      max-width: 770px;
      margin: 0 auto 12px 40px;
      padding: 9px 11px;
      border: 1px solid var(--co-border-subtle);
      border-radius: 9px;
      background: rgba(14, 18, 29, .78);
      font: 11px "Cascadia Code", Consolas, monospace;
    }
    .copilot-conversation__tool-header {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--co-text-secondary);
    }
    .copilot-conversation__tool-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #e5b84b;
      box-shadow: 0 0 0 3px rgba(229, 184, 75, .12);
    }
    .copilot-conversation__tool--complete .copilot-conversation__tool-dot {
      background: #4ade80;
      box-shadow: 0 0 0 3px rgba(74, 222, 128, .12);
    }
    .copilot-conversation__tool--failed .copilot-conversation__tool-dot {
      background: #fb7185;
      box-shadow: 0 0 0 3px rgba(251, 113, 133, .12);
    }
    .copilot-conversation__tool-detail {
      margin-top: 7px;
      color: var(--co-text-muted);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .copilot-conversation__typing {
      max-width: 820px;
      margin: 0 auto 10px;
      color: var(--co-text-muted);
      font: 11px "Cascadia Code", Consolas, monospace;
    }
    .copilot-conversation__composer {
      flex-shrink: 0;
      padding: 12px 16px 14px;
      border-top: 1px solid var(--co-border);
      background: rgba(13, 17, 27, .96);
      backdrop-filter: blur(10px);
    }
    .copilot-conversation__composer-shell {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      max-width: 860px;
      margin: 0 auto;
      padding: 8px 8px 8px 12px;
      border: 1px solid var(--co-border);
      border-radius: 12px;
      background: #121827;
      box-shadow: 0 9px 28px rgba(0, 0, 0, .22);
    }
    .copilot-conversation__input {
      min-height: 28px;
      max-height: 130px;
      resize: none;
      border: 0;
      outline: 0;
      color: var(--co-text-strong);
      background: transparent;
      font: 13px/1.45 "Cascadia Code", Consolas, monospace;
    }
    .copilot-conversation__send {
      align-self: end;
      min-width: 72px;
      height: 32px;
      border: 1px solid rgba(111, 142, 216, .5);
      border-radius: 8px;
      color: #eef2ff;
      background: #385899;
      cursor: pointer;
      font: 700 11px "Cascadia Code", Consolas, monospace;
    }
    .copilot-conversation__send:disabled {
      cursor: default;
      opacity: .45;
    }
    .copilot-conversation__hint {
      max-width: 860px;
      margin: 6px auto 0;
      color: var(--co-text-muted);
      font: 10px "Cascadia Code", Consolas, monospace;
    }
  `;
  document.head.appendChild(style);
}

export class CopilotConversationView {
  readonly element: HTMLDivElement;
  private readonly timeline: HTMLDivElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly states = new Map<string, ConversationState>();
  private officeId: string | null = null;
  private agentId: string | null = null;
  private agentName = 'Copilot';
  private submitInFlight = false;

  constructor(host: HTMLElement) {
    ensureStyles();
    this.element = document.createElement('div');
    this.element.className = 'copilot-conversation';

    const notice = document.createElement('div');
    notice.className = 'copilot-conversation__notice';
    notice.textContent = 'Hosted session · rendered from Copilot SDK events';

    this.timeline = document.createElement('div');
    this.timeline.className = 'copilot-conversation__timeline';

    const composer = document.createElement('div');
    composer.className = 'copilot-conversation__composer';
    const shell = document.createElement('div');
    shell.className = 'copilot-conversation__composer-shell';
    this.input = document.createElement('textarea');
    this.input.className = 'copilot-conversation__input';
    this.input.rows = 1;
    this.input.placeholder = 'Ask Copilot to investigate, edit, or run a command...';
    this.input.addEventListener('input', () => this.updateComposer());
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void this.submit();
      }
    });
    this.sendButton = document.createElement('button');
    this.sendButton.className = 'copilot-conversation__send';
    this.sendButton.textContent = 'Send';
    this.sendButton.addEventListener('click', () => void this.submit());
    shell.appendChild(this.input);
    shell.appendChild(this.sendButton);

    const hint = document.createElement('div');
    hint.className = 'copilot-conversation__hint';
    hint.textContent = 'Enter to send · Shift+Enter for a new line';
    composer.appendChild(shell);
    composer.appendChild(hint);

    this.element.appendChild(notice);
    this.element.appendChild(this.timeline);
    this.element.appendChild(composer);
    host.appendChild(this.element);
    this.updateComposer();
  }

  show(): void {
    this.element.classList.add('is-visible');
  }

  hide(): void {
    this.element.classList.remove('is-visible');
  }

  bind(officeId: string, agentId: string, agentName: string): void {
    this.officeId = officeId;
    this.agentId = agentId;
    this.agentName = agentName;
    const key = this.key(officeId, agentId);
    if (!this.states.has(key)) this.states.set(key, { items: [], inTurn: false });
    this.render();
    this.updateComposer();
  }

  focus(): void {
    requestAnimationFrame(() => this.input.focus());
  }

  appendSystemNotice(content: string): void {
    const state = this.currentState();
    if (!state) return;
    state.items.push({
      kind: 'message',
      id: `system-${Date.now()}`,
      role: 'system',
      content,
      timestamp: new Date().toISOString(),
    });
    this.render();
  }

  handleEvent(agentId: string, event: CopilotEvent): void {
    if (!this.officeId || !this.agentId || agentId !== this.agentId) return;
    const key = this.key(this.officeId, this.agentId);
    const state = this.states.get(key) ?? { items: [], inTurn: false };
    this.states.set(key, reduceConversationEvent(state, event));
    this.render();
    this.updateComposer();
  }

  private async submit(): Promise<void> {
    if (!this.officeId || !this.agentId || this.submitInFlight) return;
    const prompt = this.input.value.trim();
    if (!prompt) return;

    const state = this.currentState();
    if (!state) return;
    state.items.push({
      kind: 'message',
      id: `local-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
    });
    state.inTurn = true;
    this.input.value = '';
    this.submitInFlight = true;
    this.render();
    this.updateComposer();

    try {
      const result = await window.copilotBridge.terminalSubmitPrompt(
        this.officeId,
        this.agentId,
        prompt,
      );
      if (!result.success) throw new Error(result.error || 'Prompt submission failed');
    } catch (error) {
      state.inTurn = false;
      state.items.push({
        kind: 'message',
        id: `error-${Date.now()}`,
        role: 'system',
        content: `Could not send prompt: ${(error as Error).message}`,
        timestamp: new Date().toISOString(),
      });
      this.render();
    } finally {
      this.submitInFlight = false;
      this.updateComposer();
      this.focus();
    }
  }

  private currentState(): ConversationState | null {
    if (!this.officeId || !this.agentId) return null;
    return this.states.get(this.key(this.officeId, this.agentId)) ?? null;
  }

  private key(officeId: string, agentId: string): string {
    return `${officeId}\u0000${agentId}`;
  }

  private updateComposer(): void {
    const state = this.currentState();
    this.sendButton.disabled =
      !this.officeId ||
      !this.agentId ||
      !this.input.value.trim() ||
      this.submitInFlight ||
      Boolean(state?.inTurn);
    this.sendButton.textContent = state?.inTurn ? 'Working' : 'Send';
    this.input.disabled = this.submitInFlight;
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(this.input.scrollHeight, 130)}px`;
  }

  private render(): void {
    const state = this.currentState();
    this.timeline.replaceChildren();

    if (!state || state.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'copilot-conversation__empty';
      const card = document.createElement('div');
      card.className = 'copilot-conversation__empty-card';
      const title = document.createElement('div');
      title.className = 'copilot-conversation__empty-title';
      title.textContent = `${this.agentName} is connected`;
      const body = document.createElement('div');
      body.textContent = 'This view renders messages, tool activity, and streaming responses directly from the hosted Copilot session.';
      card.appendChild(title);
      card.appendChild(body);
      empty.appendChild(card);
      this.timeline.appendChild(empty);
      return;
    }

    for (const item of state.items) {
      if (item.kind === 'tool') {
        this.timeline.appendChild(this.renderTool(item));
      } else {
        this.timeline.appendChild(this.renderMessage(item));
      }
    }

    if (state.inTurn) {
      const typing = document.createElement('div');
      typing.className = 'copilot-conversation__typing';
      typing.textContent = `${this.agentName} is working...`;
      this.timeline.appendChild(typing);
    }

    requestAnimationFrame(() => {
      this.timeline.scrollTop = this.timeline.scrollHeight;
    });
  }

  private renderMessage(item: Extract<ConversationItem, { kind: 'message' }>): HTMLElement {
    const row = document.createElement('article');
    row.className = `copilot-conversation__message copilot-conversation__message--${item.role}`;
    const avatar = document.createElement('div');
    avatar.className = 'copilot-conversation__avatar';
    avatar.textContent = item.role === 'user' ? 'YOU' : item.role === 'system' ? '!' : 'AI';
    const bubble = document.createElement('div');
    bubble.className = 'copilot-conversation__bubble';
    const meta = document.createElement('div');
    meta.className = 'copilot-conversation__meta';
    const label = document.createElement('span');
    label.textContent = item.role === 'user' ? 'You' : item.role === 'system' ? 'System' : this.agentName;
    const time = document.createElement('span');
    const date = new Date(item.timestamp);
    time.textContent = Number.isNaN(date.valueOf())
      ? ''
      : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.appendChild(label);
    meta.appendChild(time);
    const body = document.createElement('div');
    body.className = 'copilot-conversation__body';
    body.innerHTML = renderMarkdown(item.content);
    body.querySelectorAll('a').forEach((link) => {
      const href = link.getAttribute('href') ?? '';
      if (!/^https?:\/\//i.test(href)) link.removeAttribute('href');
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noreferrer');
    });
    bubble.appendChild(meta);
    bubble.appendChild(body);
    row.appendChild(avatar);
    row.appendChild(bubble);
    return row;
  }

  private renderTool(item: Extract<ConversationItem, { kind: 'tool' }>): HTMLElement {
    const tool = document.createElement('div');
    tool.className = `copilot-conversation__tool copilot-conversation__tool--${item.status}`;
    const header = document.createElement('div');
    header.className = 'copilot-conversation__tool-header';
    const dot = document.createElement('span');
    dot.className = 'copilot-conversation__tool-dot';
    const name = document.createElement('strong');
    name.textContent = item.name;
    const status = document.createElement('span');
    status.textContent =
      item.status === 'running' ? 'running' : item.status === 'failed' ? 'failed' : 'complete';
    header.appendChild(dot);
    header.appendChild(name);
    header.appendChild(status);
    tool.appendChild(header);
    if (item.detail) {
      const detail = document.createElement('div');
      detail.className = 'copilot-conversation__tool-detail';
      detail.textContent = item.detail.length > 1200 ? `${item.detail.slice(0, 1200)}...` : item.detail;
      tool.appendChild(detail);
    }
    return tool;
  }
}
