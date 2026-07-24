# Contract: Markdown Detection Module (`electron/teams/markdownDetect.ts`)

A **pure, side-effect-free** module (no `fs`, no `electron`, no `teamsService` import) so
the FR-002 heuristic is unit-testable in isolation. This is the contract the
`tests/unit/teams/markdownDetect.test.ts` suite verifies.

## Exports

```ts
/** Hardcoded, non-configurable minimum reply length to auto-render (FR-002). */
export const AUTO_RENDER_MIN_CHARS = 1000;

/** True iff `text` contains at least one block-level structural markdown construct. */
export function hasBlockStructure(text: string): boolean;

/** True iff `text` already contains one or more valid office-image sentinels (FR-009). */
export function hasExistingImageSentinel(text: string): boolean;

/**
 * The FR-002 auto-render predicate: true iff BOTH
 *   (a) hasBlockStructure(text) AND
 *   (b) text.length > AUTO_RENDER_MIN_CHARS.
 * Does NOT check the existing-sentinel guard or the settings flag — callers combine.
 */
export function shouldAutoRenderMarkdown(text: string): boolean;
```

## `hasBlockStructure` — what counts (positive)

Returns `true` when **any** of these block constructs is present (line-anchored):

| Construct | Match rule |
|-----------|-----------|
| Fenced code block | an opening fence line (```` ``` ```` or `~~~`) with a matching closing fence |
| Pipe table | a `\|...\|` row immediately followed by a delimiter row `^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$` |
| ATX heading | `^#{1,6}\s` |
| Setext heading | a non-empty text line immediately followed by `^=+\s*$` or `^-{2,}\s*$` |
| Blockquote | `^>\s` |
| List (≥2 items) | **two or more** lines matching `^\s*([-*+]\|\d+[.)])\s+` |

## `hasBlockStructure` — what does NOT count (negative)

MUST return `false` for:
- Inline-only emphasis: `**bold**`, `*italic*`, `_em_`, single inline `` `code` `` with no block.
- A lone stray `#`, `*`, `-`, `>` inside prose (e.g. `the C# language`, `a * b`, `5 - 3`,
  `he said > that`).
- A **single** list item (only one `- ` / `1. ` line).
- An ATX-looking `#` not followed by whitespace (`#tag`), a `>` not followed by whitespace.

## `shouldAutoRenderMarkdown` truth table (FR-002 + edge cases)

| Reply | `hasBlockStructure` | `len > 1000` | Result |
|-------|:---:|:---:|:---:|
| Long reply (>1000) with a table or fenced code | ✅ | ✅ | **true** |
| Long reply (>1000) with ≥2-item list, heading, or blockquote | ✅ | ✅ | **true** |
| Short (≤1000) reply with a 2×2 table / 3-line code block | ✅ | ❌ | false |
| Long (>1000) reply of pure prose, no block structure | ❌ | ✅ | false |
| Prose with a stray `#`/`*`/`-`, any length | ❌ | any | false |
| Inline-only `**bold**`/`` `code` `` , any length | ❌ | any | false |
| Empty / whitespace-only | ❌ | ❌ | false |

## `hasExistingImageSentinel` (FR-009)

- Returns `true` when `text` matches the shared `IMAGE_MARKER_SOURCE`
  (`<!--office-image:(.*?)-->`) with a non-empty captured path — implemented by reusing
  `extractImageMarkers(text).paths.length > 0` (from `imageMarker.ts`) so the guard and
  the loader agree on what a sentinel is.
- Note: importing `extractImageMarkers` keeps the module dependency-light (imageMarker is
  itself pure over strings for extraction); it does not pull in fs at extraction time.

## Purity & determinism requirements

- No I/O, no timers, no randomness, no global mutable state (do not rely on the stateful
  `IMAGE_MARKER_RE.lastIndex`; build fresh regexes, as `imageMarker.ts` already does).
- Same input ⇒ same output; safe to call synchronously in the finalize hot path.
