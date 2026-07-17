// spec 017 — unit tests for the renderer ask_user registry (US3/US4). Captures the
// real question + options so the orchestrator can report the question and classify
// an answer's wasFreeform flag for the submit-answer channel.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  setPendingAskUser,
  getPendingAskUser,
  clearPendingAskUser,
  classifyAnswer,
  clearAllPendingAskUser,
} from '../../../src/office/askUserRegistry';

beforeEach(() => clearAllPendingAskUser());

function seed(agentId: string) {
  setPendingAskUser(agentId, {
    toolId: 'tool-1',
    requestId: 'req-1',
    question: 'Which database should I use?',
    options: ['PostgreSQL', 'MySQL'],
    freeform: true,
  });
}

describe('askUserRegistry', () => {
  it('stores and retrieves the pending question', () => {
    seed('gene');
    expect(getPendingAskUser('gene')?.question).toBe('Which database should I use?');
    expect(getPendingAskUser('gene')?.options).toEqual(['PostgreSQL', 'MySQL']);
  });

  it('returns undefined for an agent with no pending question', () => {
    expect(getPendingAskUser('nobody')).toBeUndefined();
  });

  it('classifies a non-option answer as freeform, carrying the requestId', () => {
    seed('gene');
    expect(classifyAnswer('gene', 'wait for now')).toEqual({ wasFreeform: true, requestId: 'req-1' });
  });

  it('classifies an exact option match (case-insensitive) as not freeform', () => {
    seed('gene');
    expect(classifyAnswer('gene', '  postgresql ')).toEqual({ wasFreeform: false, requestId: 'req-1' });
  });

  it('treats any answer as freeform when nothing is pending', () => {
    expect(classifyAnswer('ghost', 'MySQL')).toEqual({ wasFreeform: true, requestId: undefined });
  });

  it('clears only when the toolId matches (guards against stale completions)', () => {
    seed('gene');
    expect(clearPendingAskUser('gene', 'other-tool')).toBe(false);
    expect(getPendingAskUser('gene')).toBeDefined();
    expect(clearPendingAskUser('gene', 'tool-1')).toBe(true);
    expect(getPendingAskUser('gene')).toBeUndefined();
  });

  it('clears unconditionally when no toolId is given', () => {
    seed('gene');
    expect(clearPendingAskUser('gene')).toBe(true);
    expect(getPendingAskUser('gene')).toBeUndefined();
  });
});
