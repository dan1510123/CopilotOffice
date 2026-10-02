import { describe, expect, it } from 'vitest';
import {
  reduceConversationEvent,
  type ConversationState,
} from '../../../src/ui/CopilotConversationView';

const empty: ConversationState = { items: [], inTurn: false };

describe('reduceConversationEvent', () => {
  it('streams assistant deltas into one message and finalizes it', () => {
    const first = reduceConversationEvent(empty, {
      type: 'assistant.message_delta',
      data: { messageId: 'm1', deltaContent: 'Hello ' },
      id: 'e1',
      timestamp: '2026-09-25T00:00:00Z',
      parentId: null,
    });
    const second = reduceConversationEvent(first, {
      type: 'assistant.message_delta',
      data: { messageId: 'm1', deltaContent: 'world' },
      id: 'e2',
      timestamp: '2026-09-25T00:00:01Z',
      parentId: null,
    });
    const ended = reduceConversationEvent(second, {
      type: 'assistant.turn_end',
      data: {},
      id: 'e3',
      timestamp: '2026-09-25T00:00:02Z',
      parentId: null,
    });

    expect(ended.items).toEqual([
      expect.objectContaining({
        kind: 'message',
        id: 'm1',
        content: 'Hello world',
        streaming: false,
      }),
    ]);
    expect(ended.inTurn).toBe(false);
  });

  it('tracks tool execution lifecycle', () => {
    const started = reduceConversationEvent(empty, {
      type: 'tool.execution_start',
      data: { toolCallId: 't1', toolName: 'powershell' },
      id: 'e1',
      timestamp: '2026-09-25T00:00:00Z',
      parentId: null,
    });
    const completed = reduceConversationEvent(started, {
      type: 'tool.execution_complete',
      data: { toolCallId: 't1', success: true },
      id: 'e2',
      timestamp: '2026-09-25T00:00:01Z',
      parentId: null,
    });

    expect(completed.items).toEqual([
      expect.objectContaining({
        kind: 'tool',
        id: 't1',
        name: 'powershell',
        status: 'complete',
      }),
    ]);
  });

  it('adds user messages using supported SDK payload fields', () => {
    const state = reduceConversationEvent(empty, {
      type: 'user.message',
      data: { prompt: 'Investigate the timeout' },
      id: 'u1',
      timestamp: '2026-09-25T00:00:00Z',
      parentId: null,
    });

    expect(state.items).toEqual([
      expect.objectContaining({
        kind: 'message',
        role: 'user',
        content: 'Investigate the timeout',
      }),
    ]);
    expect(state.inTurn).toBe(true);
  });

  it('reconciles the SDK user event with an optimistic local message', () => {
    const state = reduceConversationEvent(
      {
        items: [{
          kind: 'message',
          id: 'local-1',
          role: 'user',
          content: 'Run the smoke test',
          timestamp: '2026-09-25T00:00:00Z',
        }],
        inTurn: true,
      },
      {
        type: 'user.message',
        data: { content: 'Run the smoke test' },
        id: 'user-event-1',
        timestamp: '2026-09-25T00:00:01Z',
        parentId: null,
      },
    );

    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toEqual(expect.objectContaining({ id: 'user-event-1' }));
  });
});
