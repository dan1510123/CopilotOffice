import { describe, expect, it } from 'vitest';
import { resolveSlashCommand } from '../../../electron/teams/slashCommands';

describe('resolveSlashCommand', () => {
  it('returns null for non-slash content (normal prompts / skills)', () => {
    expect(resolveSlashCommand('what is 2+2')).toBeNull();
    expect(resolveSlashCommand('use the pdf skill to summarize')).toBeNull();
    expect(resolveSlashCommand('')).toBeNull();
    expect(resolveSlashCommand('   ')).toBeNull();
  });

  it('returns null for a bare slash or unknown commands (falls through to model)', () => {
    expect(resolveSlashCommand('/')).toBeNull();
    expect(resolveSlashCommand('/unknown')).toBeNull();
    expect(resolveSlashCommand('/foobar do a thing')).toBeNull();
  });

  it('does not match a slash embedded mid-message', () => {
    expect(resolveSlashCommand('please run /compact now')).toBeNull();
  });

  it('classifies control commands', () => {
    expect(resolveSlashCommand('/compact')).toMatchObject({ name: 'compact', kind: 'control', control: 'compact' });
    expect(resolveSlashCommand('/usage')).toMatchObject({ name: 'usage', kind: 'control', control: 'usage' });
    expect(resolveSlashCommand('/model')).toMatchObject({ name: 'model', kind: 'control', control: 'model', args: undefined });
  });

  it('is case-insensitive and tolerant of surrounding whitespace', () => {
    expect(resolveSlashCommand('  /COMPACT  ')).toMatchObject({ kind: 'control', control: 'compact' });
    expect(resolveSlashCommand('/Model')).toMatchObject({ control: 'model' });
  });

  it('captures trailing args (model id / compaction instructions)', () => {
    expect(resolveSlashCommand('/model claude-sonnet-4.6')).toMatchObject({ control: 'model', args: 'claude-sonnet-4.6' });
    expect(resolveSlashCommand('/compact focus on the auth work')).toMatchObject({ control: 'compact', args: 'focus on the auth work' });
  });

  it('classifies reset and offline and help commands', () => {
    expect(resolveSlashCommand('/new')).toMatchObject({ kind: 'reset', resetMode: 'new' });
    expect(resolveSlashCommand('/clear')).toMatchObject({ kind: 'reset', resetMode: 'clear' });
    expect(resolveSlashCommand('/stop')).toMatchObject({ kind: 'offline' });
    expect(resolveSlashCommand('/help')).toMatchObject({ kind: 'help' });
  });
});
