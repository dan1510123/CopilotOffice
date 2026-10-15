import { describe, expect, it, vi } from 'vitest';
import { SdkEventSource } from '../../../electron/terminal/event-source';

function setup(now = Date.parse('2026-10-14T12:00:00Z')) {
  let handler: (evt: unknown) => void = () => undefined;
  const onReady = vi.fn();
  const source = new SdkEventSource('s1', { on: (h) => { handler = h; return () => undefined; } }, { onReady, now: () => now });
  const onEvent = vi.fn();
  source.start(onEvent);
  return { source, onEvent, onReady, emit: (e: unknown) => handler(e) };
}

describe('SdkEventSource ready detection and replay guard', () => {
  it('flags old pre-ready events as historical and fires onReady on session.idle', () => {
    const { source, onEvent, onReady, emit } = setup();
    emit({ type: 'tool.execution_start', timestamp: '2026-10-14T11:00:00Z', data: {} });
    emit({ type: 'user.message', timestamp: '2026-10-14T12:00:01Z', data: {} });
    expect(onEvent.mock.calls[0][1]).toBe(true);
    expect(onEvent.mock.calls[1][1]).toBe(false);
    expect(source.isReady()).toBe(false);

    emit({ type: 'session.idle', timestamp: '2026-10-14T12:00:02Z', data: {} });
    expect(source.isReady()).toBe(true);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('first assistant.turn_end also marks ready, only once', () => {
    const { onReady, emit } = setup();
    emit({ type: 'assistant.turn_end', data: {} });
    emit({ type: 'session.idle', data: {} });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('after ready, even older timestamps are treated as live', () => {
    const { onEvent, emit } = setup();
    emit({ type: 'session.idle', data: {} });
    emit({ type: 'subagent.started', timestamp: '2026-10-14T01:00:00Z', data: {} });
    expect(onEvent.mock.calls[1][1]).toBe(false);
  });

  it('keeps fleet-critical and ask_user events intact', () => {
    const { onEvent, emit } = setup();
    for (const type of ['subagent.started', 'system.notification', 'user_input.requested', 'user_input.completed']) {
      emit({ type, data: { requestId: 'r1' } });
    }
    expect(onEvent.mock.calls.map((c) => c[0].type)).toEqual([
      'subagent.started', 'system.notification', 'user_input.requested', 'user_input.completed',
    ]);
    expect(onEvent.mock.calls[2][0].data).toEqual({ requestId: 'r1' });
  });
});
