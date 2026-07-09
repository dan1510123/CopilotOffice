import { existsSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  resolveBundledCopilotCliPath,
  resolveCopilotCliPath,
} from '../../../electron/terminal/terminal-backend';

describe('resolveBundledCopilotCliPath', () => {
  it('resolves the copilot binary shipped via the @github/copilot-sdk dependency chain', () => {
    // @github/copilot-sdk -> @github/copilot -> @github/copilot-<platform>-<arch>
    // is a production dependency, so the platform binary is always installed.
    const bundled = resolveBundledCopilotCliPath();
    expect(bundled).toBeTruthy();
    expect(bundled!.toLowerCase()).toContain('copilot');
    expect(bundled!.toLowerCase()).toContain(`copilot-${process.platform}-${process.arch}`);
  });

  it('resolves to an executable that actually exists on disk', () => {
    const bundled = resolveBundledCopilotCliPath();
    expect(bundled).toBeTruthy();
    expect(existsSync(bundled!)).toBe(true);
  });
});

describe('resolveCopilotCliPath', () => {
  it('prefers the bundled binary over whatever copilot is first on PATH', () => {
    const bundled = resolveBundledCopilotCliPath();
    expect(bundled).toBeTruthy();

    // A PATH containing an unrelated (even bogus) copilot must not win.
    const resolved = resolveCopilotCliPath(process.cwd(), 'C:\\bogus\\path;/usr/bogus/bin');
    expect(resolved).toBe(bundled);
  });

  it('returns the bundled binary regardless of an empty PATH', () => {
    const bundled = resolveBundledCopilotCliPath();
    expect(resolveCopilotCliPath(process.cwd(), undefined)).toBe(bundled);
    expect(resolveCopilotCliPath(process.cwd(), '')).toBe(bundled);
  });

  it('never returns the VS Code copilot-chat wrapper when the bundled binary exists', () => {
    const resolved = resolveCopilotCliPath(process.cwd(), process.env.PATH);
    expect(resolved).toBeTruthy();
    expect(resolved!.toLowerCase()).not.toContain('github.copilot-chat');
  });
});
