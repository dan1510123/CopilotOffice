import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultDashboard } from '../../../src/layouts/default/DefaultDashboard';
import { fleetDashboard } from '../../../src/layouts/fleet/FleetDashboard';
import { AgentConfig } from '../../../src/config/agents';
import { OfficeData, AgentStatus } from '../../../src/office/officeManager';
import { DashboardRenderContext } from '../../../src/layouts/types';
import {
  STATUS_PRESENTATION,
  type StatusKey,
} from '../../../src/config/agentStatusPresentation';

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

function status(overrides: Partial<AgentStatus>): AgentStatus {
  return {
    agentId: 'a1',
    state: 'active',
    subState: 'thinking',
    thinkingDetail: null,
    currentTool: null,
    completionPendingAck: false,
    unreadCount: 0,
    lastEvent: null,
    activityStartTime: null,
    lastCompletedAction: null,
    recentActions: [],
    taskSummary: null,
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

// Status inputs that exercise every presentation key (via resolveStatusKey folding).
const STATUS_CASES: Array<{ key: StatusKey; st: AgentStatus }> = [
  { key: 'starting', st: status({ subState: 'starting' }) },
  { key: 'ready',    st: status({ subState: 'ready', completionPendingAck: false }) },
  { key: 'done',     st: status({ subState: 'ready', completionPendingAck: true }) },
  { key: 'waiting',  st: status({ subState: 'waiting' }) },
  { key: 'thinking', st: status({ subState: 'thinking' }) },
  { key: 'error',    st: status({ subState: 'error' }) },
];

describe('dashboard status consistency (spec 014)', () => {
  it.each(STATUS_CASES)('Default and Fleet both render the canonical label + icon for $key', ({ key, st }) => {
    const pres = STATUS_PRESENTATION[key];
    const defaultHtml = defaultDashboard.renderCards(ctx(st));
    const fleetHtml = fleetDashboard.renderCards(ctx(st));

    // Both surfaces show the same canonical label and icon for the same state.
    expect(defaultHtml).toContain(pres.label);
    expect(defaultHtml).toContain(pres.icon);
    expect(fleetHtml).toContain(pres.label);
    expect(fleetHtml).toContain(pres.icon);

    // Both surfaces use the same canonical color for the status accent.
    expect(defaultHtml).toContain(pres.colorHex);
    expect(fleetHtml).toContain(pres.colorHex);
  });

  it('renders the canonical thinking icon (🧠) not the old dashboard ⚡', () => {
    const html = defaultDashboard.renderCards(ctx(status({ subState: 'thinking' })));
    expect(html).toContain('🧠');
    // The primary status label must NOT be present as ⚡ (the pre-revamp drift).
    expect(html).not.toContain('⚡ Thinking');
  });

  it('keeps the primary Thinking label concise (no "Thinking: <detail>" in the label)', () => {
    const html = defaultDashboard.renderCards(
      ctx(status({ subState: 'thinking', thinkingDetail: 'processing a very long detail string' })),
    );
    // The concise canonical label is present...
    expect(html).toContain('Thinking');
    // ...but the label is never the concatenated "Thinking: ..." form.
    expect(html).not.toContain('Thinking: processing a very long detail string');
  });
});

describe('no stray status literals outside the canonical module (spec 014 FR-007)', () => {
  const root = join(__dirname, '..', '..', '..');
  const surfaces = [
    'src/entities/NPC.ts',
    'src/layouts/default/DefaultDashboard.ts',
    'src/layouts/fleet/FleetDashboard.ts',
    'src/ui/NotificationService.ts',
  ];

  it.each(surfaces)('%s no longer hardcodes status colors or the old ⚡ thinking icon', (rel) => {
    const src = readFileSync(join(root, rel), 'utf8');
    // Pre-revamp per-surface status color literals must be gone (now sourced from config).
    for (const hex of ['#50fa7b', '#ff9944', '#ffb86c', '#4a78ff']) {
      expect(src).not.toContain(hex);
    }
    // The drifted thinking icon must not reappear on any surface.
    expect(src).not.toContain('⚡');
  });
});
