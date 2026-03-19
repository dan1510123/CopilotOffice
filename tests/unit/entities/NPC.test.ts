import { describe, expect, it, vi } from 'vitest';
import { NPC } from '../../../src/entities/NPC';

function createStatus(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'generalist',
    state: 'active',
    subState: 'thinking',
    thinkingDetail: null,
    currentTool: null,
    unreadCount: 0,
    lastEvent: null,
    activityStartTime: null,
    lastCompletedAction: null,
    recentActions: [],
    taskSummary: null,
    ...overrides,
  };
}

describe('entities/NPC', () => {
  it('maps active status to badge icon/state updates', () => {
    const fakeNpc = {
      hasActiveSession: false,
      badgeHidden: false,
      updateBadgeForState: vi.fn(),
      sessionText: {
        setText: vi.fn(),
        setVisible: vi.fn(),
      },
    };

    (NPC.prototype as any).updateAgentStatus.call(fakeNpc, createStatus({ subState: 'thinking' }));

    expect(fakeNpc.hasActiveSession).toBe(true);
    expect(fakeNpc.updateBadgeForState).toHaveBeenCalledWith('thinking');
    expect(fakeNpc.sessionText.setText).toHaveBeenCalledWith('🧠');
    expect(fakeNpc.sessionText.setVisible).toHaveBeenCalledWith(true);
  });

  it('sets slacking visual state when status is slacking/undefined', () => {
    const fakeNpc = {
      hasActiveSession: true,
      badgeHidden: false,
      updateBadgeForState: vi.fn(),
      sessionText: {
        setText: vi.fn(),
        setVisible: vi.fn(),
      },
    };

    (NPC.prototype as any).updateAgentStatus.call(fakeNpc, createStatus({ state: 'slacking', subState: null }));

    expect(fakeNpc.hasActiveSession).toBe(false);
    expect(fakeNpc.updateBadgeForState).toHaveBeenCalledWith('slacking');
    expect(fakeNpc.sessionText.setText).toHaveBeenCalledWith('💤');
  });

  it('destroys attached child objects during cleanup', () => {
    const npc = Object.create(NPC.prototype) as any;
    const child = () => ({ destroy: vi.fn() });
    npc.nameLabel = child();
    npc.descriptionLabel = child();
    npc.indicator = child();
    npc.highlightGlow = child();
    npc.highlightRing = child();
    npc.sessionBadge = child();
    npc.sessionText = child();

    const baseProto = Object.getPrototypeOf(NPC.prototype) as { destroy?: () => void };
    const originalDestroy = baseProto.destroy;
    const superDestroy = vi.fn();
    baseProto.destroy = superDestroy;
    (NPC.prototype as any).destroy.call(npc);

    expect(npc.nameLabel.destroy).toHaveBeenCalled();
    expect(npc.descriptionLabel.destroy).toHaveBeenCalled();
    expect(npc.indicator.destroy).toHaveBeenCalled();
    expect(npc.highlightGlow.destroy).toHaveBeenCalled();
    expect(npc.highlightRing.destroy).toHaveBeenCalled();
    expect(npc.sessionBadge.destroy).toHaveBeenCalled();
    expect(npc.sessionText.destroy).toHaveBeenCalled();
    expect(superDestroy).toHaveBeenCalled();
    baseProto.destroy = originalDestroy;
  });
});

