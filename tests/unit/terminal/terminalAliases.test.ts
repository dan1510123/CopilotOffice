import { describe, expect, it } from 'vitest';
import { terminalOffices } from '../../../electron/terminal/terminal-aliases';

describe('terminalOffices', () => {
  it('returns the owning office and every transferred alias exactly once', () => {
    const aliases = new Map([
      ['meeting:architect', 'meeting:architect'],
      ['fleet:architect', 'meeting:architect'],
      ['review:architect', 'meeting:architect'],
      ['other:generalist', 'other:generalist'],
    ]);

    expect(terminalOffices(
      aliases,
      'meeting',
      'architect',
      'meeting:architect',
    )).toEqual(['meeting', 'fleet', 'review']);
  });
});
