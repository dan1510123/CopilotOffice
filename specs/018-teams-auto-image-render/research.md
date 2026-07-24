# Phase 0 Research: Auto-Render Markdown Replies as Teams Images

All six spec clarifications are resolved (spec → Clarifications, Session 2026-07-21), so
there are no open `NEEDS CLARIFICATION` markers on the requirements. This document
resolves the remaining **implementation-level** unknowns and records the key risk items
the design must mitigate.

## R1 — Playwright/Chromium availability in the main process (RISK, top priority)

**Decision**: Treat the renderer as an **optional capability**, not a guaranteed one.
The `autoImageRenderer` helper performs a **capability pre-check** before attempting a
render, and every failure mode routes to the FR-008 plain-text fallback.

**Rationale**: FR-007 accepts that main now depends on playwright/Chromium, but the app's
own `package.json` does **not** ship playwright — the skill resolves it from the skill
folder's `node_modules`, which only exists after the one-time `npm install` +
`npx playwright install chromium` documented in `SKILL.md`. On a machine where the skill
was never set up, the child process will exit non-zero (module-not-found) or fail to
launch Chromium. The never-drop-reply invariant (FR-008, SC-002) makes graceful
degradation mandatory.

**Approach**:
- Pre-check (cheap, cached): verify the skill renderer file exists and the skill's
  `node_modules/playwright` is resolvable before spawning. If not present, skip
  auto-render and log `skipped-no-renderer` — the plain text was already posted per-turn.
- Spawn with a **bounded timeout** (e.g. 30s) so a hung Chromium never wedges the
  finalize path; on timeout, kill the child and fall back.
- Capture a **non-zero exit code, empty stdout, or a stdout without a valid
  `<!--office-image:...-->` sentinel** as failure → fallback.
- All fallbacks are non-throwing; the finalize path must never reject on a render error.

**Alternatives considered**:
- *Bundle playwright into the app*: rejected for v1 — large binary, changes app install
  footprint, and the clarified design (Q5) reuses the existing skill renderer as-is.
- *In-process render inside main (import playwright directly)*: rejected — keeps the
  Chromium dependency out of the main bundle, preserves the session-integrity boundary
  (Principle III: main stays out of heavy rendering), and reuses the already-tested
  `render-markdown-image.mjs` verbatim.

## R2 — Where exactly to hook, and against what text

**Decision**: Hook inside `finalizeDispatch(agentId)` and `finalizeAmbient(agentId)` in
`teamsService.ts`, **after** the residual `flushTurn`/`flushAmbient` has posted the
plain text, evaluating the **final accumulated reply** captured in `rec.lastReplyText`.

**Rationale**: These two methods are the debounced idle-finalize points that fire once
per conversation after the `settleMs` quiet period (FR-006). `flushTurn`/`flushAmbient`
already set `rec.lastReplyText = text` on each turn, so at finalize `rec.lastReplyText`
holds the **last turn's** text. The spec requires evaluating the *final accumulated
reply* — for a single-turn reply this is `lastReplyText`; for a multi-turn/tool response
the meaningful "final reply" is the last turn's content (earlier turns were interim
progress already streamed). The design will render `rec.lastReplyText` (the final turn's
text). This also naturally avoids firing on the first `turn-end` because finalize only
runs after the debounce, never per-flush.

**Consequence for FR-004 (augment)**: because plain text already streamed per-turn, the
image is an **additional** `safeReply` appended at finalize — never a replacement. This
matches the existing `postReply` image branch, which already posts the image as a
separate `safeReply` after the text chunks.

**Alternatives considered**:
- *Accumulate all turns' text and render the concatenation*: rejected — would re-render
  interim progress the user already saw as separate messages, and risks an oversized
  image; the last turn is the "answer".
- *Hook in `flushTurn`/`postReply` per-turn*: rejected — violates FR-006 (would fire on
  the first turn-end and could render multiple images).

## R3 — Markdown "structure" heuristic definition (FR-002)

**Decision**: A single pure function `shouldAutoRenderMarkdown(text): boolean` returns
true **iff** `text.length > AUTO_RENDER_MIN_CHARS` (named constant = 1000) **AND**
`hasBlockStructure(text)` is true. `hasBlockStructure` detects at least one of:
- **fenced code block**: a line starting with ` ``` ` (or `~~~`) that has a closing fence;
- **pipe table**: a `|...|` row immediately followed by a separator row matching
  `^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$` (the `---|---` delimiter);
- **ATX heading**: `^#{1,6}\s`; **setext heading**: a text line followed by `^=+$` or `^-+$`;
- **blockquote**: `^>\s`;
- **list of ≥2 items**: two or more lines matching `^\s*([-*+]|\d+[.)])\s+`.

Inline-only emphasis (`**bold**`, `*italic*`, single inline `` `code` ``) and a lone
stray `#`/`*`/`-` MUST NOT satisfy `hasBlockStructure`. Detection is line-oriented
(anchored `^`/multiline), not a full markdown parse.

