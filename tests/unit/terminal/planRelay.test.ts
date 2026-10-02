import { describe, expect, it } from 'vitest';
import { buildPlanRelay } from '../../../electron/terminal/events-watcher';

// Plan mode wrapper — the server relays an exit_plan_mode interaction as a dedicated
// additive copilot-plan event. buildPlanRelay is the pure translator the server
// watcherCallback uses (mirrors buildAskUserRelay).

describe('buildPlanRelay — SDK/native-bridge (exit_plan_mode.requested, native payload)', () => {
  it('normalizes the native fields incl. the requestId single-resolution key', () => {
    const relay = buildPlanRelay(
      {
        type: 'exit_plan_mode.requested',
        data: {
          requestId: 'req-7',
          toolCallId: 'tool-9',
          summary: '- do a\n- do b',
          planContent: '# Plan\n- do a\n- do b',
          actions: ['interactive', 'autopilot'],
          recommendedAction: 'interactive',
        },
      },
      'sdk',
    );
    expect(relay).toEqual({
      toolId: 'tool-9',
      requestId: 'req-7',
      summary: '- do a\n- do b',
      planContent: '# Plan\n- do a\n- do b',
      actions: ['interactive', 'autopilot'],
      recommendedAction: 'interactive',
    });
  });

  it('coerces missing/blank fields to empty defaults and filters empty actions', () => {
    const relay = buildPlanRelay(
      {
        type: 'exit_plan_mode.requested',
        data: { requestId: 'req-8', toolCallId: 'tool-1', actions: ['exit_only', '', null] },
      },
      'copilot-sdk',
    );
    expect(relay?.summary).toBe('');
    expect(relay?.planContent).toBe('');
    expect(relay?.actions).toEqual(['exit_only']);
    expect(relay?.recommendedAction).toBe('');
    expect(relay?.requestId).toBe('req-8');
  });
});

describe('buildPlanRelay — node-pty degraded path (tool.execution_start)', () => {
  it('normalizes exit_plan_mode arguments best-effort with empty requestId', () => {
    const relay = buildPlanRelay(
      {
        type: 'tool.execution_start',
        data: {
          toolName: 'exit_plan_mode',
          toolCallId: 'tool-3',
          arguments: {
            summary: '- step 1',
            actions: ['interactive'],
            recommendedAction: 'interactive',
          },
        },
      },
      'node-pty',
    );
    expect(relay).toEqual({
      toolId: 'tool-3',
      requestId: '',
      summary: '- step 1',
      planContent: '',
      actions: ['interactive'],
      recommendedAction: 'interactive',
    });
  });

  it('does NOT relay exit_plan_mode tool.execution_start on the SDK/native-bridge backend (avoids duplicate)', () => {
    const relay = buildPlanRelay(
      {
        type: 'tool.execution_start',
        data: { toolName: 'exit_plan_mode', toolCallId: 'tool-4', arguments: { summary: 's' } },
      },
      'sdk',
    );
    expect(relay).toBeNull();
  });

  it('returns null for a non-plan tool', () => {
    const relay = buildPlanRelay(
      {
        type: 'tool.execution_start',
        data: { toolName: 'view', toolCallId: 'tool-5', arguments: { path: '/x/y.ts' } },
      },
      'node-pty',
    );
    expect(relay).toBeNull();
  });
});
