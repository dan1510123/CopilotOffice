import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NATIVE_BRIDGE_EXTENSION_SOURCE,
  getNativeBridgeExtensionPath,
  materializeNativeBridgeExtension,
} from '../../../electron/terminal/native-bridge-extension';

const scratchDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe('native bridge extension materializer', () => {
  it('writes the bundled extension atomically and skips identical content', async () => {
    const homeDir = path.join(process.cwd(), 'tests', `.scratch-native-bridge-${randomUUID()}`);
    scratchDirectories.push(homeDir);
    const expectedPath = getNativeBridgeExtensionPath(homeDir);

    const first = await materializeNativeBridgeExtension({ homeDir });
    const firstStat = await fs.stat(expectedPath);
    const second = await materializeNativeBridgeExtension({ homeDir });
    const secondStat = await fs.stat(expectedPath);

    expect(first).toEqual({ changed: true, extensionPath: expectedPath });
    expect(second).toEqual({ changed: false, extensionPath: expectedPath });
    expect(await fs.readFile(expectedPath, 'utf8')).toBe(NATIVE_BRIDGE_EXTENSION_SOURCE);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
    expect((await fs.readdir(path.dirname(expectedPath))).sort()).toEqual(['extension.mjs']);
  });

  it('rewrites the extension when bundled content changes', async () => {
    const homeDir = path.join(process.cwd(), 'tests', `.scratch-native-bridge-${randomUUID()}`);
    scratchDirectories.push(homeDir);
    await materializeNativeBridgeExtension({ homeDir, source: 'old' });

    await expect(materializeNativeBridgeExtension({ homeDir, source: 'new' }))
      .resolves.toEqual({
        changed: true,
        extensionPath: getNativeBridgeExtensionPath(homeDir),
      });
    expect(await fs.readFile(getNativeBridgeExtensionPath(homeDir), 'utf8')).toBe('new');
  });

  it('contains the required native-session bridge behaviors', () => {
    expect(NATIVE_BRIDGE_EXTENSION_SOURCE).toContain(
      'import { joinSession } from "@github/copilot-sdk/extension"',
    );
    expect(NATIVE_BRIDGE_EXTENSION_SOURCE).toContain('mode: "enqueue"');
    expect(NATIVE_BRIDGE_EXTENSION_SOURCE).toContain('case "run-control"');
    expect(NATIVE_BRIDGE_EXTENSION_SOURCE).toContain('case "submit-answer"');
    expect(NATIVE_BRIDGE_EXTENSION_SOURCE).toContain('case "submit-plan-decision"');
    expect(NATIVE_BRIDGE_EXTENSION_SOURCE).not.toContain(
      'COPILOT_TEST_DISABLE_INTERRUPTED_SESSION_RESTORE',
    );
    expect(NATIVE_BRIDGE_EXTENSION_SOURCE).not.toContain('console.log');
  });
});
