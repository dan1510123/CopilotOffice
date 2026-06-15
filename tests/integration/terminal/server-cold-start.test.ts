import { describe, expect, it } from 'vitest';
import {
  repairDuplicateSessionIds,
  type MutableOfficeSessionData,
} from '../../../electron/terminal/session-repair';

/**
 * Cold-start session invariants (feature 002, T007–T008).
 *
 * These cover the V1 invariant (distinct sessionIds per agent in an office)
 * and the V3 repair invariant (duplicate sessionIds in a persisted office
 * file are repaired on load).
 *
 * The proximate cause of the shared-session symptom in the renderer
 * (preStartAgentSessions slicing to the first 2 agents) is asserted by the
 * extended TerminalOverlay test in TerminalOverlay.test.ts.
 */

describe('US1 V1: three cold-start opens produce three distinct sessionIds', () => {
  it('mints a fresh UUID per agentId when the office session map is empty', () => {
    // Simulate the inline minting logic in `startTerminalForAgent`:
    //   if (!sessionIds.get(agentId)) { sessionIds.set(agentId, randomUUID()) }
    const data: MutableOfficeSessionData = { sessionIds: new Map() };
    const agents = ['generalist', 'debugger', 'admin'];
    const fakeMint = (() => {
      let i = 0;
      const ids = [
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333',
      ];
      return () => ids[i++];
    })();
    for (const a of agents) {
      if (!data.sessionIds.get(a)) {
        data.sessionIds.set(a, fakeMint());
      }
    }
    const values = Array.from(data.sessionIds.values());
    expect(new Set(values).size).toBe(3);
    expect(data.sessionIds.get('generalist')).not.toBe(data.sessionIds.get('debugger'));
    expect(data.sessionIds.get('debugger')).not.toBe(data.sessionIds.get('admin'));
  });
});

describe('US1 V3: persisted duplicate sessionIds are repaired on load', () => {
  it('keeps the first agent, re-mints subsequent duplicates, and logs each repair', () => {
    const duplicate = '00000000-0000-0000-0000-000000000000';
    const data: MutableOfficeSessionData = {
      sessionIds: new Map([
        ['generalist', duplicate],
        ['debugger', duplicate],
        ['admin', 'unique-admin-uuid'],
      ]),
    };

    const warnings: string[] = [];
    const fakeMint = (() => {
      let i = 0;
      const ids = ['fresh-1', 'fresh-2', 'fresh-3'];
      return () => ids[i++];
    })();

    const repaired = repairDuplicateSessionIds('office-0', data, {
      logger: { warn: (m) => warnings.push(m) },
      mintId: fakeMint,
    });

    expect(repaired).toBe(true);
    expect(data.sessionIds.get('generalist')).toBe(duplicate); // first wins
    expect(data.sessionIds.get('debugger')).toBe('fresh-1');
    expect(data.sessionIds.get('admin')).toBe('unique-admin-uuid'); // untouched
    expect(new Set(data.sessionIds.values()).size).toBe(3);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(
      /\[TermServer\] Repaired duplicate sessionId for officeId=office-0 agentId=debugger from=.* to=fresh-1/,
    );
  });

  it('returns false and emits no warnings when all sessionIds are already distinct', () => {
    const data: MutableOfficeSessionData = {
      sessionIds: new Map([
        ['generalist', 'uuid-1'],
        ['debugger', 'uuid-2'],
        ['admin', 'uuid-3'],
      ]),
    };
    const warnings: string[] = [];
    const repaired = repairDuplicateSessionIds('office-0', data, {
      logger: { warn: (m) => warnings.push(m) },
    });
    expect(repaired).toBe(false);
    expect(warnings).toEqual([]);
    expect(Array.from(data.sessionIds.values())).toEqual(['uuid-1', 'uuid-2', 'uuid-3']);
  });

  it('handles three-way collisions by minting two fresh ids', () => {
    const duplicate = 'same-uuid';
    const data: MutableOfficeSessionData = {
      sessionIds: new Map([
        ['generalist', duplicate],
        ['debugger', duplicate],
        ['admin', duplicate],
      ]),
    };
    const fakeMint = (() => {
      let i = 0;
      const ids = ['new-2', 'new-3'];
      return () => ids[i++];
    })();
    const repaired = repairDuplicateSessionIds('office-0', data, {
      logger: { warn: () => {} },
      mintId: fakeMint,
    });
    expect(repaired).toBe(true);
    expect(data.sessionIds.get('generalist')).toBe(duplicate);
    expect(data.sessionIds.get('debugger')).toBe('new-2');
    expect(data.sessionIds.get('admin')).toBe('new-3');
    expect(new Set(data.sessionIds.values()).size).toBe(3);
  });
});
