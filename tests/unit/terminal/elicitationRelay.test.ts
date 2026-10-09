import { describe, expect, it } from 'vitest';
import { buildElicitationRelay } from '../../../electron/terminal/events-watcher';

// The server relays a structured ask_user elicitation form as a dedicated copilot-elicitation
// event. buildElicitationRelay is the pure translator the server watcherCallback uses: it
// normalizes the SDK `elicitation.requested` payload (message + requestedSchema.properties)
// into an ordered field model, mirroring buildAskUserRelay / buildPlanRelay.

describe('buildElicitationRelay — field parsing', () => {
  it('returns null for non-elicitation events', () => {
    expect(buildElicitationRelay({ type: 'user_input.requested', data: {} })).toBeNull();
    expect(buildElicitationRelay({ type: 'tool.execution_start', data: { toolName: 'ask_user' } })).toBeNull();
  });

  it('normalizes message, requestId, toolCallId, mode and preserves field order', () => {
    const relay = buildElicitationRelay({
      type: 'elicitation.requested',
      data: {
        requestId: 'eli-1',
        toolCallId: 'tool-7',
        message: 'A few questions',
        mode: 'form',
        requestedSchema: {
          type: 'object',
          required: ['scope'],
          properties: {
            scope: { type: 'string', title: 'Fix scope', enum: ['relay-only', 'full'], enumNames: ['Relay only', 'Full round-trip'] },
            worktree: { type: 'string', title: 'Target', oneOf: [{ const: 'a', title: 'Branch A' }, { const: 'b', title: 'Branch B' }] },
          },
        },
      },
    });
    expect(relay?.requestId).toBe('eli-1');
    expect(relay?.toolId).toBe('tool-7');
    expect(relay?.message).toBe('A few questions');
    expect(relay?.mode).toBe('form');
    expect(relay?.fields.map((f) => f.name)).toEqual(['scope', 'worktree']);

    const [scope, worktree] = relay!.fields;
    expect(scope).toEqual({
      name: 'scope',
      title: 'Fix scope',
      description: '',
      kind: 'select',
      required: true,
      options: [
        { value: 'relay-only', label: 'Relay only' },
        { value: 'full', label: 'Full round-trip' },
      ],
    });
    expect(worktree.kind).toBe('select');
    expect(worktree.required).toBe(false);
    expect(worktree.options).toEqual([
      { value: 'a', label: 'Branch A' },
      { value: 'b', label: 'Branch B' },
    ]);
  });

  it('classifies boolean, number, integer and free-text string fields', () => {
    const relay = buildElicitationRelay({
      type: 'elicitation.requested',
      data: {
        message: '',
        requestedSchema: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean', title: 'Enabled?' },
            port: { type: 'number' },
            retries: { type: 'integer' },
            name: { type: 'string', description: 'Project name' },
          },
        },
      },
    });
    const kinds = Object.fromEntries(relay!.fields.map((f) => [f.name, f.kind]));
    expect(kinds).toEqual({ enabled: 'boolean', port: 'number', retries: 'number', name: 'string' });
    // title falls back to the field name; description is preserved
    expect(relay!.fields.find((f) => f.name === 'port')?.title).toBe('port');
    expect(relay!.fields.find((f) => f.name === 'name')?.description).toBe('Project name');
    // non-select fields carry no options
    expect(relay!.fields.every((f) => (f.kind === 'select' ? true : f.options.length === 0))).toBe(true);
  });

  it('classifies array fields as multiselect with options from items.enum and items.anyOf', () => {
    const relay = buildElicitationRelay({
      type: 'elicitation.requested',
      data: {
        message: '',
        requestedSchema: {
          type: 'object',
          properties: {
            features: { type: 'array', title: 'Features', items: { type: 'string', enum: ['x', 'y'] } },
            platforms: { type: 'array', items: { anyOf: [{ const: 'web', title: 'Web' }, { const: 'ios', title: 'iOS' }] } },
          },
        },
      },
    });
    const features = relay!.fields.find((f) => f.name === 'features')!;
    const platforms = relay!.fields.find((f) => f.name === 'platforms')!;
    expect(features.kind).toBe('multiselect');
    expect(features.options).toEqual([{ value: 'x', label: 'x' }, { value: 'y', label: 'y' }]);
    expect(platforms.kind).toBe('multiselect');
    expect(platforms.options).toEqual([{ value: 'web', label: 'Web' }, { value: 'ios', label: 'iOS' }]);
  });

  it('relays url-mode elicitations with an empty fields list (render-only)', () => {
    const relay = buildElicitationRelay({
      type: 'elicitation.requested',
      data: { requestId: 'eli-u', message: 'Open browser', mode: 'url', url: 'https://x', requestedSchema: { type: 'object', properties: { a: { type: 'string' } } } },
    });
    expect(relay?.mode).toBe('url');
    expect(relay?.fields).toEqual([]);
  });

  it('defaults mode to form and tolerates a missing/empty schema', () => {
    const relay = buildElicitationRelay({ type: 'elicitation.requested', data: { message: 'hi' } });
    expect(relay?.mode).toBe('form');
    expect(relay?.fields).toEqual([]);
    expect(relay?.requestId).toBe('');
  });
});
