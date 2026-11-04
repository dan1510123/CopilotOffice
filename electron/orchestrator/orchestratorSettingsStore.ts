import * as fs from 'fs';
import * as path from 'path';

export interface OrchestratorSettings {
  allowAllOperations: boolean;
}

export interface OrchestratorSettingsStore {
  load(): OrchestratorSettings;
  save(settings: OrchestratorSettings): void;
}

export function createOrchestratorSettingsStore(cwd = process.cwd()): OrchestratorSettingsStore {
  const filePath = path.join(cwd, '.data', 'orchestrator-settings.json');
  return {
    load() {
      if (!fs.existsSync(filePath)) return { allowAllOperations: false };
      try {
        const settings: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!settings || typeof settings !== 'object' ||
            !('allowAllOperations' in settings) || typeof settings.allowAllOperations !== 'boolean') {
          throw new Error('Invalid Ringleader approval settings');
        }
        return { allowAllOperations: settings.allowAllOperations };
      } catch (error) {
        console.error('[Orchestrator] Failed to load settings; requiring approval:', error);
        return { allowAllOperations: false };
      }
    },
    save(settings) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
    },
  };
}
