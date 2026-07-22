# Contract: Main-Process Render Helper (`electron/teams/autoImageRenderer.ts`)

Wraps the child-process invocation of the existing skill renderer so the side effect is
isolated from `teamsService` and injectable in tests. This is the contract the
integration test mocks/verifies.

## Exports

```ts
export interface AutoRenderResult {
  ok: boolean;
  /** Captured `<!--office-image:...-->` line (relative in-sandbox path) when ok. */
  sentinel?: string;
  /** Failure reason for logging when !ok. */
  reason?: string;
}

export interface AutoImageRenderer {
  /** True iff the skill renderer + its playwright dependency are resolvable (R1 pre-check). */
  isAvailable(): boolean;
  /** Render `markdown` to a PNG under `workingDir/.office-images`; return its sentinel. */
  render(markdown: string, workingDir: string): Promise<AutoRenderResult>;
}

export function createAutoImageRenderer(opts?: {
  /** Absolute path to render-markdown-image.mjs (default: resolve under .github/skills/...). */
  rendererPath?: string;
  /** Bounded render timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Injectable spawn for tests (defaults to child_process.spawn). */
  spawn?: typeof import('child_process').spawn;
  /** Injectable existence/resolve check for isAvailable() in tests. */
  probe?: () => boolean;
  warn?: (msg: string) => void;
}): AutoImageRenderer;
```

## `isAvailable()` (capability pre-check — R1)

- Returns `true` only when BOTH the renderer script file exists AND the skill folder's
  `node_modules/playwright` resolves (best-effort `require.resolve` /
  `fs.existsSync`). Result MAY be cached after first check.
- `false` ⇒ caller skips auto-render (`skipped-no-renderer`); plain text already posted.

## `render(markdown, workingDir)` behavior

1. Spawn `node <rendererPath> --cwd <workingDir>` and write `markdown` to the child's
   **stdin** (the renderer reads stdin when `--input` is absent), then end stdin.
2. Collect stdout. Enforce `timeoutMs`; on timeout, kill the child tree and resolve
   `{ ok: false, reason: 'timeout' }`.
3. On child close:
   - non-zero exit ⇒ `{ ok: false, reason: 'exit-<code>' }` (stderr captured to log).
   - exit 0 but stdout has no `<!--office-image:(.*?)-->` with a non-empty path ⇒
     `{ ok: false, reason: 'no-sentinel' }`.
   - otherwise ⇒ `{ ok: true, sentinel: '<the matched sentinel line>' }`.
4. MUST NOT throw — spawn errors (ENOENT etc.) resolve `{ ok: false, reason }`.

## Invocation parameters (fixed by FR-007)

| Param | Value |
|-------|-------|
| command | `node` (or `process.execPath`) |
| script | `.github/skills/office-image-teams-reply/render-markdown-image.mjs` |
| `--cwd` | agent `binding.workingDir` (PNG saved under `<workingDir>/.office-images`) |
| stdin | the final reply markdown |
| stdout parsed | exactly one `<!--office-image:<out-dir>/reply-<ts>.png-->` line |

## Downstream posting (in `teamsService`, reusing existing path)

Given `result.sentinel`, the finalize hook posts the image with the **unchanged**
security-hardened path (FR-011):

```ts
const { paths } = extractImageMarkers(result.sentinel);          // imageMarker.ts
const images = await loadHostedImages(paths, {                   // sandbox + magic-byte + caps
  baseDir: binding.workingDir, warn,
});
if (images.length === 0) return 'fallback-image-rejected';       // FR-008
await this.safeReply(binding,
  `${this.agentLabel(binding)}<br>${hostedImagesHtml(images)}`, images); // augment (FR-004)
```

- The plain-text reply is **not** re-posted here (it already streamed per-turn) — only
  the image branch of `postReply` is mirrored, satisfying augment-not-replace.
- Before `safeReply`, re-check `bindings.find(b => b.agentId === … && b.online)`; if lost,
  return `skipped-offline` (do not post to a stale thread).

## Failure → fallback matrix (FR-008 / SC-002)

| Failure | Result | Reply outcome |
|---------|--------|---------------|
| `isAvailable()` false | skip | plain text (already posted) |
| spawn ENOENT / non-zero / timeout | `ok:false` | plain text |
| stdout has no valid sentinel | `ok:false` | plain text |
| `loadHostedImages` returns `[]` (caps/magic-byte) | image-rejected | plain text |
| binding offline before post | skip | plain text |

In every row the original plain-text reply reaches the thread; **no reply is ever
silently dropped.**
