import { describe, it, expect, vi } from 'vitest';
import {
  TerminalInstanceCache,
  terminalCacheKey,
  type TerminalCacheEntry,
  type CreatedTerminal,
} from '../../../src/ui/TerminalInstanceCache';

// Structural stand-ins for xterm's Terminal / FitAddon — the cache only calls
// dispose() and fit() on them, so these minimal fakes suffice.
function makeCreated(): { created: CreatedTerminal; dispose: ReturnType<typeof vi.fn>; fit: ReturnType<typeof vi.fn>; inputDispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn();
  const fit = vi.fn();
  const inputDispose = vi.fn();
  const created = {
    terminal: { dispose } as any,
    fitAddon: { fit } as any,
    inputBinding: { dispose: inputDispose },
  };
  return { created, dispose, fit, inputDispose };
}

function makeCache(opts?: { maxEntries?: number; onEvict?: (e: TerminalCacheEntry) => void; parent?: HTMLElement }) {
  const disposes: Record<string, ReturnType<typeof vi.fn>> = {};
  const fits: Record<string, ReturnType<typeof vi.fn>> = {};
  const inputDisposes: Record<string, ReturnType<typeof vi.fn>> = {};
  const createTerminal = vi.fn((ctx: { officeId: string; agentId: string; host: HTMLElement }) => {
    const { created, dispose, fit, inputDispose } = makeCreated();
    const k = terminalCacheKey(ctx.officeId, ctx.agentId);
    disposes[k] = dispose;
    fits[k] = fit;
    inputDisposes[k] = inputDispose;
    return created;
  });
  const cache = new TerminalInstanceCache({
    createTerminal,
    maxEntries: opts?.maxEntries,
    onEvict: opts?.onEvict,
    parent: opts?.parent,
  });
  return { cache, createTerminal, disposes, fits, inputDisposes };
}

describe('terminalCacheKey', () => {
  it('composes officeId + agentId and separates offices for the same agent', () => {
    expect(terminalCacheKey('office-0', 'gene')).not.toBe(terminalCacheKey('office-1', 'gene'));
  });
});

describe('acquire — hit vs miss', () => {
  it('creates a fresh terminal on miss (created=true) and reuses it on hit (created=false)', () => {
    const { cache, createTerminal } = makeCache();
    const first = cache.acquire('office-0', 'gene');
    expect(first.created).toBe(true);
    expect(createTerminal).toHaveBeenCalledTimes(1);

    const second = cache.acquire('office-0', 'gene');
    expect(second.created).toBe(false);
    expect(second.entry).toBe(first.entry);
    expect(createTerminal).toHaveBeenCalledTimes(1);
  });

  it('keys by composite office+agent — same agent id in two offices are distinct entries', () => {
    const { cache } = makeCache();
    const a = cache.acquire('office-0', 'gene');
    const b = cache.acquire('office-1', 'gene');
    expect(a.entry).not.toBe(b.entry);
    expect(cache.size).toBe(2);
  });
});

describe('LRU ordering and six-entry eviction', () => {
  it('evicts the least-recently-used entry when exceeding maxEntries (default 6)', () => {
    const evicted: string[] = [];
    const { cache } = makeCache({ onEvict: (e) => evicted.push(e.agentId) });
    for (const a of ['a', 'b', 'c', 'd', 'e', 'f']) cache.acquire('o', a);
    expect(cache.size).toBe(6);

    // Touch 'a' so 'b' becomes the LRU.
    cache.acquire('o', 'a');
    // Add a 7th → evicts LRU which is now 'b'.
    cache.acquire('o', 'g');
    expect(evicted).toEqual(['b']);
    expect(cache.size).toBe(6);
    expect(cache.has('o', 'a')).toBe(true);
    expect(cache.has('o', 'b')).toBe(false);
    expect(cache.has('o', 'g')).toBe(true);
  });

  it('activate() promotes an entry to most-recently-used so it survives eviction', () => {
    const evicted: string[] = [];
    const { cache } = makeCache({ maxEntries: 3, onEvict: (e) => evicted.push(e.agentId) });
    cache.acquire('o', 'a');
    cache.acquire('o', 'b');
    cache.acquire('o', 'c');
    cache.activate('o', 'a'); // 'a' now MRU; but it is also visible

    cache.acquire('o', 'd'); // evict LRU excluding visible → 'b'
    expect(evicted).toEqual(['b']);
    expect(cache.has('o', 'a')).toBe(true);
  });

  it('never evicts the currently-visible entry', () => {
    const evicted: string[] = [];
    const { cache } = makeCache({ maxEntries: 2, onEvict: (e) => evicted.push(e.agentId) });
    cache.acquire('o', 'a');
    cache.acquire('o', 'b');
    cache.activate('o', 'a'); // 'a' visible + MRU
    cache.acquire('o', 'c');  // at capacity → must evict, but not visible 'a' → evict 'b'
    expect(evicted).toEqual(['b']);
    expect(cache.has('o', 'a')).toBe(true);
    expect(cache.has('o', 'c')).toBe(true);
  });
});

