// T010 — Token provider over `az account get-access-token`.
//
// Two user-scoped tokens are needed: Graph (send channel messages) and ic3
// (receive via Trouter/chatsvc). Both are acquired non-interactively from the Azure CLI.
// Tokens are cached in memory keyed by resource, decoded for their JWT `exp`, and
// proactively refreshed with a buffer. On refresh failure a still-valid cached token is
// reused (graceful degradation). Secrets are NEVER logged or persisted.

import { execFile } from 'child_process';
import { tlog, twarn } from './log';

export type TokenResource = 'graph' | 'ic3';

export interface TokenProvider {
  /** Valid bearer token for a resource; refreshes if near expiry. */
  getToken(resource: TokenResource): Promise<string>;
}

const RESOURCE_URLS: Record<TokenResource, string> = {
  graph: 'https://graph.microsoft.com',
  ic3: 'https://ic3.teams.office.com',
};

/** Refresh when fewer than this many ms remain before expiry. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number; // unix ms
}

/**
 * Optional persistence for cached tokens across app restarts. Implementations must
 * store tokens ENCRYPTED at rest (e.g. Electron safeStorage / OS DPAPI-Keychain).
 * Injected so `auth.ts` stays free of any electron/fs dependency and unit-testable.
 */
export interface TokenPersistence {
  /** Load any persisted, still-usable tokens keyed by resource. Best-effort ({} on error). */
  load(): Partial<Record<TokenResource, CachedToken>>;
  /** Persist the current token cache (encrypted). Best-effort (never throws). */
  save(all: Partial<Record<TokenResource, CachedToken>>): void;
}

/** Decode a JWT `exp` (seconds) → unix ms. Returns 0 when unparseable. */
export function decodeJwtExpMs(token: string): number {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return 0;
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'),
    );
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

type AzRunner = (resourceUrl: string) => Promise<string>;

/** Run `az account get-access-token --resource <url>` and return the accessToken. */
export const defaultAzRunner: AzRunner = (resourceUrl: string) =>
  new Promise<string>((resolve, reject) => {
    // Node 20.12+/22+ (Electron 40) reject spawning `.cmd`/`.bat` files directly
    // (CVE-2024-27980 hardening → EINVAL). On Windows we therefore invoke the
    // Azure CLI through cmd.exe (a real .exe), which resolves `az.cmd` from PATH.
    // `resourceUrl` is a fixed constant from RESOURCE_URLS (no user input), so
    // string interpolation into the command is safe. On POSIX we exec `az`
    // directly with an argv array (no shell).
    const isWin = process.platform === 'win32';
    const azArgs = ['account', 'get-access-token', '--resource', resourceUrl, '--output', 'json'];
    const [file, args] = isWin
      ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `az ${azArgs.join(' ')}`]]
      : ['az', azArgs];
    execFile(
      file,
      args,
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          // Do not include stdout/stderr (may contain a token) in the error.
          reject(new Error(`az token acquisition failed for ${resourceUrl} (${err.message})`));
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const token = String(parsed?.accessToken || '');
          if (!token) {
            reject(new Error(`az returned no accessToken for ${resourceUrl}`));
            return;
          }
          resolve(token);
        } catch {
          reject(new Error(`Failed to parse az token output for ${resourceUrl}`));
        }
      },
    );
  });

export class AzTokenProvider implements TokenProvider {
  private cache = new Map<TokenResource, CachedToken>();

  /**
   * `runner` is injectable for tests (defaults to the real `az` CLI). `persistence`
   * (optional) seeds the in-memory cache from an encrypted on-disk store at startup
   * and is updated on every successful acquisition, so a still-valid token survives
   * app restarts and avoids a slow `az` cold-start.
   */
  constructor(
    private readonly runner: AzRunner = defaultAzRunner,
    private readonly persistence?: TokenPersistence,
  ) {
    if (persistence) {
      try {
        const loaded = persistence.load();
        for (const [res, ct] of Object.entries(loaded)) {
          if (ct && typeof ct.token === 'string' && ct.token && typeof ct.expiresAt === 'number') {
            this.cache.set(res as TokenResource, ct);
          }
        }
      } catch {
        /* ignore — fall back to acquiring fresh tokens via the runner */
      }
    }
  }

  private saveCache(): void {
    if (!this.persistence) return;
    try {
      const all: Partial<Record<TokenResource, CachedToken>> = {};
      for (const [res, ct] of this.cache.entries()) all[res] = ct;
      this.persistence.save(all);
    } catch {
      /* best-effort persistence; never block token acquisition on a write failure */
    }
  }

  async getToken(resource: TokenResource): Promise<string> {
    const now = Date.now();
    const cached = this.cache.get(resource);
    if (cached && cached.expiresAt - now > REFRESH_BUFFER_MS) {
      return cached.token;
    }

    try {
      const token = await this.runner(RESOURCE_URLS[resource]);
      const expMs = decodeJwtExpMs(token);
      // Fall back to a short TTL when exp can't be decoded.
      const expiresAt = expMs > 0 ? expMs : now + 30 * 60 * 1000;
      this.cache.set(resource, { token, expiresAt });
      this.saveCache();
      // Log the acquisition + expiry only — NEVER the token itself.
      tlog(`Acquired ${resource} token (expires ${new Date(expiresAt).toISOString()}).`);
      return token;
    } catch (e) {
      // Graceful degradation: reuse a still-valid cached token if we have one.
      if (cached && cached.expiresAt > now) {
        twarn(`Token refresh failed for ${resource}; reusing cached token.`);
        return cached.token;
      }
      throw e;
    }
  }
}
