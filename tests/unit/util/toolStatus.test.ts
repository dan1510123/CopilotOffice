import { describe, expect, it } from 'vitest';
import {
  isAskUserTool,
  nextSubStateAfterToolComplete,
  normalizeToolName,
  addActiveTool,
  removeCompletedTool,
  type ToolEntry,
} from '../../../src/util/toolStatus';

describe('util/toolStatus.normalizeToolName', () => {
  it('lowercases and collapses whitespace/dashes into underscores', () => {
    expect(normalizeToolName('Ask User')).toBe('ask_user');
    expect(normalizeToolName('ask-user')).toBe('ask_user');
    expect(normalizeToolName('  Read   File ')).toBe('read_file');
  });

  it('handles null / undefined / empty input', () => {
    expect(normalizeToolName(null)).toBe('');
    expect(normalizeToolName(undefined)).toBe('');
    expect(normalizeToolName('')).toBe('');
  });
});

describe('util/toolStatus.isAskUserTool', () => {
  it('matches canonical tool id variants', () => {
    expect(isAskUserTool('ask_user', null)).toBe(true);
    expect(isAskUserTool('askuser', null)).toBe(true);
    expect(isAskUserTool('Ask-User', null)).toBe(true);
  });

  it('matches freeform status strings emitted by the CLI', () => {
    expect(isAskUserTool('some_other_tool', 'Waiting for your answer')).toBe(true);
    expect(isAskUserTool('some_other_tool', 'WAITING ON USER INPUT')).toBe(true);
  });

  it('rejects unrelated tool ids and statuses', () => {
    expect(isAskUserTool('read_file', null)).toBe(false);
    expect(isAskUserTool('write_file', 'running')).toBe(false);
    expect(isAskUserTool(null, null)).toBe(false);
  });
});

describe('util/toolStatus.nextSubStateAfterToolComplete (ask_user race-guard)', () => {
  const entry = (id: string, name: string, status: string | null = null): ToolEntry => ({
    toolId: id,
    name,
    status,
  });

  it('returns idle when no tools remain', () => {
    expect(nextSubStateAfterToolComplete([])).toEqual({ kind: 'idle' });
  });

  it('returns thinking with the last remaining tool name when no ask_user is pending', () => {
    const next = nextSubStateAfterToolComplete([
      entry('t1', 'read_file'),
      entry('t2', 'edit'),
    ]);
    expect(next).toEqual({ kind: 'thinking', detail: 'edit' });
  });

  it('returns waiting when ask_user is the only remaining tool', () => {
    expect(nextSubStateAfterToolComplete([entry('t1', 'ask_user')])).toEqual({
      kind: 'waiting',
    });
  });

  // This is the regression that motivated the slice pair (S1-C+S1-D, R-001).
  // An unrelated tool completes in the same tick after ask_user started;
  // ask_user must win over the most recent tool name.
  it('returns waiting when ask_user is still pending alongside other tools (race-guard)', () => {
    const next = nextSubStateAfterToolComplete([
      entry('t1', 'ask_user'),
      entry('t2', 'read_file'),
    ]);
    expect(next).toEqual({ kind: 'waiting' });
  });

  it('returns waiting when ask_user is pending via freeform status text', () => {
    const next = nextSubStateAfterToolComplete([
      entry('t1', 'some_legacy_tool', 'Waiting for your answer'),
      entry('t2', 'edit'),
    ]);
    expect(next).toEqual({ kind: 'waiting' });
  });

  it('returns thinking with the last tool when ask_user has been removed from remaining', () => {
    // Simulates ask_user completing while other tools were running — the
    // race-guard should NOT trip and waiting should fall back to thinking.
    const next = nextSubStateAfterToolComplete([entry('t2', 'edit')]);
    expect(next).toEqual({ kind: 'thinking', detail: 'edit' });
  });
});

describe('util/toolStatus tool-set integrity (FR-004: dedup / out-of-order)', () => {
  const entry = (id: string, name: string, status: string | null = null): ToolEntry => ({
    toolId: id,
    name,
    status,
  });

  describe('addActiveTool', () => {
    it('appends a new tool and reports added=true', () => {
      const { tools, added } = addActiveTool([entry('t1', 'read_file')], entry('t2', 'edit'));
      expect(added).toBe(true);
      expect(tools).toHaveLength(2);
      expect(tools[1]).toMatchObject({ toolId: 't2', name: 'edit' });
    });

    it('is idempotent: a duplicate toolId is not stacked and reports added=false', () => {
      const start = [entry('t1', 'read_file')];
      const { tools, added } = addActiveTool(start, entry('t1', 'read_file'));
      expect(added).toBe(false);
      expect(tools).toHaveLength(1);
      expect(tools).toEqual(start);
    });

    it('does not mutate the input array', () => {
      const start = [entry('t1', 'read_file')];
      addActiveTool(start, entry('t2', 'edit'));
      expect(start).toHaveLength(1);
    });
  });

  describe('removeCompletedTool', () => {
    it('removes the matching tool and returns it as completed', () => {
      const { tools, completed } = removeCompletedTool(
        [entry('t1', 'read_file'), entry('t2', 'edit')],
        't1',
      );
      expect(completed).toMatchObject({ toolId: 't1', name: 'read_file' });
      expect(tools).toHaveLength(1);
      expect(tools[0].toolId).toBe('t2');
    });

    it('is a no-op for an unknown/out-of-order toolId (completed=null, set unchanged)', () => {
      const start = [entry('t1', 'read_file')];
      const { tools, completed } = removeCompletedTool(start, 'does-not-exist');
      expect(completed).toBeNull();
      expect(tools).toEqual(start);
    });

    it('duplicate completion is idempotent: second removal of the same id is a no-op', () => {
      const start = [entry('t1', 'read_file'), entry('t2', 'edit')];
      const first = removeCompletedTool(start, 't1');
      expect(first.completed).not.toBeNull();
      const second = removeCompletedTool(first.tools, 't1');
      expect(second.completed).toBeNull();
      expect(second.tools).toEqual([entry('t2', 'edit')]);
    });

    it('preserves ask_user waiting when an unrelated tool completes concurrently (integration)', () => {
      // ask_user (t1) and read_file (t2) both active; read_file completes.
      const active = [entry('t1', 'ask_user'), entry('t2', 'read_file')];
      const { tools, completed } = removeCompletedTool(active, 't2');
      expect(completed?.toolId).toBe('t2');
      // The resolved next state off the remaining set must still be waiting.
      expect(nextSubStateAfterToolComplete(tools)).toEqual({ kind: 'waiting' });
    });

    it('does not mutate the input array', () => {
      const start = [entry('t1', 'read_file')];
      removeCompletedTool(start, 't1');
      expect(start).toHaveLength(1);
    });
  });
});