describe('visibility (activate / hide)', () => {
  it('shows exactly one host and hides the previously visible one', () => {
    const parent = document.createElement('div');
    const { cache } = makeCache({ parent });
    cache.acquire('o', 'a');
    cache.acquire('o', 'b');

    const a = cache.activate('o', 'a')!;
    expect(a.host.style.display).toBe('');
    const b = cache.activate('o', 'b')!;
    expect(b.host.style.display).toBe('');
    expect(a.host.style.display).toBe('none');
    expect(cache.getVisible()).toBe(b);
  });

  it('fits only the entry being activated', () => {
    const { cache, fits } = makeCache();
    cache.acquire('o', 'a');
    cache.activate('o', 'a');
    expect(fits[terminalCacheKey('o', 'a')]).toHaveBeenCalledTimes(1);
  });

  it('hide() hides the visible host without disposing the entry', () => {
    const { cache, disposes } = makeCache();
    cache.acquire('o', 'a');
    const entry = cache.activate('o', 'a')!;
    cache.hide();
    expect(entry.host.style.display).toBe('none');
    expect(cache.getVisible()).toBeUndefined();
    expect(cache.has('o', 'a')).toBe(true);
    expect(disposes[terminalCacheKey('o', 'a')]).not.toHaveBeenCalled();
  });

  it('activate() on a miss returns undefined and changes nothing', () => {
    const { cache } = makeCache();
    expect(cache.activate('o', 'ghost')).toBeUndefined();
    expect(cache.getVisible()).toBeUndefined();
  });
});

describe('session identity + attachment flags', () => {
  it('tracks sessionId (generation token) and attached state per entry', () => {
    const { cache } = makeCache();
    cache.acquire('o', 'a');
    expect(cache.peek('o', 'a')!.sessionId).toBeNull();
    expect(cache.peek('o', 'a')!.attached).toBe(false);
    cache.setSessionId('o', 'a', 'sess-1');
    cache.setAttached('o', 'a', true);
    expect(cache.peek('o', 'a')!.sessionId).toBe('sess-1');
    expect(cache.peek('o', 'a')!.attached).toBe(true);
  });
});

describe('invalidate / invalidateOffice / destroy', () => {
  it('invalidate() disposes one entry, runs onEvict first, removes the host', () => {
    const order: string[] = [];
    const parent = document.createElement('div');
    const { cache, disposes, inputDisposes } = makeCache({
      parent,
      onEvict: () => order.push('onEvict'),
    });
    const entry = cache.acquire('o', 'a').entry;
    parent.appendChild(entry.host); // (already appended by cache)
    const key = terminalCacheKey('o', 'a');
    disposes[key].mockImplementation(() => order.push('dispose'));

    expect(cache.invalidate('o', 'a')).toBe(true);
    expect(order).toEqual(['onEvict', 'dispose']);
    expect(inputDisposes[key]).toHaveBeenCalled();
    expect(cache.has('o', 'a')).toBe(false);
    expect(parent.contains(entry.host)).toBe(false);
  });

  it('invalidate() on a miss returns false', () => {
    const { cache } = makeCache();
    expect(cache.invalidate('o', 'ghost')).toBe(false);
  });

  it('invalidateOffice() evicts only entries for that office', () => {
    const { cache } = makeCache();
    cache.acquire('office-0', 'a');
    cache.acquire('office-0', 'b');
    cache.acquire('office-1', 'a');
    cache.invalidateOffice('office-0');
    expect(cache.has('office-0', 'a')).toBe(false);
    expect(cache.has('office-0', 'b')).toBe(false);
    expect(cache.has('office-1', 'a')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('destroy() disposes every entry and rejects further use', () => {
    const evicted: string[] = [];
    const { cache } = makeCache({ onEvict: (e) => evicted.push(e.agentId) });
    cache.acquire('o', 'a');
    cache.acquire('o', 'b');
    cache.destroy();
    expect(evicted.sort()).toEqual(['a', 'b']);
    expect(cache.size).toBe(0);
    expect(() => cache.acquire('o', 'c')).toThrow(/after destroy/);
  });
});

describe('eviction resource safety', () => {
  it('still disposes terminal/host when onEvict throws', () => {
    const parent = document.createElement('div');
    const { cache, disposes } = makeCache({
      parent,
      onEvict: () => {
        throw new Error('detach failed');
      },
    });
    const entry = cache.acquire('o', 'a').entry;
    const key = terminalCacheKey('o', 'a');
    expect(() => cache.invalidate('o', 'a')).not.toThrow();
    expect(disposes[key]).toHaveBeenCalled();
    expect(parent.contains(entry.host)).toBe(false);
  });
});
