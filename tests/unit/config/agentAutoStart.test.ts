import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_AGENT_AUTO_START_SETTINGS,
  STORAGE_KEY,
  getAgentAutoStartSettings,
  setAgentAutoStartSettings,
  resetAgentAutoStartSettings,
  shouldAutoStart,
} from '../../../src/config/agentAutoStart';

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('config/agentAutoStart', () => {
  it('returns default when storage key is missing', () => {
    const s = getAgentAutoStartSettings();
    expect(s).toEqual(DEFAULT_AGENT_AUTO_START_SETTINGS);
    expect(s.autoStartKnownAgents).toBe(true);
  });

  it('round-trips via set/get', () => {
    setAgentAutoStartSettings({ autoStartKnownAgents: false });
    expect(getAgentAutoStartSettings()).toEqual({ autoStartKnownAgents: false });
    setAgentAutoStartSettings({ autoStartKnownAgents: true });
    expect(getAgentAutoStartSettings()).toEqual({ autoStartKnownAgents: true });
  });

  it('returns default AND clears corrupt JSON in storage', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const s = getAgentAutoStartSettings();
    expect(s).toEqual(DEFAULT_AGENT_AUTO_START_SETTINGS);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('returns default when autoStartKnownAgents is non-boolean', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ autoStartKnownAgents: 'no' }));
    expect(getAgentAutoStartSettings()).toEqual(DEFAULT_AGENT_AUTO_START_SETTINGS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ autoStartKnownAgents: 1 }));
    expect(getAgentAutoStartSettings()).toEqual(DEFAULT_AGENT_AUTO_START_SETTINGS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ autoStartKnownAgents: null }));
    expect(getAgentAutoStartSettings()).toEqual(DEFAULT_AGENT_AUTO_START_SETTINGS);
  });

  it('resetAgentAutoStartSettings clears storage and returns default', () => {
    setAgentAutoStartSettings({ autoStartKnownAgents: false });
    const result = resetAgentAutoStartSettings();
    expect(result).toEqual(DEFAULT_AGENT_AUTO_START_SETTINGS);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('returns default when JSON is not an object', () => {
    localStorage.setItem(STORAGE_KEY, '42');
    expect(getAgentAutoStartSettings()).toEqual(DEFAULT_AGENT_AUTO_START_SETTINGS);
    localStorage.setItem(STORAGE_KEY, 'null');
    expect(getAgentAutoStartSettings()).toEqual(DEFAULT_AGENT_AUTO_START_SETTINGS);
  });

  describe('shouldAutoStart (FR-017 gate predicate)', () => {
    it('returns true by default (fresh install / cleared storage)', () => {
      expect(shouldAutoStart()).toBe(true);
    });

    it('returns false when the setting is OFF', () => {
      setAgentAutoStartSettings({ autoStartKnownAgents: false });
      expect(shouldAutoStart()).toBe(false);
    });

    it('returns true when the setting is explicitly ON', () => {
      setAgentAutoStartSettings({ autoStartKnownAgents: true });
      expect(shouldAutoStart()).toBe(true);
    });

    it('returns true again after resetAgentAutoStartSettings clears an OFF value', () => {
      setAgentAutoStartSettings({ autoStartKnownAgents: false });
      expect(shouldAutoStart()).toBe(false);
      resetAgentAutoStartSettings();
      expect(shouldAutoStart()).toBe(true);
    });

    it('returns true (fail-safe to default) when storage has corrupt JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{not json');
      // shouldAutoStart MUST NOT throw on corrupt storage — it must fall back
      // to the default (ON) so users are never silently locked out of the
      // feature by a bad stored value.
      expect(shouldAutoStart()).toBe(true);
    });
  });
});
