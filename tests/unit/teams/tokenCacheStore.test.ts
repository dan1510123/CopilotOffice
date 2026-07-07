import { describe, expect, it, vi } from 'vitest';
import { createSafeStorageTokenPersistence, type FsLike, type SafeStorageLike } from '../../../electron/teams/tokenCacheStore';

const FILE = '/tmp/teams-token.enc';

/** In-memory fs seam. */
function makeFs(initial?: Buffer): FsLike & { store: { buf: Buffer | null }; removed: boolean } {
  const store = { buf: initial ?? null };
  let removed = false;
  return {
    store,
    get removed() {
      return removed;
    },
    existsSync: () => store.buf !== null,
    readFileSync: () => {
      if (store.buf === null) throw new Error('ENOENT');
      return store.buf;
    },
    writeFileSync: (_p: string, data: Buffer) => {
      store.buf = data;
    },
    mkdirSync: () => {},
    rmSync: () => {
      store.buf = null;
      removed = true;
    },
  };
}

/** Reversible "encryption": prefix-tagged JSON so tests can assert no plaintext leak. */
function makeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.concat([Buffer.from('ENC:'), Buffer.from(s, 'utf8')]),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf8');
      if (!s.startsWith('ENC:')) throw new Error('not our ciphertext');
      return s.slice(4);
    },
  };
}

const future = Date.now() + 3600_000;
const past = Date.now() - 1000;

describe('createSafeStorageTokenPersistence', () => {
  it('round-trips tokens through save → load', () => {
    const fsLike = makeFs();
    const p = createSafeStorageTokenPersistence(FILE, makeSafeStorage(), { fsLike });
    p.save({ graph: { token: 'g-tok', expiresAt: future }, ic3: { token: 'i-tok', expiresAt: future } });
    const loaded = p.load();
    expect(loaded.graph).toEqual({ token: 'g-tok', expiresAt: future });
    expect(loaded.ic3).toEqual({ token: 'i-tok', expiresAt: future });
  });

  it('never writes plaintext to disk (bytes are encrypted)', () => {
    const fsLike = makeFs();
    const p = createSafeStorageTokenPersistence(FILE, makeSafeStorage(), { fsLike });
    p.save({ graph: { token: 'super-secret-token', expiresAt: future } });
    expect(fsLike.store.buf!.toString('utf8').startsWith('ENC:')).toBe(true);
    // The raw token appears only inside the ENC-tagged blob our fake "decrypts";
    // a real safeStorage produces opaque ciphertext. Assert our seam tagged it.
    expect(fsLike.store.buf!.subarray(0, 4).toString()).toBe('ENC:');
  });

  it('drops already-expired tokens on load', () => {
    const fsLike = makeFs();
    const p = createSafeStorageTokenPersistence(FILE, makeSafeStorage(), { fsLike, now: () => Date.now() });
    p.save({ graph: { token: 'g', expiresAt: past }, ic3: { token: 'i', expiresAt: future } });
    const loaded = p.load();
    expect(loaded.graph).toBeUndefined();
    expect(loaded.ic3?.token).toBe('i');
  });

  it('persists nothing when OS encryption is unavailable', () => {
    const fsLike = makeFs();
    const p = createSafeStorageTokenPersistence(FILE, makeSafeStorage(false), { fsLike });
    p.save({ graph: { token: 'g', expiresAt: future } });
    expect(fsLike.store.buf).toBeNull(); // nothing written
    expect(p.load()).toEqual({}); // and nothing loaded
  });

  it('returns {} and removes the file on undecryptable content', () => {
    const fsLike = makeFs(Buffer.from('CORRUPT-not-our-ciphertext'));
    const p = createSafeStorageTokenPersistence(FILE, makeSafeStorage(), { fsLike });
    expect(p.load()).toEqual({});
    expect(fsLike.removed).toBe(true);
  });

  it('returns {} when the file does not exist', () => {
    const fsLike = makeFs();
    const p = createSafeStorageTokenPersistence(FILE, makeSafeStorage(), { fsLike });
    expect(p.load()).toEqual({});
  });

  it('ignores malformed entries (missing token / bad expiresAt)', () => {
    const fsLike = makeFs();
    const ss = makeSafeStorage();
    // Hand-craft a payload with bad shapes.
    fsLike.store.buf = ss.encryptString(
      JSON.stringify({ graph: { token: '', expiresAt: future }, ic3: { token: 'ok', expiresAt: 'nope' } }),
    );
    const p = createSafeStorageTokenPersistence(FILE, ss, { fsLike });
    expect(p.load()).toEqual({});
  });
});
