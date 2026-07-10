import { describe, expect, it } from 'vitest';
import { defaultDashboard } from '../../../src/layouts/default/DefaultDashboard';
import { fleetDashboard } from '../../../src/layouts/fleet/FleetDashboard';
import { AgentConfig } from '../../../src/config/agents';
import { OfficeData, AgentStatus } from '../../../src/office/officeManager';
import { DashboardRenderContext } from '../../../src/layouts/types';
import { computeStall, STALL_THRESHOLD_MS } from '../../../src/config/agentStatusPresentation';

function agent(id: string, name = id): AgentConfig {
  return {
    id, name, description: 'desc', color: 0x6677ff,
    tilePosition: { x: 0, y: 0 }, workingDir: '.',
    spriteOptions: { skinTone: '#fff', shirtColor: '#000', pantsColor: '#000', hairColor: '#000', hairStyle: 'short' as any },
  } as AgentConfig;
}

function status(overrides: Partial<AgentStatus>): AgentStatus {
  return {
    agentId: 'a1', state: 'active', subState: 'thinking', thinkingDetail: null,
    currentTool: null, completionPendingAck: false, unreadCount: 0, lastEvent: null,
    activityStartTime: null, lastCompletedAction: null, recentActions: [], taskSummary: null,
    ...overrides,
  };
}

function officeWith(st: AgentStatus): OfficeData {
  const agents = new Map<string, AgentStatus>();
  agents.set('a1', st);
  return {
    config: { id: 'office-0', name: 'O', workingDirectory: '.', createdAt: 1, layout: 'default' as const, seatedAgents: [] },
    agents,
    agentTools: new Map(),
  } as unknown as OfficeData;
}

function ctx(st: AgentStatus): DashboardRenderContext {
  return {
    agents: [agent('a1', 'Alice')],
    office: officeWith(st),
    selectedAgentId: 'a1',
    cachedSessionMeta: {},
    agentTools: new Map(),
    formatElapsed: () => '0:00',
    formatRelativeTime: () => 'now',
  };
}

const CARD_STATES: AgentStatus[] = [
  status({ subState: 'starting' }),
  status({ subState: 'ready' }),
  status({ subState: 'ready', completionPendingAck: true }),
  status({ subState: 'waiting' }),
  status({ subState: 'thinking' }),
  status({ subState: 'thinking', thinkingDetail: 'x'.repeat(400) }), // pathologically long
  status({ subState: 'error' }),
  status({ state: 'slacking', subState: null }),
];

describe('dashboard card height stability (spec 014 FR-015 / SC-009)', () => {
  it('default card keeps a single fixed min-height across every state (incl. long detail)', () => {
    const heights = new Set<string>();
    for (const st of CARD_STATES) {
      const html = defaultDashboard.renderCards(ctx(st));
      const m = html.match(/min-height:\s*236px/g);
      expect(m, `expected fixed 236px card in state ${st.subState}`).toBeTruthy();
      // The activity-detail slot is always a fixed 18px line — never grows.
      expect(html).toContain('data-activity-detail-agent="a1"');
      expect(html).toContain('height: 18px');
      heights.add(m!.length.toString());
    }
    // Same number of fixed-height cards emitted regardless of state.
    expect(heights.size).toBe(1);
  });

  it('a long thinking detail never lands in the primary label (stays "Thinking")', () => {
    const html = defaultDashboard.renderCards(ctx(status({ subState: 'thinking', thinkingDetail: 'y'.repeat(300) })));
    // Concise label present; no "Thinking: <detail>" concatenation anywhere.
    expect(html).toContain('Thinking');
    expect(html).not.toContain('Thinking: ');
    // The long detail lives only in the fixed-height detail slot.
    expect(html).toContain('y'.repeat(300));
  });

  it('fleet card also keeps a fixed min-height + fixed detail slot across states', () => {
    for (const st of CARD_STATES) {
      const html = fleetDashboard.renderCards(ctx(st));
      expect(html).toMatch(/min-height:\s*124px/);
      expect(html).toContain('data-activity-detail-agent="a1"');
      expect(html).toContain('height: 16px');
    }
  });
});

describe('stall detection past threshold (spec 014 FR-013 / SC-007)', () => {
  const now = 2_000_000;

  it('flips to stalled once an active agent sits in-state past the threshold', () => {
    const justUnder = status({ subState: 'thinking', activityStartTime: now - STALL_THRESHOLD_MS + 500 });
    const justOver = status({ subState: 'thinking', activityStartTime: now - STALL_THRESHOLD_MS - 1 });
    expect(computeStall(justUnder, now).isStalled).toBe(false);
    expect(computeStall(justOver, now).isStalled).toBe(true);
  });

  it('clears the stall as soon as activity resumes (fresh activityStartTime)', () => {
    const stalled = status({ subState: 'thinking', activityStartTime: now - STALL_THRESHOLD_MS - 5000 });
    expect(computeStall(stalled, now).isStalled).toBe(true);
    const resumed = { ...stalled, activityStartTime: now }; // new turn/tool resets the clock
    expect(computeStall(resumed, now).isStalled).toBe(false);
  });

  it('never marks the error state as stalled (distinct treatment)', () => {
    const erroredLongAgo = status({ subState: 'error', activityStartTime: now - STALL_THRESHOLD_MS * 10 });
    expect(computeStall(erroredLongAgo, now).isStalled).toBe(false);
  });

  it('never marks idle (ready/done/slacking) as stalled', () => {
    expect(computeStall(status({ subState: 'ready', activityStartTime: now - STALL_THRESHOLD_MS * 5 }), now).isStalled).toBe(false);
    expect(computeStall(status({ state: 'slacking', subState: null, activityStartTime: now - STALL_THRESHOLD_MS * 5 }), now).isStalled).toBe(false);
  });
});
