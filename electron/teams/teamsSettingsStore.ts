// File-backed store for global Teams settings at `.data/teams-settings.json`.
// Mirrors officeFileStore's plain-Node design so it stays unit-testable.

import * as fs from 'fs';
import * as path from 'path';
import type { TeamsSettings } from './types';

export const DEFAULT_TEAMS_SETTINGS: TeamsSettings = {
  enabled: false,
  defaultChannelUrl: '',
  relayChannelUrl: '',
  relayMentionType: 'none',
  relayMentionValue: '',
  notifyOnCompleteEnabled: true,
  ackEnabled: true,
  checkInEnabled: true,
  checkInThresholdMs: 120_000,
  checkInThrottleMs: 60_000,
};

export function normalizeTeamsSettings(partial: Partial<TeamsSettings> | null | undefined): TeamsSettings {
  return {
    enabled: partial?.enabled ?? DEFAULT_TEAMS_SETTINGS.enabled,
    defaultChannelUrl: partial?.defaultChannelUrl ?? DEFAULT_TEAMS_SETTINGS.defaultChannelUrl,
    relayChannelUrl: partial?.relayChannelUrl ?? DEFAULT_TEAMS_SETTINGS.relayChannelUrl,
    relayMentionType: partial?.relayMentionType ?? DEFAULT_TEAMS_SETTINGS.relayMentionType,
    relayMentionValue: partial?.relayMentionValue ?? DEFAULT_TEAMS_SETTINGS.relayMentionValue,
    notifyOnCompleteEnabled: partial?.notifyOnCompleteEnabled ?? DEFAULT_TEAMS_SETTINGS.notifyOnCompleteEnabled,
    ackEnabled: partial?.ackEnabled ?? DEFAULT_TEAMS_SETTINGS.ackEnabled,
    checkInEnabled: partial?.checkInEnabled ?? DEFAULT_TEAMS_SETTINGS.checkInEnabled,
    checkInThresholdMs: partial?.checkInThresholdMs ?? DEFAULT_TEAMS_SETTINGS.checkInThresholdMs,
    checkInThrottleMs: partial?.checkInThrottleMs ?? DEFAULT_TEAMS_SETTINGS.checkInThrottleMs,
  };
}

export interface TeamsSettingsStore {
  load(): TeamsSettings;
  save(settings: TeamsSettings): void;
  readonly filePath: string;
}

export function createTeamsSettingsStore(cwd: string = process.cwd()): TeamsSettingsStore {
  const dataDir = path.join(cwd, '.data');
  const filePath = path.join(dataDir, 'teams-settings.json');
  return {
    filePath,
    load(): TeamsSettings {
      try {
        if (!fs.existsSync(filePath)) return { ...DEFAULT_TEAMS_SETTINGS };
        return normalizeTeamsSettings(JSON.parse(fs.readFileSync(filePath, 'utf8')));
      } catch {
        return { ...DEFAULT_TEAMS_SETTINGS };
      }
    },
    save(settings: TeamsSettings): void {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(normalizeTeamsSettings(settings), null, 2), 'utf8');
    },
  };
}
