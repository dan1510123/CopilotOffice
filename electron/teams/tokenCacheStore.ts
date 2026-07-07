// Encrypted-at-rest persistence for cached Teams tokens (Graph + ic3).
//
// Tokens are live bearer credentials, so they are stored ONLY encrypted via Electron
// safeStorage (OS-backed: DPAPI on Windows, Keychain on macOS, libsecret/kwallet on
// Linux). This lets a still-valid token survive an app restart and skip the slow
// `az account get-access-token` cold-start, without ever writing a plaintext secret.
//
// Fails safe: if OS encryption is unavailable, nothing is persisted (the in-memory +
// `az` path still works). On any decrypt/parse error the file is removed and treated
// as empty. The safeStorage + fs seams are injectable so this is unit-testable.

import * as fs from 'fs';
import * as path from 'path';
import type { TokenPersistence, TokenResource } from './auth';

interface CachedTokenShape {
  token: string;
  expiresAt: number;
}

/** Minimal slice of Electron's `safeStorage` used here (injectable for tests). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Minimal fs slice (injectable for tests). */
export interface FsLike {
  existsSync(p: string): boolean;
  readFileSync(p: string): Buffer;
  writeFileSync(p: string, data: Buffer): void;
  mkdirSync(p: string, opts: { recursive: boolean }): void;
  rmSync(p: string, opts: { force: boolean }): void;
}

const RESOURCES: TokenResource[] = ['graph', 'ic3'];

/**
 * Build a TokenPersistence backed by an encrypted file at `filePath`. `now` is only
 * used to drop already-expired tokens on load so we never hand back a stale one.
 */
export function createSafeStorageTokenPersistence(
  filePath: string,
  safeStorage: SafeStorageLike,
  opts: { fsLike?: FsLike; now?: () => number } = {},
): TokenPersistence {
  const fsLike: FsLike = opts.fsLike ?? fs;
  const now = opts.now ?? Date.now;

  return {
    load(): Partial<Record<TokenResource, CachedTokenShape>> {
      try {
        if (!safeStorage.isEncryptionAvailable()) return {};
        if (!fsLike.existsSync(filePath)) return {};
        const buf = fsLike.readFileSync(filePath);
        const json = safeStorage.decryptString(buf);
        const parsed = JSON.parse(json) as Record<string, unknown>;
        const out: Partial<Record<TokenResource, CachedTokenShape>> = {};
        for (const res of RESOURCES) {
          const ct = parsed?.[res] as Partial<CachedTokenShape> | undefined;
          if (
            ct &&
            typeof ct.token === 'string' &&
            ct.token &&
            typeof ct.expiresAt === 'number' &&
            ct.expiresAt > now() // drop already-expired tokens
          ) {
            out[res] = { token: ct.token, expiresAt: ct.expiresAt };
          }
        }
        return out;
      } catch {
        // Corrupt/undecryptable (e.g. different OS user) — remove so we stop failing.
        try {
          fsLike.rmSync(filePath, { force: true });
        } catch {
          /* ignore */
        }
        return {};
      }
    },

    save(all: Partial<Record<TokenResource, CachedTokenShape>>): void {
      try {
        if (!safeStorage.isEncryptionAvailable()) return; // never persist plaintext
        const json = JSON.stringify(all);
        const enc = safeStorage.encryptString(json);
        fsLike.mkdirSync(path.dirname(filePath), { recursive: true });
        fsLike.writeFileSync(filePath, enc);
      } catch {
        /* best-effort; token acquisition must not depend on a successful write */
      }
    },
  };
}
