import type { OfficeConfig } from '../../src/office/officeManager';

export function createOfficeConfig(
  overrides: Partial<OfficeConfig> = {}
): OfficeConfig {
  return {
    id: 'office-0',
    name: 'Main Office',
    workingDirectory: '.',
    createdAt: 1,
    layout: 'default',
    seatedAgents: [],
    ...overrides,
  };
}

export function createStoredOfficePayload(
  offices: Partial<OfficeConfig>[],
  currentOfficeId: string | null = 'office-0'
): string {
  return JSON.stringify({
    currentOfficeId,
    offices,
  });
}

