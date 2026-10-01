import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NativeBridgeCapabilityError,
  interpretNativeBridgeHelp,
  resolveNativeBridgeCapability,
} from '../../../electron/terminal/native-bridge-capability';

const scratchDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe('native bridge capability', () => {
  it('requires both pinned CLI flags', () => {
    expect(interpretNativeBridgeHelp(`
      --experimental
      --extension-sdk-path <directory>
    `)).toEqual({ supported: true, missingFlags: [] });
    expect(interpretNativeBridgeHelp('--experimental')).toEqual({
      supported: false,
      missingFlags: ['--extension-sdk-path'],
    });
    expect(interpretNativeBridgeHelp('--extension-sdk-path <directory>')).toEqual({
      supported: false,
      missingFlags: ['--experimental'],
    });
  });

  it('resolves the SDK package and pinned CLI without launching Copilot', async () => {
    const capability = await resolveNativeBridgeCapability({
      runHelp: () => '--experimental\n--extension-sdk-path <directory>\n',
    });

    expect(capability.sdkPackageDir).toMatch(/[\\/]@github[\\/]copilot-sdk$/);
    expect(capability.extensionExportPath).toMatch(/extension\.js$/);
    expect(capability.cliPath).toMatch(/copilot(?:\.exe)?$/);
    // The CLI only honors an override folder that directly holds the ESM entry
    // points; anything else silently falls back to its bundled SDK.
    expect(capability.extensionSdkPath).toBe(path.join(capability.sdkPackageDir, 'dist'));
    await expect(fs.access(path.join(capability.extensionSdkPath, 'extension.js'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(capability.extensionSdkPath, 'index.js'))).resolves.toBeUndefined();
  });

  it('rejects an SDK whose extension folder the CLI would silently ignore', async () => {
    const root = path.join(process.cwd(), 'tests', `.scratch-native-bridge-${randomUUID()}`);
    scratchDirectories.push(root);
    const sdkDir = path.join(root, 'node_modules', '@github', 'copilot-sdk');
    await fs.mkdir(path.join(sdkDir, 'dist', 'cjs'), { recursive: true });
    await fs.writeFile(path.join(sdkDir, 'package.json'), JSON.stringify({
      name: '@github/copilot-sdk',
      exports: { './extension': { import: { default: './dist/extension.js' } } },
    }));
    await fs.writeFile(path.join(sdkDir, 'dist', 'extension.js'), 'export {};');
    await fs.writeFile(path.join(sdkDir, 'dist', 'cjs', 'extension.js'), 'module.exports = {};');

    await expect(resolveNativeBridgeCapability({
      resolveModule: () => path.join(sdkDir, 'dist', 'cjs', 'extension.js'),
      runHelp: () => '--experimental\n--extension-sdk-path <directory>\n',
    })).rejects.toMatchObject<Partial<NativeBridgeCapabilityError>>({
      code: 'SDK_PACKAGE_INVALID',
      message: expect.stringContaining('missing index.js'),
    });
  });

  it('returns an explicit error when required CLI flags are absent', async () => {
    await expect(resolveNativeBridgeCapability({
      runHelp: () => '--experimental\n',
    })).rejects.toMatchObject<Partial<NativeBridgeCapabilityError>>({
      name: 'NativeBridgeCapabilityError',
      code: 'CLI_FLAGS_MISSING',
      message: expect.stringContaining('--extension-sdk-path'),
    });
  });

  it('returns an explicit error when the extension export cannot resolve', async () => {
    await expect(resolveNativeBridgeCapability({
      resolveModule: () => {
        throw new Error('missing');
      },
    })).rejects.toMatchObject<Partial<NativeBridgeCapabilityError>>({
      code: 'SDK_EXTENSION_NOT_FOUND',
    });
  });
});
