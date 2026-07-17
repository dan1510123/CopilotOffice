// spec 017 — T007. Unit tests for the persisted orchestrator transcript store:
// pure serialize/deserialize (tolerant of corruption), monotonic-seq bounded
// appendTurn (oldest-first trim), and the in-memory store round-trip.

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  serializeTranscript,
  deserializeTranscript,
  appendTurn,
  InMemoryOrchestratorTranscriptStore,
  FileOrchestratorTranscriptStore,
} from '../../../electron/orchestrator/orchestratorTranscriptStore';
import type { OrchestratorTranscript, TranscriptTurn } from '../../../electron/orchestrator/types';

function turn(overrides: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return { seq: 0, role: 'user', origin: 'desktop', text: 'hello', at: 1000, ...overrides };
}

function record(turns: TranscriptTurn[] = []): OrchestratorTranscript {
  return { sessionId: 's1', lifecycle: 'active', turns, updatedAt: 1000 };
}

describe('transcript serialize/deserialize', () => {
  it('round-trips a record through JSON', () => {
    const rec = record([turn({ seq: 0 }), turn({ seq: 1, role: 'orchestrator', text: 'hi' })]);
    const parsed = deserializeTranscript(serializeTranscript(rec));
    expect(parsed).not.toBeNull();
    expect(parsed?.sessionId).toBe('s1');
    expect(parsed?.turns).toHaveLength(2);
    expect(parsed?.turns[1].role).toBe('orchestrator');
  });

  it('returns null (never throws) on null / malformed / non-object input', () => {
    expect(deserializeTranscript(null)).toBeNull();
    expect(deserializeTranscript('not json {')).toBeNull();
    expect(deserializeTranscript('123')).toBeNull();
    expect(deserializeTranscript('{"sessionId":123}')).toBeNull();
    expect(deserializeTranscript('{"sessionId":"s1","lifecycle":"weird"}')).toBeNull();
  });

  it('drops malformed turn entries but keeps the well-formed ones', () => {
    const json = JSON.stringify({
      sessionId: 's1',
      lifecycle: 'active',
      updatedAt: 1,
      turns: [turn({ seq: 0 }), { seq: 'x', role: 'user' }, turn({ seq: 1, text: 'ok' })],
    });
    const parsed = deserializeTranscript(json);
    expect(parsed?.turns).toHaveLength(2);
    expect(parsed?.turns.map((t) => t.text)).toEqual(['hello', 'ok']);
  });
});

describe('appendTurn', () => {
  it('assigns monotonic seq from the last turn', () => {
    let rec = record();
    rec = appendTurn(rec, turn({ text: 'a' }), 5000);
    rec = appendTurn(rec, turn({ text: 'b' }), 5000);
    rec = appendTurn(rec, turn({ text: 'c' }), 5000);
    expect(rec.turns.map((t) => t.seq)).toEqual([0, 1, 2]);
  });

  it('is pure — does not mutate the input record', () => {
    const rec = record([turn({ seq: 0 })]);
    const next = appendTurn(rec, turn({ text: 'b' }), 5000);
    expect(rec.turns).toHaveLength(1);
    expect(next.turns).toHaveLength(2);
  });

  it('trims oldest-first when exceeding the bound', () => {
    let rec = record();
    for (let i = 0; i < 10; i++) rec = appendTurn(rec, turn({ text: `t${i}` }), 3);
    expect(rec.turns).toHaveLength(3);
    // Oldest dropped; newest three retained, seq still monotonic.
    expect(rec.turns.map((t) => t.text)).toEqual(['t7', 't8', 't9']);
    expect(rec.turns.map((t) => t.seq)).toEqual([7, 8, 9]);
  });

  it('updates updatedAt to the appended turn timestamp', () => {
    const rec = appendTurn(record(), turn({ at: 4242 }), 5000);
    expect(rec.updatedAt).toBe(4242);
  });
});

describe('InMemoryOrchestratorTranscriptStore', () => {
  it('save/load round-trips a deep copy (isolation)', () => {
    const store = new InMemoryOrchestratorTranscriptStore();
    expect(store.load()).toBeNull();
    const rec = record([turn()]);
    store.save(rec);
    const loaded = store.load();
    expect(loaded).toEqual(rec);
    expect(loaded).not.toBe(rec); // deep copy, not the same reference
  });

  it('clearActive resets to null', () => {
    const store = new InMemoryOrchestratorTranscriptStore(record([turn()]));
    expect(store.load()).not.toBeNull();
    store.clearActive();
    expect(store.load()).toBeNull();
  });
});

describe('FileOrchestratorTranscriptStore.defaultPath', () => {
  it('names the file orchestrator-transcript.json under the data dir', () => {
    const p = FileOrchestratorTranscriptStore.defaultPath('/tmp/.data');
    expect(p.replace(/\\/g, '/')).toBe('/tmp/.data/orchestrator-transcript.json');
  });
});

describe('FileOrchestratorTranscriptStore IO resilience (FR-025)', () => {
  it('save() swallows IO errors instead of throwing', () => {
    // Point the store at a path whose parent is a FILE, so mkdir/write fails.
    const tmpFile = path.join(os.tmpdir(), `orc-transcript-${Date.now()}.tmp`);
    fs.writeFileSync(tmpFile, 'x');
    try {
      const store = new FileOrchestratorTranscriptStore(path.join(tmpFile, 'nested.json'));
      expect(() => store.save(record([turn()]))).not.toThrow();
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  });

  it('load() returns null (never throws) when the file is missing', () => {
    const store = new FileOrchestratorTranscriptStore(
      path.join(os.tmpdir(), `orc-missing-${Date.now()}.json`),
    );
    expect(store.load()).toBeNull();
  });
});