**Rationale**: FR-002 requires *both* structure and size, and the edge cases explicitly
call out no-false-positive on stray inline symbols, on ≤1000-char structured snippets,
and on large-but-unstructured prose. A lightweight line-anchored regex set is
deterministic, fast, and trivially unit-testable — no need to pull `marked` into main
just to detect. The ≥2-item list rule prevents a single `- ` bullet or a lone `# ` from
tripping the detector.

**Alternatives considered**:
- *Reuse `marked` to tokenize and inspect for block tokens*: more "correct" but adds a
  parser dependency to the main detector and is heavier than needed; the regex heuristic
  is sufficient for the trigger decision (the actual render still uses `marked` in the
  child process). Kept as a possible future hardening, noted in data-model risks.
- *Size-only or structure-only trigger*: rejected — contradicts the user-decided Q1
  "both big AND structured".

## R4 — No-double-render guard (FR-009)

**Decision**: Before rendering, run the reply through the existing
`extractImageMarkers(text)` (from `imageMarker.ts`). If `paths.length > 0`, the reply
already carries a valid office-image sentinel → **skip** auto-render (log
`skipped-existing-sentinel`). The detector module exposes a small
`hasExistingImageSentinel(text)` wrapper (or teamsService checks `paths.length`
inline) so the guard is co-located with the trigger decision.

**Rationale**: FR-009 + SC-004 require exactly one image when the agent already attached
one. Reusing `extractImageMarkers` guarantees the guard recognizes exactly the same
sentinels the posting path honors (no drift between "what counts as a sentinel" for the
guard vs. the loader).

## R5 — Reusing the security-hardened attach path (FR-003, FR-007, FR-011)

**Decision**: The rendered image is posted by **feeding the captured sentinel back
through the existing `postReply` image path** — i.e. the child process emits
`<!--office-image:.office-images/reply-<ts>.png-->`, and the finalize hook attaches it
via the same `extractImageMarkers` → `loadHostedImages({ baseDir: workingDir })` →
`hostedImagesHtml` → `safeReply(..., images)` sequence already used for manual
sentinels. `--cwd` is set to `binding.workingDir`.

**Rationale**: FR-011 forbids weakening the sandbox. The renderer already writes only a
relative in-sandbox path, and `loadHostedImages` re-validates (sandbox confinement,
magic-byte, per-file/count/aggregate caps) regardless of who produced the path. Reusing
this path means the FR-008 "image rejected by caps → fallback to plain text" case is
handled for free: if `loadHostedImages` returns `[]`, no image is posted and the plain
text already streamed.

**Approach for augment posting**: rather than re-entering the full `postReply` (which
would re-post the plain text and double it), the finalize hook loads the hosted image
directly and calls `safeReply(binding, \`${agentLabel}<br>${hostedImagesHtml(images)}\`,
images)` — mirroring only the image branch of `postReply`. Text is NOT re-posted (it
already streamed).

## R6 — Interaction with reply chunking and offline-mid-render edge cases

**Decision**:
- **Chunking**: the plain-text path chunks at ~3500 chars; the **image renders the whole
  final reply as one image** (the child process renders the entire markdown). No
  per-chunk images. If the resulting PNG exceeds `loadHostedImages` byte caps, it is
  rejected → plain text (already chunked) remains. (Documented edge case.)
- **Agent offline mid-render**: before posting the loaded image, re-check the binding is
  still online (`bindings.find(b => b.agentId === … && b.online)`); if the binding was
  lost during the render, **do not post** to a stale thread (log `skipped-offline`).

**Rationale**: directly addresses two named edge cases in the spec; both degrade safely.

## R7 — Opt-in surface plumbing (FR-010)

**Decision**: Add `autoRenderMarkdownImages: boolean` to the `TeamsSettings` interface
(`types.ts`), to `DEFAULT_TEAMS_SETTINGS` (= `false`), and to `normalizeTeamsSettings`
(default `false`). No new IPC channel — the existing `teams:getSettings` /
`teams:saveSettings` already serialize the whole `TeamsSettings` object across the
preload bridge, so the renderer settings UI only needs one new toggle bound to the field.
The service reads `settingsStore.load().autoRenderMarkdownImages` (and/or the
`onSettingsChanged` cache) at finalize time to gate the behavior.

**Rationale**: mirrors exactly how `enabled`, `ackEnabled`, `checkInEnabled` are already
threaded (store default + normalize + IPC + renderer toggle), satisfying
Configuration-First Extensibility with zero new protocol surface.

## Consolidated risk register

| ID | Risk | Mitigation |
|----|------|-----------|
| R1 | playwright/Chromium missing or hung in main | capability pre-check + bounded timeout + non-throwing fallback (FR-008) |
| R3 | detector false positives/negatives | pure line-anchored heuristic with dedicated positive/negative unit tests incl. all spec edge cases |
| R4 | double image when agent attached one | reuse `extractImageMarkers` guard before render (FR-009) |
| R5 | weakening sandbox by a new attach path | reuse unchanged `loadHostedImages` (sandbox/magic-byte/caps) — no new path |
| R6 | oversized image / stale thread | caps→fallback; re-check online binding before posting |
| R12 | regressing self-loop/dedup/queue/debounce | additive-only hook at finalize; re-run existing Teams suites (FR-012, SC-006) |
