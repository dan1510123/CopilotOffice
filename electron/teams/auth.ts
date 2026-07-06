// T010 — Token provider over `az account get-access-token`.
//
// Two user-scoped tokens are needed: Graph (send channel messages) and ic3
// (receive via Trouter/chatsvc). Both are acquired non-interactively from the Azure CLI.
// Tokens are cached in memory keyed by resource, decoded for their JWT `exp`, and
// proactively refreshed with a buffer. On refresh failure a still-valid cached token is
// reused (graceful degradation). Secrets are NEVER logged or persisted.

import { execFile } from 'child_process';

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
const defaultAzRunner: AzRunner = (resourceUrl: string) =>
  new Promise<string>((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'az.cmd' : 'az';
    execFile(
      cmd,
      ['account', 'get-access-token', '--resource', resourceUrl, '--output', 'json'],
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

  /** `runner` is injectable for tests (defaults to the real `az` CLI). */
  constructor(private readonly runner: AzRunner = defaultAzRunner) {}

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
      return token;
    } catch (e) {
      // Graceful degradation: reuse a still-valid cached token if we have one.
      if (cached && cached.expiresAt > now) {
        console.warn(`[Teams] Token refresh failed for ${resource}; reusing cached token.`);
        return cached.token;
      }
      throw e;
    }
  }
}
