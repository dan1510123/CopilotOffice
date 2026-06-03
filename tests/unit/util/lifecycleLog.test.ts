import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetLifecycleSubscribersForTesting,
  logLifecycleTransition,
  subscribeToLifecycle,
  type LifecycleTransition,
} from '../../../src/util/lifecycleLog';

describe('util/lifecycleLog', () => {
  let captured: LifecycleTransition[];
  let unsubscribe: () => void;

  beforeEach(() => {
    _resetLifecycleSubscribersForTesting();
    captured = [];
    unsubscribe = subscribeToLifecycle((t) => captured.push(t));
  });

  afterEach(() => {
    unsubscribe();
    _resetLifecycleSubscribersForTesting();
  });

  it('emits a transition with a timestamp stamped at log time', () => {
    const before = Date.now();
    logLifecycleTransition({
      agentId: 'gene',
      officeId: 'office-0',
      from: 'ready',
      to: 'thinking',
      reason: 'tool_start',
      detail: 'edit',
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].agentId).toBe('gene');
    expect(captured[0].from).toBe('ready');
    expect(captured[0].to).toBe('thinking');
    expect(captured[0].reason).toBe('tool_start');
    expect(captured[0].detail).toBe('edit');
    expect(captured[0].timestamp).toBeGreaterThanOrEqual(before);
  });

  it('suppresses self-transitions at the source', () => {
    logLifecycleTransition({
      agentId: 'gene',
      officeId: 'office-0',
      from: 'ready',
      to: 'ready',
    });
    expect(captured).toHaveLength(0);
  });

  it('fans out to multiple subscribers', () => {
    const second: LifecycleTransition[] = [];
    const unsub2 = subscribeToLifecycle((t) => second.push(t));

    logLifecycleTransition({
      agentId: 'gene',
      officeId: 'office-0',
      from: 'slacking',
      to: 'starting',
    });

    expect(captured).toHaveLength(1);
    expect(second).toHaveLength(1);
    unsub2();
  });

  it('isolates subscriber errors so the producer is never broken', () => {
    subscribeToLifecycle(() => {
      throw new Error('boom');
    });

    expect(() =>
      logLifecycleTransition({
        agentId: 'gene',
        officeId: 'office-0',
        from: 'starting',
        to: 'ready',
      })
    ).not.toThrow();

    // The well-behaved subscriber still received the transition.
    expect(captured).toHaveLength(1);
  });

  it('unsubscribe stops further delivery', () => {
    unsubscribe();
    logLifecycleTransition({
      agentId: 'gene',
      officeId: 'office-0',
      from: 'ready',
      to: 'waiting',
    });
    expect(captured).toHaveLength(0);
  });
});

describe('util/lifecycleLog — integration with OfficeManager', () => {
  beforeEach(() => {
    _resetLifecycleSubscribersForTesting();
    localStorage.clear();
  });

  it('emits structured transitions when OfficeManager.setAgent* mutates state', async () => {
    const { OfficeManager } = await import('../../../src/office/officeManager');
    const manager = new OfficeManager();
    manager.ensureDefaultOffice();
    const officeId = manager.currentOfficeId!;

    const events: LifecycleTransition[] = [];
    const unsub = subscribeToLifecycle((t) => events.push(t));

    manager.setAgentStarting(officeId, 'generalist', 'preload');
    manager.setAgentReady(officeId, 'generalist', 'ready_signal');
    manager.setAgentThinking(officeId, 'generalist', 'edit', 'tool_start');
    manager.setAgentWaiting(officeId, 'generalist', 'ask_user');
    // ask_user race scenario: thinking → waiting → waiting (self-transition suppressed)
    manager.setAgentWaiting(officeId, 'generalist', 'ask_user');
    manager.setAgentReady(officeId, 'generalist', 'turn_end');

    unsub();

    const fromTo = events.map((e) => `${e.from}→${e.to}`);
    expect(fromTo).toEqual([
      'slacking→starting',
      'starting→ready',
      'ready→thinking',
      'thinking→waiting',
      // self-transition waiting→waiting must NOT appear
      'waiting→ready',
    ]);
    // ask_user reason should be present on the waiting transition.
    const askUser = events.find((e) => e.to === 'waiting');
    expect(askUser?.reason).toBe('ask_user');
  });
});
