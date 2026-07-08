import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TERMINAL_BACKEND,
  parseTerminalBackend,
  type TerminalBackendKind,
} from '../../../src/config/terminalBackend';

describe('config/terminalBackend', () => {
  it.each([undefined, '', '   ', 'unknown', 'websocket'])(
    'falls back to default for %s',
    (value) => {
      expect(parseTerminalBackend(value)).toBe(DEFAULT_TERMINAL_BACKEND);
    },
  );

  it.each<TerminalBackendKind>(['node-pty', 'ui-server', 'sdk'])(
    'accepts exact backend value %s',
    (value) => {
      expect(parseTerminalBackend(value)).toBe(value);
    },
  );

  it('trims and parses case-insensitively', () => {
    expect(parseTerminalBackend('  NODE-PTY  ')).toBe('node-pty');
    expect(parseTerminalBackend('\tUI-SERVER\n')).toBe('ui-server');
    expect(parseTerminalBackend('  SDK  ')).toBe('sdk');
  });

  it('maps known aliases', () => {
    expect(parseTerminalBackend('nodepty')).toBe('node-pty');
    expect(parseTerminalBackend('pty')).toBe('node-pty');
    expect(parseTerminalBackend('legacy')).toBe('node-pty');
    expect(parseTerminalBackend('ui_server')).toBe('ui-server');
    expect(parseTerminalBackend('ui server')).toBe('ui-server');
    expect(parseTerminalBackend('ui')).toBe('ui-server');
    expect(parseTerminalBackend('headless')).toBe('sdk');
  });
});
