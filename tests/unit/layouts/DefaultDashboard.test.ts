import { describe, expect, it, vi } from 'vitest';
import { defaultDashboard } from '../../../src/layouts/default/DefaultDashboard';
import { defaultClickHandler } from '../../../src/layouts/default/DefaultClickHandler';
import { AgentConfig } from '../../../src/config/agents';
import { OfficeData } from '../../../src/office/officeManager';
import { DashboardRenderContext } from '../../../src/layouts/types';

// Minimal AgentConfig stub. The dashboard renderer reads `color` and a handful
// of other fields; everything else defaults safely on undefined casts.
function agent(id: string, name = id): AgentConfig {
  return {
    id,
    name,
    description: 'desc',
    color: 0x6677ff,
    tilePosition: { x: 0, y: 0 },
    workingDir: '.',
    spriteOptions: { skinTone: '#fff', shirtColor: '#000', pantsColor: '#000', hairColor: '#000', hairStyle: 'short' as any },
  } as AgentConfig;
}

function office(): OfficeData {
  const agents = new Map<string, any>();
  agents.set('a1', { state: 'active', startedAt: Date.now(), reason: '' });
  return {
    config: { id: 'office-0', name: 'O', workingDirectory: '.', createdAt: 1, layout: 'default' as const, seatedAgents: [] },
    agents,
    agentTools: new Map(),
  } as unknown as OfficeData;
}

function ctx(meta: Record<string, { title: string; sessionId?: string }>): DashboardRenderContext {
  return {
    agents: [agent('a1', 'Alice')],
    office: office(),
    selectedAgentId: 'a1',
    cachedSessionMeta: meta,
    agentTools: new Map(),
    formatElapsed: () => '0s',
    formatRelativeTime: () => 'now',
  };
}

describe('DefaultDashboard — session info panel enhancements', () => {
  it('renders the Close Session button alongside New Session for an active agent', () => {
    const html = defaultDashboard.renderCards(ctx({ a1: { title: 'My session' } }));
    expect(html).toContain('class="session-new-btn"');
    expect(html).toContain('class="session-close-btn"');
    // Close button must carry the same data-agent attribute for delegation.
    expect(html).toMatch(/class="session-close-btn"[^>]*data-agent="a1"/);
    // Close button visually distinct (red-ish) and labeled.
    expect(html).toMatch(/class="session-close-btn"[\s\S]*Close Session/);
  });

  it('renders a session-id badge with the full id when sessionId is present', () => {
    const fullId = 'abcdef12-3456-7890-abcd-ef1234567890';
    const html = defaultDashboard.renderCards(
      ctx({ a1: { title: 'titled', sessionId: fullId } }),
    );
    expect(html).toContain('class="session-id-badge"');
    // Full id rendered verbatim (no truncation).
    expect(html).toContain(`>${fullId}</div>`);
    // Full id also exposed via data attribute for robust click-to-copy.
    expect(html).toContain(`data-session-id="${fullId}"`);
    // Tooltip surfaces the id too.
    expect(html).toContain(`title="Click to copy: ${fullId}"`);
  });

  it('omits the session-id badge when no sessionId is in the cache (back-compat)', () => {
    const html = defaultDashboard.renderCards(ctx({ a1: { title: 'titled' } }));
    expect(html).not.toContain('class="session-id-badge"');
    // Other session-info chrome must still render.
    expect(html).toContain('Session Info');
    expect(html).toContain('class="session-title-display"');
  });

  it('shows "Untitled session" with full sessionId badge when title is empty but sessionId exists', () => {
    const fullId = '11111111-1111-1111-1111-111111111111';
    const html = defaultDashboard.renderCards(
      ctx({ a1: { title: '', sessionId: fullId } }),
    );
    expect(html).toContain('Untitled session');
    expect(html).toContain('class="session-id-badge"');
    expect(html).toContain(`>${fullId}</div>`);
  });
});

describe('DefaultClickHandler — Close Session routing', () => {
  it('routes a .session-close-btn click to context.closeSession', () => {
    const startSessionMetaEdit = vi.fn();
    const startNewSession = vi.fn();
    const closeSession = vi.fn();
    // Build a DOM-ish target chain: target is the button itself, .closest()
    // honors the selector via jsdom.
    document.body.innerHTML = `
      <div class="session-meta-panel" data-agent="a1">
        <button class="session-close-btn" data-agent="a1">Close</button>
      </div>`;
    const target = document.querySelector('.session-close-btn') as HTMLElement;
    defaultClickHandler.handleMetaPanelClick(target, 'a1', {
      startSessionMetaEdit,
      startNewSession,
      closeSession,
    });
    expect(closeSession).toHaveBeenCalledWith('a1');
    expect(startNewSession).not.toHaveBeenCalled();
    expect(startSessionMetaEdit).not.toHaveBeenCalled();
  });

  it('still routes .session-new-btn to startNewSession (no regression)', () => {
    const startSessionMetaEdit = vi.fn();
    const startNewSession = vi.fn();
    const closeSession = vi.fn();
    document.body.innerHTML = `
      <div class="session-meta-panel" data-agent="a1">
        <button class="session-new-btn" data-agent="a1">New</button>
      </div>`;
    const target = document.querySelector('.session-new-btn') as HTMLElement;
    defaultClickHandler.handleMetaPanelClick(target, 'a1', {
      startSessionMetaEdit,
      startNewSession,
      closeSession,
    });
    expect(startNewSession).toHaveBeenCalledWith('a1');
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('still routes .session-edit-btn to startSessionMetaEdit (no regression)', () => {
    const startSessionMetaEdit = vi.fn();
    const startNewSession = vi.fn();
    const closeSession = vi.fn();
    document.body.innerHTML = `
      <div class="session-meta-panel" data-agent="a1">
        <button class="session-edit-btn" data-agent="a1">Edit</button>
      </div>`;
    const target = document.querySelector('.session-edit-btn') as HTMLElement;
    defaultClickHandler.handleMetaPanelClick(target, 'a1', {
      startSessionMetaEdit,
      startNewSession,
      closeSession,
    });
    expect(startSessionMetaEdit).toHaveBeenCalledWith('a1');
    expect(closeSession).not.toHaveBeenCalled();
    expect(startNewSession).not.toHaveBeenCalled();
  });
});
