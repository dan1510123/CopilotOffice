// Six-entry LRU xterm instance cache (spec 021 Phase 4).
//
// Each UI terminal surface (TerminalOverlay, SeriousTerminalController) owns ONE
// of these. Instead of reusing a single xterm and replaying up to 512 KB of
// scrollback on every agent switch, the surface retains up to six live xterm
// instances — one per recently-viewed agent — so a warm switch re-shows an
// already-rendered terminal without reset/clear/replay.
//
// This module owns ONLY lifecycle + bookkeeping:
//   - composite `officeId + agentId` keying (NEVER agentId alone — the same
//     agent id can be cached across two offices and must not cross streams),
//   - LRU ordering + six-entry eviction,
//   - a hidden DOM host per entry (exactly one visible at a time),
//   - session identity + attachment flags per entry,
//   - deterministic disposal on evict/invalidate/destroy.
//
// It delegates the surface-specific xterm construction (theme, FitAddon, wheel/
// clipboard/context-menu handlers, input binding) to an injected factory so each
// differently-styled surface keeps its own look while sharing identical cache
// behavior. The cache never talks to `window.copilotBridge`; detaching the
// server viewer on eviction is the surface's job via the `onEvict` hook.

import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

/** Minimal disposable shape (xterm's `IDisposable`, or any custom binding). */
export interface CacheDisposable {
  dispose(): void;
}

/** A single retained terminal, keyed by composite `officeId:agentId`. */
export interface TerminalCacheEntry {
  readonly officeId: string;
  readonly agentId: string;
  /** Composite cache key — `officeId` + separator + `agentId`. */
  readonly key: string;
  readonly terminal: Terminal;
  readonly fitAddon: FitAddon;
  /** Hidden DOM host the terminal was `open()`ed on; owned by the cache. */
  readonly host: HTMLElement;
  /**
   * Authoritative session id this entry is bound to (the generation token). Used
   * by the surface to drop terminal-data whose `sessionId` no longer matches
   * after a New/Close/Replace session. `null` until the first id is known.
   */
  sessionId: string | null;
  /** True while the server viewer for this entry is attached. */
  attached: boolean;
  /** Disposable returned by `terminal.onData(...)`, if the factory bound one. */
  inputBinding: CacheDisposable | null;
}

/** What the injected factory returns for a cache miss. */
export interface CreatedTerminal {
  terminal: Terminal;
  fitAddon: FitAddon;
  /** Optional input binding (`terminal.onData` disposable) owned by the entry. */
  inputBinding?: CacheDisposable | null;
}

/** Context handed to the factory so it can `open()` onto the cache-owned host. */
export interface TerminalCacheFactoryContext {
  officeId: string;
  agentId: string;
  /** Hidden host element already appended to the parent; call `terminal.open(host)`. */
  host: HTMLElement;
}

export interface TerminalInstanceCacheOptions {
  /**
   * Creates a fresh xterm for a cache miss. MUST call `terminal.open(ctx.host)`
   * and load the FitAddon. The cache handles host visibility, fit-on-activate,
   * LRU, and disposal.
   */
  createTerminal: (ctx: TerminalCacheFactoryContext) => CreatedTerminal;
  /** Max retained entries before LRU eviction. Default 6. */
  maxEntries?: number;
  /**
   * Parent element the cache appends each entry's hidden host to. Optional —
   * when omitted, hosts are created detached (useful for headless tests).
   */
  parent?: HTMLElement;
  /**
   * Invoked with an entry immediately BEFORE it is disposed (evict / invalidate /
   * destroy). The surface uses this to detach the server viewer for that exact
   * composite key so an evicted background terminal stops receiving output.
   */
  onEvict?: (entry: TerminalCacheEntry) => void;
}

/** NUL separator — safe because office/agent ids never contain it. */
const KEY_SEP = '\u0000';

export function terminalCacheKey(officeId: string, agentId: string): string {
  return `${officeId}${KEY_SEP}${agentId}`;
}

/**
 * Bounded LRU cache of live xterm instances. Insertion order of the backing Map
 * is the LRU order (oldest first); every `get`/`activate` moves the touched
 * entry to the most-recently-used end.
 */
export class TerminalInstanceCache {
  private readonly entries = new Map<string, TerminalCacheEntry>();
  private readonly maxEntries: number;
  private readonly createTerminal: TerminalInstanceCacheOptions['createTerminal'];
  private readonly parent?: HTMLElement;
  private readonly onEvict?: (entry: TerminalCacheEntry) => void;
  /** Key of the single currently-visible entry, or null when all are hidden. */
  private visibleKey: string | null = null;
  private destroyed = false;

