// T005 — Handle derivation + collision suffixing.
//
// A handle is derived from the agent's display name: lowercased, non-alphanumerics
// stripped. On collision with an already-online handle, append `-1`, `-2`, … (first free).
// Empty/invalid normalization is rejected by the caller (assignHandle throws).

/** Lowercase + strip non-alphanumerics. May return '' for names with no alnum chars. */
export function normalizeHandle(name: string): string {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Assign a unique handle. `base` is a normalized handle; `takenOnline` is the set of
 * handles currently in use by online bindings. Returns base, base-1, base-2, …
 * @throws if `base` is empty (invalid normalization).
 */
export function assignHandle(base: string, takenOnline: Set<string>): string {
  if (!base) {
    throw new Error('Cannot derive a Teams handle from an empty/invalid agent name');
  }
  if (!takenOnline.has(base)) return base;
  for (let i = 1; ; i++) {
    const candidate = `${base}-${i}`;
    if (!takenOnline.has(candidate)) return candidate;
  }
}
