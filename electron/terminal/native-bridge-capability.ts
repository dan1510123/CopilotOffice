import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';

export type NativeBridgeCapabilityErrorCode =
  | 'SDK_EXTENSION_NOT_FOUND'
  | 'SDK_PACKAGE_INVALID'
  | 'CLI_NOT_FOUND'
  | 'CLI_HELP_FAILED'
  | 'CLI_FLAGS_MISSING';

export class NativeBridgeCapabilityError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly code: NativeBridgeCapabilityErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'NativeBridgeCapabilityError';
    this.cause = options?.cause;
  }
}

export interface NativeBridgeHelpCapability {
  supported: boolean;
  missingFlags: Array<'--experimental' | '--extension-sdk-path'>;
}

export interface NativeBridgeCapability {
  cliPath: string;
  extensionExportPath: string;
  sdkPackageDir: string;
}

interface CapabilityDependencies {
  resolveModule?: (id: string) => string;
  runHelp?: (cliPath: string) => string;
  platform?: NodeJS.Platform;
  arch?: string;
}

export function interpretNativeBridgeHelp(helpText: string): NativeBridgeHelpCapability {
  const missingFlags: NativeBridgeHelpCapability['missingFlags'] = [];
  if (!/(?:^|\s)--experimental(?:\s|$)/m.test(helpText)) missingFlags.push('--experimental');
  if (!/(?:^|\s)--extension-sdk-path(?:\s|$)/m.test(helpText)) {
    missingFlags.push('--extension-sdk-path');
  }
  return { supported: missingFlags.length === 0, missingFlags };
}

export async function resolveNativeBridgeCapability(
  dependencies: CapabilityDependencies = {},
): Promise<NativeBridgeCapability> {
  const resolveModule = dependencies.resolveModule ?? require.resolve;
  let extensionExportPath: string;
  try {
    extensionExportPath = resolveModule('@github/copilot-sdk/extension');
  } catch (error) {
    throw new NativeBridgeCapabilityError(
      'SDK_EXTENSION_NOT_FOUND',
      'Installed @github/copilot-sdk does not expose @github/copilot-sdk/extension',
      { cause: error },
    );
  }

  const sdkPackageDir = await findSdkPackageDir(extensionExportPath);
  const platform = dependencies.platform ?? process.platform;
  const arch = dependencies.arch ?? process.arch;
  let cliPath: string;
  try {
    cliPath = resolveModule(`@github/copilot-${platform}-${arch}`);
  } catch (error) {
    throw new NativeBridgeCapabilityError(
      'CLI_NOT_FOUND',
      `Pinned Copilot CLI binary is unavailable for ${platform}-${arch}`,
      { cause: error },
    );
  }

  let helpText: string;
  try {
    helpText = (dependencies.runHelp ?? runCliHelp)(cliPath);
  } catch (error) {
    throw new NativeBridgeCapabilityError(
      'CLI_HELP_FAILED',
      `Failed to probe pinned Copilot CLI help at ${cliPath}`,
      { cause: error },
    );
  }
  const interpretation = interpretNativeBridgeHelp(helpText);
  if (!interpretation.supported) {
    throw new NativeBridgeCapabilityError(
      'CLI_FLAGS_MISSING',
      `Pinned Copilot CLI lacks required native bridge flags: ${interpretation.missingFlags.join(', ')}`,
    );
  }

  return { cliPath, extensionExportPath, sdkPackageDir };
}

async function findSdkPackageDir(extensionExportPath: string): Promise<string> {
  let current = path.dirname(extensionExportPath);
  while (true) {
    const packagePath = path.join(current, 'package.json');
    try {
      const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8')) as { name?: unknown };
      if (packageJson.name === '@github/copilot-sdk') return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new NativeBridgeCapabilityError(
          'SDK_PACKAGE_INVALID',
          `Unable to read Copilot SDK package metadata at ${packagePath}`,
          { cause: error },
        );
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new NativeBridgeCapabilityError(
        'SDK_PACKAGE_INVALID',
        `Could not locate @github/copilot-sdk package directory from ${extensionExportPath}`,
      );
    }
    current = parent;
  }
}

function runCliHelp(cliPath: string): string {
  return execFileSync(cliPath, ['--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}
