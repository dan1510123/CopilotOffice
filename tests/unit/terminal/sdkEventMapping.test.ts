import { describe, expect, it, vi } from 'vitest';
import { mapSdkEventToCopilotEvent, SdkEventSource } from '../../../electron/terminal/event-source';

describe('mapSdkEventToCopilotEvent', () => {
  it.each([
    ['assistant.turn_start', { sequence: 1 }],
    ['assistant.turn_end', { sequence: 2 }],
    ['assistant.message', { content: 'hello from assistant' }],
    [
      'tool.execution_start',
      {
        toolName: 'view',
        toolCallId: 'tool-1',
        arguments: { path: 'C:\\repo\\file.ts' },
      },
    ],
    ['tool.execution_complete', { toolCallId: 'tool-1', success: true }],
    ['user.message', { content: 'hello from user' }],
    ['subagent.started', { id: 'agent-1', name: 'Scout' }],
    ['subagent.completed', { id: 'agent-1', result: 'done' }],
    ['subagent.failed', { id: 'agent-1', error: 'failed' }],
    ['system.notification', { title: 'notice', message: 'done' }],
    ['assistant.message_delta', { content: 'partial' }],
    ['session.idle', { reason: 'turn_settled' }],
  ])('normalizes %s and preserves data', (type, data) => {
    const event = mapSdkEventToCopilotEvent({ type, data });

    expect(event.type).toBe(type);
    expect(event.data).toEqual(data);
    expect(event.id).toEqual(expect.any(String));
    expect(event.timestamp).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
    expect(event.parentId).toBeNull();
  });

  it('preserves unknown event types verbatim', () => {
    const event = mapSdkEventToCopilotEvent({
      type: 'sdk.future_event',
      data: { value: 42 },
    });

    expect(event.type).toBe('sdk.future_event');
    expect(event.data).toEqual({ value: 42 });
  });

  it('preserves SDK metadata when supplied', () => {
    const event = mapSdkEventToCopilotEvent({
      type: 'assistant.message',
      data: { content: 'hello' },
      id: 'sdk-event-1',
      timestamp: '2026-07-08T23:37:29.768Z',
      parentId: 'parent-1',
    });

    expect(event).toEqual({
      type: 'assistant.message',
      data: { content: 'hello' },
      id: 'sdk-event-1',
      timestamp: '2026-07-08T23:37:29.768Z',
      parentId: 'parent-1',
    });
  });

  it('falls back to top-level payload fields when data is absent', () => {
    const event = mapSdkEventToCopilotEvent({
      type: 'assistant.message',
      content: 'top-level content',
    });

    expect(event.data).toEqual({ content: 'top-level content' });
  });
});

describe('SdkEventSource', () => {
  it('subscribes to live SDK events and emits non-historical CopilotEvents', () => {
    const unsubscribe = vi.fn();
    let handler: ((evt: unknown) => void) | null = null;
    const source = new SdkEventSource('session-1', {
      on: (registeredHandler: (evt: unknown) => void) => {
        handler = registeredHandler;
        return unsubscribe;
      },
    });
    const onEvent = vi.fn();

    source.start(onEvent);
    handler?.({ type: 'session.idle', data: { reason: 'ready' } });
    source.stop();
    source.stop();

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session.idle',
        data: { reason: 'ready' },
        parentId: null,
      }),
      false,
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(source.getSessionId()).toBe('session-1');
  });
});
