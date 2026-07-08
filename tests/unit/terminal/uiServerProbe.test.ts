import { describe, expect, it } from 'vitest';
import { interpretUiServerProbe } from '../../../electron/terminal/terminal-backend';

describe('interpretUiServerProbe', () => {
  it('treats an "unknown option" error as unsupported', () => {
    expect(interpretUiServerProbe("error: unknown option '--ui-server'")).toBe(false);
  });

  it('is case-insensitive for the unknown-option error', () => {
    expect(interpretUiServerProbe('Error: Unknown Option --ui-server')).toBe(false);
  });

  it('treats a normal fall-through message as supported', () => {
    expect(
      interpretUiServerProbe('No prompt provided. Run in an interactive terminal or provide a prompt with -p'),
    ).toBe(true);
  });

  it('treats empty output as supported (no rejection reported)', () => {
    expect(interpretUiServerProbe('')).toBe(true);
  });

  it('treats a listening-on-port message as supported', () => {
    expect(interpretUiServerProbe('listening on port 54979')).toBe(true);
  });
});
