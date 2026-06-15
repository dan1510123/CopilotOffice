import { describe, expect, it } from 'vitest';
import {
  extractJsonBlocks,
  parsePlanFromOutput,
  stripAnsi,
  validateMeetingPlan,
} from '../../../src/meeting/planParser';

const VALID_AGENTS = ['generalist', 'debugger', 'admin'];

describe('meeting/planParser.stripAnsi', () => {
  it('removes CSI sequences and OSC titles', () => {
    const input = '\x1B[31mhello\x1B[0m \x1B]0;title\x07world';
    expect(stripAnsi(input)).toBe('hello world');
  });

  it('leaves plain text unchanged', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });
});

describe('meeting/planParser.extractJsonBlocks', () => {
  it('extracts fenced ```json blocks', () => {
    const md = 'some chatter\n```json\n{"plan": "x"}\n```\n more';
    expect(extractJsonBlocks(md)).toEqual(['{"plan": "x"}']);
  });

  it('extracts fenced bare ``` blocks if they start with { or [', () => {
    const md = '```\n[1,2,3]\n```';
    expect(extractJsonBlocks(md)).toEqual(['[1,2,3]']);
  });

  it('ignores fenced blocks that do not start with JSON', () => {
    const md = '```python\nprint("hi")\n```';
    expect(extractJsonBlocks(md)).toEqual([]);
  });

  it('returns multiple blocks in order of appearance', () => {
    const md = '```json\n{"a":1}\n```\nmid\n```json\n{"b":2}\n```';
    expect(extractJsonBlocks(md)).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe('meeting/planParser.validateMeetingPlan', () => {
  const validPlan = {
    plan: 'Decompose and dispatch',
    tasks: [
      { agentId: 'generalist', title: 'do X', description: 'd', prompt: 'p' },
      { agentId: 'debugger', title: 'fix Y', description: 'd', prompt: 'p' },
    ],
  };

  it('accepts a well-formed plan', () => {
    const result = validateMeetingPlan(validPlan, VALID_AGENTS);
    expect(result).not.toBeNull();
    expect(result?.tasks).toHaveLength(2);
  });

  it('rejects null / non-object input', () => {
    expect(validateMeetingPlan(null, VALID_AGENTS)).toBeNull();
    expect(validateMeetingPlan(42 as unknown, VALID_AGENTS)).toBeNull();
    expect(validateMeetingPlan('nope' as unknown, VALID_AGENTS)).toBeNull();
  });

  it('rejects missing or empty plan summary', () => {
    expect(validateMeetingPlan({ plan: '', tasks: validPlan.tasks }, VALID_AGENTS)).toBeNull();
    expect(validateMeetingPlan({ tasks: validPlan.tasks }, VALID_AGENTS)).toBeNull();
  });

  it('rejects when tasks is missing or empty', () => {
    expect(validateMeetingPlan({ plan: 'x', tasks: [] }, VALID_AGENTS)).toBeNull();
    expect(validateMeetingPlan({ plan: 'x' }, VALID_AGENTS)).toBeNull();
    expect(validateMeetingPlan({ plan: 'x', tasks: 'not-an-array' }, VALID_AGENTS)).toBeNull();
  });

  it('drops individual tasks with missing string fields but keeps valid ones', () => {
    const mixed = {
      plan: 'x',
      tasks: [
        { agentId: 'generalist', title: 'ok', description: 'd', prompt: 'p' },
        { agentId: 'generalist', title: 'missing-prompt', description: 'd' }, // dropped
        { agentId: 42, title: 't', description: 'd', prompt: 'p' },           // dropped (bad agentId type)
      ],
    };
    const result = validateMeetingPlan(mixed, VALID_AGENTS);
    expect(result).not.toBeNull();
    expect(result?.tasks).toHaveLength(1);
    expect(result?.tasks[0].title).toBe('ok');
  });

  it('drops tasks with unknown agentId', () => {
    const plan = {
      plan: 'x',
      tasks: [
        { agentId: 'generalist', title: 'ok', description: 'd', prompt: 'p' },
        { agentId: 'unknown_agent', title: 'nope', description: 'd', prompt: 'p' },
      ],
    };
    const result = validateMeetingPlan(plan, VALID_AGENTS);
    expect(result?.tasks.map((t) => t.agentId)).toEqual(['generalist']);
  });

  it('returns null when all tasks are filtered out', () => {
    const plan = {
      plan: 'x',
      tasks: [{ agentId: 'unknown_agent', title: 't', description: 'd', prompt: 'p' }],
    };
    expect(validateMeetingPlan(plan, VALID_AGENTS)).toBeNull();
  });
});

describe('meeting/planParser.parsePlanFromOutput', () => {
  it('parses a JSON plan from ANSI-coded terminal output', () => {
    const planJson = JSON.stringify({
      plan: 'Decompose work',
      tasks: [{ agentId: 'generalist', title: 't', description: 'd', prompt: 'p' }],
    });
    const terminal = `\x1B[32mArthur:\x1B[0m here is the plan:\n\`\`\`json\n${planJson}\n\`\`\`\n`;
    const result = parsePlanFromOutput(terminal);
    expect(result).not.toBeNull();
    expect(result?.plan).toBe('Decompose work');
    expect(result?.tasks).toHaveLength(1);
  });

  it('returns null when no JSON blocks are present', () => {
    expect(parsePlanFromOutput('Arthur: I have no plan.')).toBeNull();
  });

  it('returns null when JSON blocks are malformed', () => {
    const terminal = '```json\n{not-json}\n```';
    expect(parsePlanFromOutput(terminal)).toBeNull();
  });

  it('picks the first VALID block when multiple exist (skipping malformed)', () => {
    const validJson = JSON.stringify({
      plan: 'second',
      tasks: [{ agentId: 'generalist', title: 't', description: 'd', prompt: 'p' }],
    });
    const terminal = '```json\n{bad json\n```\n```json\n' + validJson + '\n```';
    const result = parsePlanFromOutput(terminal);
    expect(result?.plan).toBe('second');
  });

  it('honors a custom validAgentIds allowlist', () => {
    const planJson = JSON.stringify({
      plan: 'x',
      tasks: [
        { agentId: 'custom_agent', title: 't', description: 'd', prompt: 'p' },
      ],
    });
    const terminal = `\`\`\`json\n${planJson}\n\`\`\``;
    expect(parsePlanFromOutput(terminal)).toBeNull(); // default allowlist rejects
    const result = parsePlanFromOutput(terminal, ['custom_agent']);
    expect(result?.tasks[0].agentId).toBe('custom_agent');
  });
});
