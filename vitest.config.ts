import { defineConfig } from 'vitest/config';

function normalizePath(id: string): string {
  return id.replace(/\\/g, '/');
}

export default defineConfig({
  plugins: [
    {
      name: 'meeting-scope-guard',
      enforce: 'pre',
      resolveId(source, importer) {
        const normalized = normalizePath(source);
        const normalizedImporter = importer ? normalizePath(importer) : '';
        const isMeetingSource = normalized.includes('/meeting/');
        const isMeetingScene = /MeetingScene(?:\.ts)?$/.test(normalized);
        const isMainIntegrationMock =
          isMeetingScene && normalizedImporter.includes('/tests/integration/main/');
        const isMainCoordinatorImport =
          isMeetingScene && normalizedImporter.endsWith('/src/main.ts');
        // S1-E: allow targeted parity tests under tests/{unit,integration}/meeting/**
        // to import from src/meeting/** (parser + approval coverage). The guard treats
        // the test file's own path as a "meeting source" (since it lives under
        // /meeting/), so we also exempt sources that are themselves test files.
        const isMeetingTestSource =
          normalized.includes('/tests/unit/meeting/') ||
          normalized.includes('/tests/integration/meeting/');
        const isMeetingTestImporter =
          normalizedImporter.includes('/tests/unit/meeting/') ||
          normalizedImporter.includes('/tests/integration/meeting/');

        if (
          (isMeetingSource || isMeetingScene) &&
          !isMainIntegrationMock &&
          !isMainCoordinatorImport &&
          !isMeetingTestSource &&
          !isMeetingTestImporter
        ) {
          throw new Error(
            `[test-scope] Import blocked by Meeting/Fleet scope guard: ${source}`
          );
        }
        return null;
      },
    },
  ],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup/vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/config/agents.ts',
        'src/config/notifications.ts',
        'src/config/playerCustomization.ts',
        'src/sprites/DirectionalSprite.ts',
        'src/office/officeManager.ts',
        'src/ui/NotificationService.ts',
        'src/ui/ToastNotification.ts',
        'src/ui/NotificationSettingsPanel.ts',
        'src/input/GameInputListener.ts',
        'src/input/GlobalInputListener.ts',
        'src/input/InputManager.ts',
        'src/input/TerminalInputListener.ts',
      ],
      exclude: [
        'src/meeting/**',
        'src/scenes/MeetingScene.ts',
      ],
      reporter: ['text', 'html'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 55,
        statements: 70,
        'src/config/**': {
          lines: 85,
          functions: 90,
          branches: 65,
          statements: 85,
        },
        'src/office/**': {
          lines: 45,
          functions: 40,
          branches: 35,
          statements: 40,
        },
        'src/input/**': {
          lines: 80,
          functions: 80,
          branches: 70,
          statements: 80,
        },
        'src/scenes/**': {
          lines: 40,
          functions: 40,
          branches: 30,
          statements: 40,
        },
      },
    },
  },
});
