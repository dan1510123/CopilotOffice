import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TERMINAL_BACKEND,
  didTerminalBackendFallBack,
  parseTerminalBackend,
  type TerminalBackendKind,
} from '../../../src/config/terminalBackend';

describe('config/terminalBackend', () => {
  it('defaults to the native bridge backend', () => {
    expect(DEFAULT_TERMINAL_BACKEND).toBe('native-bridge');
  });

  it.each([undefined, '', '   ', 'unknown', 'websocket'])(
    'falls back to default for %s',
    (value) => {
      expect(parseTerminalBackend(value)).toBe(DEFAULT_TERMINAL_BACKEND);
    },
  );

  it.each<TerminalBackendKind>(['native-bridge', 'node-pty', 'ui-server', 'sdk'])(
    'accepts exact backend value %s',
    (value) => {
      expect(parseTerminalBackend(value)).toBe(value);
    },
  );

  it('trims and parses case-insensitively', () => {
    expect(parseTerminalBackend('  NODE-PTY  ')).toBe('node-pty');
    expect(parseTerminalBackend('\tUI-SERVER\n')).toBe('ui-server');
    expect(parseTerminalBackend('  SDK  ')).toBe('sdk');
    expect(parseTerminalBackend(' Native-Bridge ')).toBe('native-bridge');
  });

  it('maps known aliases', () => {
    expect(parseTerminalBackend('nodepty')).toBe('node-pty');
    expect(parseTerminalBackend('pty')).toBe('node-pty');
    expect(parseTerminalBackend('legacy')).toBe('node-pty');
    expect(parseTerminalBackend('ui_server')).toBe('ui-server');
    expect(parseTerminalBackend('ui server')).toBe('ui-server');
    expect(parseTerminalBackend('ui')).toBe('ui-server');
    expect(parseTerminalBackend('headless')).toBe('sdk');
    expect(parseTerminalBackend('native')).toBe('native-bridge');
    expect(parseTerminalBackend('native_bridge')).toBe('native-bridge');
    expect(parseTerminalBackend('bridge')).toBe('native-bridge');
  });

  it('keeps the SDK headless backend selectable as the native-bridge fallback', () => {
    expect(parseTerminalBackend('sdk')).not.toBe(DEFAULT_TERMINAL_BACKEND);
    expect(parseTerminalBackend('sdk')).toBe('sdk');
  });

  it('reports a fallback when the requested backend is not the one loaded', () => {
    expect(didTerminalBackendFallBack('native-bridge', 'native-bridge')).toBe(false);
    expect(didTerminalBackendFallBack('native-bridge', 'sdk')).toBe(true);
    expect(didTerminalBackendFallBack('native-bridge', 'none')).toBe(true);
    expect(didTerminalBackendFallBack('ui-server', 'node-pty')).toBe(true);
    expect(didTerminalBackendFallBack('ui-server', 'ui-server')).toBe(false);
    expect(didTerminalBackendFallBack('sdk', 'none')).toBe(false);
    expect(didTerminalBackendFallBack('node-pty', 'node-pty')).toBe(false);
  });
});
