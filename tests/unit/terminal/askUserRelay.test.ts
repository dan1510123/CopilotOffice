import { describe, expect, it } from 'vitest';
import { buildAskUserRelay, normalizeAskUserArgs, formatToolStatus } from '../../../electron/terminal/events-watcher';

// spec 015 — the server relays an ask_user interaction as a dedicated additive
// copilot-ask-user event IN ADDITION to the unchanged copilot-tool-start (FR-016).
// buildAskUserRelay is the pure translator the server watcherCallback uses.

describe('buildAskUserRelay — SDK/ui-server (user_input.requested, native payload)', () => {
  it('normalizes the native fields incl. the requestId single-resolution key', () => {
    const relay = buildAskUserRelay(
      {
        type: 'user_input.requested',
        data: {
          requestId: 'req-1',
          toolCallId: 'tool-9',
          question: 'Which database?',
          choices: ['PostgreSQL', 'MySQL', 'SQLite'],
          allowFreeform: false,
        },
      },
      'ui-server',
    );
    expect(relay).toEqual({
      toolId: 'tool-9',
      requestId: 'req-1',
      question: 'Which database?',
      options: [{ text: 'PostgreSQL' }, { text: 'MySQL' }, { text: 'SQLite' }],
      freeform: false,
    });
  });

  it('coerces allowFreeform and object-shaped choices', () => {
    const relay = buildAskUserRelay(
      {
        type: 'user_input.requested',
        data: {
          requestId: 'req-2',
          toolCallId: 'tool-2',
          question: 'Pick one',
          choices: [{ label: 'Red' }, { value: 'Green' }, { text: 'Blue' }],
          allowFreeform: 1,
        },
      },
      'copilot-sdk',
    );
    expect(relay?.freeform).toBe(true);
    expect(relay?.options).toEqual([{ text: 'Red' }, { text: 'Green' }, { text: 'Blue' }]);
    expect(relay?.requestId).toBe('req-2');
  });

  // The static tool-start label the server also emits stays byte-for-byte (FR-016).
  it('leaves the ask_user tool-start status untouched', () => {
    expect(formatToolStatus('ask_user', { question: 'x', options: ['a'] })).toBe('Waiting for your answer');
  });
});

describe('buildAskUserRelay — node-pty degraded path (tool.execution_start)', () => {
  it('normalizes ask_user arguments best-effort with empty requestId', () => {
    const relay = buildAskUserRelay(
      {
        type: 'tool.execution_start',
        data: {
          toolName: 'ask_user',
          toolCallId: 'tool-3',
          arguments: { prompt: 'Proceed?', choices: ['Yes', 'No'], allowFreeform: true },
        },
      },
      'node-pty',
    );
    expect(relay).toEqual({
      toolId: 'tool-3',
      requestId: '',
      question: 'Proceed?',
      options: [{ text: 'Yes' }, { text: 'No' }],
      freeform: true,
    });
  });

  it('does NOT relay ask_user tool.execution_start on the SDK/ui-server backend (avoids duplicate)', () => {
    const relay = buildAskUserRelay(
      {
        type: 'tool.execution_start',
        data: { toolName: 'ask_user', toolCallId: 'tool-4', arguments: { question: 'q', options: ['a'] } },
      },
      'ui-server',
    );
    expect(relay).toBeNull();
  });

  it('returns null for a non-ask_user tool (no copilot-ask-user; tool-start unchanged) — FR-016', () => {
    const relay = buildAskUserRelay(
      {
        type: 'tool.execution_start',
        data: { toolName: 'view', toolCallId: 'tool-5', arguments: { path: '/x/y.ts' } },
      },
      'node-pty',
    );
    expect(relay).toBeNull();
    // the generic tool-start still describes the tool normally.
    expect(formatToolStatus('view', { path: '/x/y.ts' })).toContain('Reading');
  });
});

describe('normalizeAskUserArgs — upstream key-name tolerance', () => {
  it('accepts question/options string[]', () => {
    expect(normalizeAskUserArgs({ question: 'Q?', options: ['A', 'B'] })).toEqual({
      question: 'Q?',
      options: [{ text: 'A' }, { text: 'B' }],
      freeform: false,
    });
  });

  it('accepts prompt/choices {label,value}[] and a freeText flag', () => {
    expect(
      normalizeAskUserArgs({ prompt: 'P?', choices: [{ label: 'One' }, { value: 'Two' }], freeText: true }),
    ).toEqual({ question: 'P?', options: [{ text: 'One' }, { text: 'Two' }], freeform: true });
  });

  it('degrades to empty options and false freeform when absent', () => {
    expect(normalizeAskUserArgs({})).toEqual({ question: '', options: [], freeform: false });
    expect(normalizeAskUserArgs(undefined)).toEqual({ question: '', options: [], freeform: false });
  });
});
