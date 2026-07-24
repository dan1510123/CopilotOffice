import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEAMS_SETTINGS,
  normalizeTeamsSettings,
} from '../../../electron/teams/teamsSettingsStore';

// Spec 018 FR-010 / VI-6: the auto-render gate now defaults ON (per user request —
// when Teams is enabled the other toggles are on by default). It survives a normalize
// round-trip when present; a settings file lacking the key inherits the new default (true).
describe('teamsSettingsStore — autoRenderMarkdownImages gate (FR-010)', () => {
  it('defaults autoRenderMarkdownImages to true', () => {
    expect(DEFAULT_TEAMS_SETTINGS.autoRenderMarkdownImages).toBe(true);
  });

  it('normalizes a missing autoRenderMarkdownImages key to the default (true)', () => {
    const legacy = {
      enabled: true,
      defaultChannelUrl: 'https://x',
      relayChannelUrl: '',
      relayMentionType: 'none' as const,
      relayMentionValue: '',
      notifyOnCompleteEnabled: true,
      ackEnabled: true,
      checkInEnabled: true,
      checkInThresholdMs: 120_000,
      checkInThrottleMs: 60_000,
    };
    // No autoRenderMarkdownImages key present at all → inherits the new default (true).
    const normalized = normalizeTeamsSettings(legacy);
    expect(normalized.autoRenderMarkdownImages).toBe(true);
  });

  it('normalizes null/undefined input to the default (true)', () => {
    expect(normalizeTeamsSettings(null).autoRenderMarkdownImages).toBe(true);
    expect(normalizeTeamsSettings(undefined).autoRenderMarkdownImages).toBe(true);
  });

  it('preserves autoRenderMarkdownImages: true through a normalize round-trip', () => {
    const on = normalizeTeamsSettings({ autoRenderMarkdownImages: true });
    expect(on.autoRenderMarkdownImages).toBe(true);
  });

  it('preserves autoRenderMarkdownImages: false through a normalize round-trip', () => {
    const off = normalizeTeamsSettings({ autoRenderMarkdownImages: false });
    expect(off.autoRenderMarkdownImages).toBe(false);
  });

  it('does not disturb the other settings fields when the new flag is present', () => {
    const normalized = normalizeTeamsSettings({
      enabled: true,
      checkInThresholdMs: 5000,
      autoRenderMarkdownImages: true,
    });
    expect(normalized.enabled).toBe(true);
    expect(normalized.checkInThresholdMs).toBe(5000);
    expect(normalized.autoRenderMarkdownImages).toBe(true);
  });
});

// Orchestrator channel/@mention overrides (mirrors per-office overrides). Default empty
// / 'none' so an unset override falls back to the default channel + global relay mention.
describe('teamsSettingsStore — orchestrator channel/mention overrides', () => {
  it('defaults the orchestrator override fields to empty / none', () => {
    expect(DEFAULT_TEAMS_SETTINGS.orchestratorChannelUrl).toBe('');
    expect(DEFAULT_TEAMS_SETTINGS.orchestratorMentionType).toBe('none');
    expect(DEFAULT_TEAMS_SETTINGS.orchestratorMentionValue).toBe('');
  });

  it('normalizes missing orchestrator override keys to the defaults', () => {
    const legacy = {
      enabled: true,
      defaultChannelUrl: 'https://x',
      relayChannelUrl: '',
      relayMentionType: 'none' as const,
      relayMentionValue: '',
      notifyOnCompleteEnabled: true,
      ackEnabled: true,
      checkInEnabled: true,
      checkInThresholdMs: 120_000,
      checkInThrottleMs: 60_000,
    };
    const normalized = normalizeTeamsSettings(legacy);
    expect(normalized.orchestratorChannelUrl).toBe('');
    expect(normalized.orchestratorMentionType).toBe('none');
    expect(normalized.orchestratorMentionValue).toBe('');
  });

  it('preserves orchestrator override values through a normalize round-trip', () => {
    const n = normalizeTeamsSettings({
      orchestratorChannelUrl: 'https://teams/orch',
      orchestratorMentionType: 'tag',
      orchestratorMentionValue: 'oncall',
    });
    expect(n.orchestratorChannelUrl).toBe('https://teams/orch');
    expect(n.orchestratorMentionType).toBe('tag');
    expect(n.orchestratorMentionValue).toBe('oncall');
  });
});
