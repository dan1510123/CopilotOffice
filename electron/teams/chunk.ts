// T007 — Split a long reply into ordered chunks (FR-011).
//
// Teams channel messages have practical size limits; long agent replies are split into
// sequential chunks, each prefixed with an `(i/N)` marker so readers can reassemble the
// order. Splitting prefers paragraph/line boundaries, falling back to hard slicing for
// pathological single-line content.

const DEFAULT_MAX = 3500;

export function chunkReply(text: string, max: number = DEFAULT_MAX): string[] {
  const body = text ?? '';
  // Reserve room for the "(i/N) " prefix.
  const prefixBudget = 12;
  const limit = Math.max(1, max - prefixBudget);

  if (body.length <= limit) {
    return body.length === 0 ? [''] : [body];
  }

  const raw: string[] = [];
  let remaining = body;
  while (remaining.length > limit) {
    // Prefer to break at the last newline within the limit, else hard-cut.
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut <= 0) cut = limit;
    raw.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, '');
  }
  if (remaining.length > 0) raw.push(remaining);

  const n = raw.length;
  if (n === 1) return raw;
  return raw.map((part, i) => `(${i + 1}/${n}) ${part}`);
}
