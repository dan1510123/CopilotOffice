import { describe, expect, it } from 'vitest';
import {
  NativeBridgeCapabilityError,
  interpretNativeBridgeHelp,
  resolveNativeBridgeCapability,
} from '../../../electron/terminal/native-bridge-capability';

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
