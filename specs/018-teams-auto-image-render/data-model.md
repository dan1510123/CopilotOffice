# Phase 1 Data Model: Auto-Render Markdown Replies as Teams Images

This feature is mostly behavioral; its "data" is a small set of typed inputs/outputs and
one new persisted config field. No database or new persisted entity beyond the existing
`.data/teams-settings.json`.

## Entities & Types

### 1. `TeamsSettings.autoRenderMarkdownImages` (new persisted field)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `autoRenderMarkdownImages` | `boolean` | `false` (OFF) | Global opt-in gate (FR-010). No per-office override in v1. Persisted in `.data/teams-settings.json` via `teamsSettingsStore`. |

- Added to `TeamsSettings` interface in `electron/teams/types.ts`.
- Added to `DEFAULT_TEAMS_SETTINGS` and `normalizeTeamsSettings` in
  `teamsSettingsStore.ts` (default `false`, `?? DEFAULT_TEAMS_SETTINGS.autoRenderMarkdownImages`).
- Serialized through the existing `teams:getSettings` / `teams:saveSettings` IPC — no new
  channel. Backward compatible: an existing settings file lacking the key normalizes to
  `false`.

### 2. Auto-render decision input (transient, not persisted)

The detector operates on the agent's **final accumulated reply text** — the same
`assistant.message` content captured as `rec.lastReplyText` in `PendingTurn` /
`AmbientTurn` at idle-finalize.

| Input | Source | Used for |
|-------|--------|----------|
| `replyText: string` | `rec.lastReplyText` at `finalizeDispatch` / `finalizeAmbient` | structure + length detection, existing-sentinel guard |
| `workingDir: string` | `binding.workingDir` | `--cwd` for the renderer; sandbox root for `loadHostedImages` |
| `online: boolean` | `bindings.find(b => b.agentId === … && b.online)` | pre-render + pre-post gate (FR-001, edge: offline mid-render) |
| `autoRenderMarkdownImages: boolean` | `settingsStore.load()` | overall gate (FR-010) |

### 3. Named constant (FR-002)

```ts
// electron/teams/markdownDetect.ts
export const AUTO_RENDER_MIN_CHARS = 1000; // hardcoded, non-configurable (FR-002)
```

### 4. Detector result

`shouldAutoRenderMarkdown(text: string): boolean` — a pure predicate. (Kept boolean for
simplicity; the teamsService computes the richer outcome enum below for logging.)

Supporting pure helpers (also exported for unit tests):
- `hasBlockStructure(text: string): boolean`
- `hasExistingImageSentinel(text: string): boolean` (thin wrapper over
  `extractImageMarkers(text).paths.length > 0`, or teamsService checks inline)

### 5. Auto-render outcome (for logging — FR-013)

A string-literal union used only in log lines; not persisted.

```ts
type AutoRenderOutcome =
  | 'disabled'                 // setting OFF
  | 'skipped-no-markdown'      // failed structure/length gate
  | 'skipped-existing-sentinel'// FR-009 guard hit
  | 'skipped-offline'          // binding lost before post (edge case)
  | 'skipped-no-renderer'      // capability pre-check failed (R1)
  | 'rendered'                 // image posted in addition to plain text
  | 'fallback-render-error'    // spawn/timeout/non-zero/no-sentinel → plain text only
  | 'fallback-image-rejected'; // loadHostedImages returned [] (caps/magic-byte) → plain text only
```

### 6. Render invocation result (from `autoImageRenderer.ts`)

```ts
interface AutoRenderResult {
  ok: boolean;
  sentinel?: string;   // captured `<!--office-image:...-->` line when ok
  reason?: string;     // failure reason for logging when !ok
}
```

## State & Flow (idle-finalize decision)

```
finalizeDispatch / finalizeAmbient (after settleMs)
  └─ flush residual plain text  (existing — unchanged)
  └─ maybeAutoRenderImage(binding, rec.lastReplyText):
       if !settings.autoRenderMarkdownImages            → 'disabled'          (no-op)
       if !hasBlockStructure || len ≤ AUTO_RENDER_MIN_CHARS → 'skipped-no-markdown'
       if hasExistingImageSentinel(text)                → 'skipped-existing-sentinel'
       if !capabilityAvailable()                        → 'skipped-no-renderer'
       result = autoImageRenderer.render(text, workingDir)  // child process, bounded timeout
       if !result.ok                                    → 'fallback-render-error'
       if binding no longer online                      → 'skipped-offline'
       { paths } = extractImageMarkers(result.sentinel)
       images = loadHostedImages(paths, { baseDir: workingDir, ... })
       if images.length === 0                           → 'fallback-image-rejected'
       safeReply(binding, `${agentLabel}<br>${hostedImagesHtml(images)}`, images) → 'rendered'
  └─ maybeNotifyComplete(...)   (existing — unchanged)
  └─ resolve()                  (existing — unchanged)
```

Every non-`rendered`, non-`disabled` outcome leaves the already-streamed plain-text
reply as the guaranteed result (FR-008 / SC-002). The hook is **additive** — it runs
after the existing finalize work and never alters the plain-text or notification paths.

## Validation & Invariants

- **VI-1 (FR-002)**: `shouldAutoRenderMarkdown` true requires BOTH structure AND
  `length > 1000`. Inline-only markers and stray single symbols never satisfy structure.
- **VI-2 (FR-008)**: no branch of `maybeAutoRenderImage` throws; all failure paths return
  an outcome and leave plain text posted.
- **VI-3 (FR-009)**: existing valid sentinel ⇒ no auto-render.
- **VI-4 (FR-011)**: image posting goes only through `loadHostedImages` (sandbox +
  magic-byte + caps) — no new file-read path is introduced.
- **VI-5 (FR-012)**: hook is additive at finalize; self-loop guard, dedup/messageFilter,
  dispatch queue, and `settleMs` debounce are untouched.
- **VI-6 (FR-010)**: setting default OFF; behavior only active when explicitly enabled.
- **VI-7 (FR-006)**: runs only at debounced finalize, once per conversation — not on
  per-turn flush.

## Risks noted for implementation

- The regex heuristic is intentionally simpler than a full markdown parse; if false
  positives/negatives surface in practice, hardening to a `marked`-token inspection is a
  contained follow-up (detector module is isolated). Tracked in research R3.
