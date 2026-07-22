import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEAMS_SETTINGS,
  normalizeTeamsSettings,
} from '../../../electron/teams/teamsSettingsStore';

// Spec 018 FR-010 / VI-6: the opt-in auto-render gate defaults OFF, survives a
// normalize round-trip when present, and a settings file lacking the key
// normalizes to false (backward compatible).
describe('teamsSettingsStore — autoRenderMarkdownImages gate (FR-010)', () => {
  it('defaults autoRenderMarkdownImages to false', () => {
    expect(DEFAULT_TEAMS_SETTINGS.autoRenderMarkdownImages).toBe(false);
  });

  it('normalizes a missing autoRenderMarkdownImages key to false (backward compatible)', () => {
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
    // No autoRenderMarkdownImages key present at all.
    const normalized = normalizeTeamsSettings(legacy);
    expect(normalized.autoRenderMarkdownImages).toBe(false);
  });

  it('normalizes null/undefined input to the default (false)', () => {
    expect(normalizeTeamsSettings(null).autoRenderMarkdownImages).toBe(false);
    expect(normalizeTeamsSettings(undefined).autoRenderMarkdownImages).toBe(false);
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