  constructor(options: TerminalInstanceCacheOptions) {
    this.createTerminal = options.createTerminal;
    this.maxEntries = Math.max(1, options.maxEntries ?? 6);
    this.parent = options.parent;
    this.onEvict = options.onEvict;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Composite keys in LRU order (oldest first). Test/inspection aid. */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  has(officeId: string, agentId: string): boolean {
    return this.entries.has(terminalCacheKey(officeId, agentId));
  }

  /** Get without changing LRU order (peek). Returns undefined on miss. */
  peek(officeId: string, agentId: string): TerminalCacheEntry | undefined {
    return this.entries.get(terminalCacheKey(officeId, agentId));
  }

  /**
   * Get an entry, ensuring one exists. On a cache MISS a fresh terminal is
   * created via the factory (evicting the LRU entry first if at capacity). The
   * returned entry becomes most-recently-used. `created` distinguishes a cold
   * (miss → factory) entry from a warm (hit) one so the caller can decide
   * whether to request scrollback.
   */
  acquire(officeId: string, agentId: string): { entry: TerminalCacheEntry; created: boolean } {
    this.assertLive();
    const key = terminalCacheKey(officeId, agentId);
    const existing = this.entries.get(key);
    if (existing) {
      this.touch(key);
      return { entry: existing, created: false };
    }

    if (this.entries.size >= this.maxEntries) {
      this.evictLru();
    }

    const host = document.createElement('div');
    host.dataset.terminalCacheKey = key;
    host.style.width = '100%';
    host.style.height = '100%';
    host.style.display = 'none';
    this.parent?.appendChild(host);

    const created = this.createTerminal({ officeId, agentId, host });
    const entry: TerminalCacheEntry = {
      officeId,
      agentId,
      key,
      terminal: created.terminal,
      fitAddon: created.fitAddon,
      host,
      sessionId: null,
      attached: false,
      inputBinding: created.inputBinding ?? null,
    };
    this.entries.set(key, entry);
    return { entry, created: true };
  }

  /**
   * Make an entry the single visible one: hide the previously visible host, show
   * this entry's host, fit it (visible entries only — hidden entries never do
   * layout work), and mark it most-recently-used. No-op-safe on a missing entry
   * (returns undefined). Does NOT dispose or detach anything.
   */
  activate(officeId: string, agentId: string): TerminalCacheEntry | undefined {
    this.assertLive();
    const key = terminalCacheKey(officeId, agentId);
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (this.visibleKey && this.visibleKey !== key) {
      const prev = this.entries.get(this.visibleKey);
      if (prev) prev.host.style.display = 'none';
    }
    entry.host.style.display = '';
    this.visibleKey = key;
    this.touch(key);
    try {
      entry.fitAddon.fit();
    } catch {
      // Hidden/zero-size layout during tests or transient states — non-fatal.
    }
    return entry;
  }

  /** Hide the currently-visible entry (retain it; no dispose/detach). */
  hide(): void {
    if (!this.visibleKey) return;
    const entry = this.entries.get(this.visibleKey);
    if (entry) entry.host.style.display = 'none';
    this.visibleKey = null;
  }

  /** The currently-visible entry, or undefined when hidden. */
  getVisible(): TerminalCacheEntry | undefined {
    return this.visibleKey ? this.entries.get(this.visibleKey) : undefined;
  }

  setSessionId(officeId: string, agentId: string, sessionId: string | null): void {
    const entry = this.entries.get(terminalCacheKey(officeId, agentId));
    if (entry) entry.sessionId = sessionId;
  }

  setAttached(officeId: string, agentId: string, attached: boolean): void {
    const entry = this.entries.get(terminalCacheKey(officeId, agentId));
    if (entry) entry.attached = attached;
  }

  /**
   * Evict a single entry by composite key (New/Close/Replace session, office
   * teardown). Disposes it after the `onEvict` hook runs. Returns true if an
   * entry was removed.
   */
  invalidate(officeId: string, agentId: string): boolean {
    const key = terminalCacheKey(officeId, agentId);
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.disposeEntry(entry);
    return true;
  }

  /** Evict every entry belonging to an office (e.g. an office is deleted). */
  invalidateOffice(officeId: string): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.officeId === officeId) this.disposeEntry(entry);
    }
  }

  /** Dispose ALL entries and detach every server viewer. The cache is unusable after. */
  destroy(): void {
    for (const entry of [...this.entries.values()]) {
      this.disposeEntry(entry);
    }
    this.entries.clear();
    this.visibleKey = null;
    this.destroyed = true;
  }

  // ── internals ─────────────────────────────────────────────────

  /** Move a key to the most-recently-used end of the Map. */
  private touch(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  /**
   * Evict the least-recently-used entry, never the currently-visible one (the
   * visible entry is always MRU after `activate`, but guard defensively).
   */
  private evictLru(): void {
    for (const key of this.entries.keys()) {
      if (key === this.visibleKey) continue;
      const entry = this.entries.get(key);
      if (entry) {
        this.disposeEntry(entry);
        return;
      }
    }
    // All entries are the visible one (size 1 at capacity 1) — evict it anyway.
    const first = this.entries.values().next().value as TerminalCacheEntry | undefined;
    if (first) this.disposeEntry(first);
  }

  /** Detach (via onEvict), then dispose xterm/addon/input/host for one entry. */
  private disposeEntry(entry: TerminalCacheEntry): void {
    try {
      this.onEvict?.(entry);
    } catch {
      // A surface detach failure must not leak the xterm/DOM resources below.
    }
    try {
      entry.inputBinding?.dispose();
    } catch {
      /* ignore */
    }
    try {
      entry.terminal.dispose();
    } catch {
      /* ignore */
    }
    entry.host.remove();
    this.entries.delete(entry.key);
    if (this.visibleKey === entry.key) this.visibleKey = null;
  }

  private assertLive(): void {
    if (this.destroyed) throw new Error('TerminalInstanceCache used after destroy()');
  }
}
