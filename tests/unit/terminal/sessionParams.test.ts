import { describe, expect, it } from 'vitest';
import { parseAdditionalParams, sessionConfigFromArgs } from '../../../electron/terminal/session-params';

describe('Additional Parameters parsing and session mapping', () => {
  it('maps supported flags with quoted values while preserving Windows paths for the host', () => {
    const args = parseAdditionalParams('--agent "my agent" --model=auto --reasoning-effort high --config-dir "C:\\my config"');
    expect(args).toEqual(['--agent', 'my agent', '--model=auto', '--reasoning-effort', 'high', '--config-dir', 'C:\\my config']);
    expect(sessionConfigFromArgs(args)).toEqual({
      config: { agent: 'my agent', model: 'auto', reasoningEffort: 'high' },
      unmappedFlags: ['--config-dir'],
    });
  });

  it('supports single quotes, tabs, equals values, and last-value-wins', () => {
    const args = parseAdditionalParams("--model old\t--model 'auto' --agent='my agent' --reasoning-effort=max");
    expect(sessionConfigFromArgs(args).config).toEqual({ model: 'auto', agent: 'my agent', reasoningEffort: 'max' });
  });

  it('does not invent config for unknown or host-only arguments', () => {
    expect(sessionConfigFromArgs(['--no-auto-update', '--future-option=value'])).toEqual({
      config: {}, unmappedFlags: ['--no-auto-update', '--future-option'],
    });
    expect(sessionConfigFromArgs([]).config).toEqual({});
    expect(sessionConfigFromArgs(['--', '--model', 'auto']).config).toEqual({});
  });

  it.each(['--model', '--agent=', '--reasoning-effort --model auto', '--model ""'])('rejects missing mapped values: %s', (text) => {
    expect(() => sessionConfigFromArgs(parseAdditionalParams(text))).toThrow('requires a value');
  });

  it('rejects unterminated quotes and invalid effort levels', () => {
    expect(() => parseAdditionalParams('--model "auto')).toThrow('Unclosed quote');
    expect(() => sessionConfigFromArgs(['--reasoning-effort', 'invalid'])).toThrow('Unsupported SDK --reasoning-effort');
  });
});
