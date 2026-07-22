---
description: "Task list for feature 018-teams-auto-image-render"
---

# Tasks: Auto-Render Markdown Replies as Teams Images

**Input**: Design documents from `specs/018-teams-auto-image-render/`
**Prerequisites**: plan.md ✅, spec.md ✅ (clarified), research.md ✅, data-model.md ✅, contracts/ ✅ (markdown-detection.md, render-child-process.md), quickstart.md ✅

**Tests**: INCLUDED — the spec and plan explicitly request test-first for the pure detector plus new integration tests (markdown detection, renderer fallback, no-double-render) and re-running all existing Teams suites (SC-006).

**Organization**: Tasks are grouped by user story (P1→P3) to enable independent implementation and testing. The detector is built test-first (unit tests before implementation); the child-process renderer and finalize wiring follow.

**Repo commands**: `npm run build` (TS strict) and `npm run test` (vitest).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 / US4 for user-story-phase tasks; Setup/Foundational/Polish carry no story label

## Path Conventions

Desktop-app single-project layout (per plan.md). Main-process source under `electron/teams/`, renderer UI under `src/ui/`, tests under `tests/unit/teams/` and `tests/integration/teams/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the baseline and confirm the reusable pieces this feature depends on exist and are green before any change.

- [ ] T001 Confirm baseline builds and Teams suites are green: run `npm run build` and `npm run test` and record the current-green Teams suites (imageMarker, fileMarker, dispatchQueue, messageFilter, marker, ambient-stream, lifecycle, online-roundtrip) as the SC-006 regression baseline.
- [ ] T002 [P] Verify the reused inline-image API surface in `electron/teams/imageMarker.ts` — confirm `extractImageMarkers`, `loadHostedImages`, and `hostedImagesHtml` signatures and the `IMAGE_MARKER_SOURCE`/`<!--office-image:(.*?)-->` shape match the contracts (no code change; note exact signatures for T005/T009/T014).
- [ ] T003 [P] Verify the skill renderer contract in `.github/skills/office-image-teams-reply/render-markdown-image.mjs` — confirm it accepts `--cwd <dir>`, reads markdown from stdin when `--input` is absent, and prints a single `<!--office-image:<relpath>-->` sentinel to stdout (no code change; note behavior for T010).

**Checkpoint**: Baseline green and reused APIs confirmed — implementation can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the opt-in setting surface (type + store defaults/normalize + IPC threading). This BLOCKS the finalize wiring (US1) because the gate must exist and default OFF before any auto-render code path can be enabled. No new IPC channel is added — the existing `teams:getSettings`/`teams:saveSettings` carry the flag.

**⚠️ CRITICAL**: US1–US4 finalize wiring depends on the `autoRenderMarkdownImages` flag existing and defaulting to `false`.

- [ ] T004 Add `autoRenderMarkdownImages: boolean` to the `TeamsSettings` interface in `electron/teams/types.ts` (documented as the opt-in auto-render gate, FR-010).
- [ ] T005 Add the new flag to `DEFAULT_TEAMS_SETTINGS` (`autoRenderMarkdownImages: false`) and to `normalizeTeamsSettings` (`autoRenderMarkdownImages: partial?.autoRenderMarkdownImages ?? DEFAULT_TEAMS_SETTINGS.autoRenderMarkdownImages`) in `electron/teams/teamsSettingsStore.ts` — backward compatible: a settings file lacking the key normalizes to `false`.
- [ ] T006 [P] Add/extend unit tests in `tests/unit/teams/teamsSettingsStore.test.ts` proving the new flag defaults to `false`, survives a normalize round-trip when present (`true`→`true`, `false`→`false`), and normalizes a missing key to `false` (VI-6 / FR-010).
- [ ] T007 Surface the opt-in toggle "Auto-render markdown replies as images" in the Teams settings UI `src/ui/TeamsSettingsOverlay.ts`, bound to `autoRenderMarkdownImages` and threaded through the existing `teams:getSettings`/`teams:saveSettings` IPC (no new protocol channel; mirror the existing `enabled`/ack toggles). Verify `src/main.ts` and `src/config/teamsConfig.ts` pass the flag through unchanged.

**Checkpoint**: The opt-in gate exists, defaults OFF, and round-trips through settings + IPC. User-story work can now begin.

---

## Phase 3: User Story 1 - Markdown reply auto-renders when the agent finishes (Priority: P1) 🎯 MVP

**Goal**: When an online agent goes idle and its final accumulated reply is BOTH block-level structural markdown AND > 1000 chars, render it to a PNG via the skill and post it inline into the Teams thread in addition to the plain text — for both dispatched and ambient turns.

**Independent Test**: With the flag ON, drive an online agent to a >1000-char reply containing a markdown table/fenced code, let it go idle → an inline rendered image appears in the thread in addition to the plain text, with no manual skill invocation. A long pure-prose reply and a ≤1000-char structured reply produce no image.

### Tests for User Story 1 (write FIRST, ensure they FAIL before implementation) ⚠️

- [ ] T008 [P] [US1] Write the pure-detector unit test suite in `tests/unit/teams/markdownDetect.test.ts` covering the full `contracts/markdown-detection.md` truth table: positive `hasBlockStructure` (fenced code, pipe table + delimiter, ATX heading, setext heading, blockquote, ≥2-item list); negatives (inline-only `**bold**`/`*italic*`/`` `code` ``, stray `#`/`*`/`-`/`>` in prose e.g. `C#`, `a * b`, `5 - 3`, single list item, `#tag`); `shouldAutoRenderMarkdown` combining structure AND `length > AUTO_RENDER_MIN_CHARS` (short-structured=false, long-unstructured=false, empty=false); and `hasExistingImageSentinel` true only for a valid non-empty `<!--office-image:...-->`. Assert `AUTO_RENDER_MIN_CHARS === 1000`. MUST fail initially (module absent).
- [ ] T009 [P] [US1] Write the finalize-augment integration test in `tests/integration/teams/teams-auto-image-render.test.ts` (flag ON + injected fake `AutoImageRenderer` returning a valid sentinel): assert that after `finalizeDispatch` and (separately) `finalizeAmbient` for a qualifying >1000-char markdown reply, an ADDITIONAL `safeReply` carrying `hostedImagesHtml` image(s) is issued AFTER the plain-text posts (augment, FR-004/FR-005), and that a non-qualifying reply (plain prose, or ≤1000 chars) issues NO extra image post. MUST fail initially.

### Implementation for User Story 1

- [ ] T010 [US1] Implement the pure detector module `electron/teams/markdownDetect.ts`: export `AUTO_RENDER_MIN_CHARS = 1000`, `hasBlockStructure(text)`, `hasExistingImageSentinel(text)` (thin wrapper over `extractImageMarkers(text).paths.length > 0`), and `shouldAutoRenderMarkdown(text)` (structure AND `length > AUTO_RENDER_MIN_CHARS`). No `fs`/`electron`/`teamsService` imports; build fresh regexes (no shared `lastIndex` state) per the purity/determinism contract. Make T008 pass.
- [ ] T011 [US1] Implement the child-process render wrapper `electron/teams/autoImageRenderer.ts` per `contracts/render-child-process.md`: `createAutoImageRenderer(opts?)` returning `{ isAvailable(), render(markdown, workingDir) }` with `AutoRenderResult { ok, sentinel?, reason? }`. `render` spawns `node <rendererPath> --cwd <workingDir>`, writes markdown to stdin, enforces a bounded `timeoutMs` (default 30000, kill tree on timeout), parses stdout for the `<!--office-image:(.*?)-->` sentinel, and NEVER throws (spawn ENOENT / non-zero exit / no-sentinel → `{ ok:false, reason }`). Support injectable `spawn`/`probe`/`rendererPath`/`warn` for tests. Default `rendererPath` resolves `.github/skills/office-image-teams-reply/render-markdown-image.mjs`.
- [ ] T012 [US1] Wire the additive auto-render hook into `electron/teams/teamsService.ts`: construct/inject an `AutoImageRenderer` (via `TeamsServiceDeps`), and add a private `maybeAutoRenderImage(binding, replyText)` invoked at the end of BOTH `finalizeDispatch` and `finalizeAmbient` (after `flushTurn`/`flushAmbient` and `maybeNotifyComplete`, against `rec.lastReplyText`). Gate on `settings.autoRenderMarkdownImages` then `shouldAutoRenderMarkdown(replyText)`. On qualify: call `renderer.render(...)`, then reuse `extractImageMarkers` → `loadHostedImages({ baseDir: binding.workingDir, warn })` → `safeReply(binding, \`${this.agentLabel(binding)}<br>${hostedImagesHtml(images)}\`, images)`. Plain text is NOT re-posted (augment only). Must make T009 pass while keeping the finalize flow additive (self-loop guard / dedup / dispatch-queue / settleMs untouched, VI-5/FR-012).
- [ ] T013 [US1] Add outcome logging (FR-013) via the existing Teams `log` in the `maybeAutoRenderImage` path for each `AutoRenderOutcome` (`disabled`, `skipped-no-markdown`, `rendered`, etc.) so operators can diagnose false positives/negatives.

**Checkpoint**: US1 fully functional — qualifying markdown replies auto-render inline (augment) for dispatched and ambient turns; T008–T009 green; `npm run build` clean.

---

## Phase 4: User Story 2 - Never drop a reply on render failure (Priority: P1)

**Goal**: Every render failure path (renderer unavailable, spawn error/timeout/non-zero, no sentinel, image rejected by sandbox/magic-byte/caps, binding offline) falls back to the already-posted plain text — no reply is ever silently dropped.

**Independent Test**: Force a render failure (mock `spawn` non-zero/timeout, or make `isAvailable()` false, or `loadHostedImages` return `[]`) on a qualifying reply → the plain-text reply is still in the thread, failure is logged, no broken image and no extra image post.

### Tests for User Story 2 (write FIRST) ⚠️

- [ ] T014 [P] [US2] Add fallback tests to `tests/integration/teams/teams-auto-image-render.test.ts` (fallback matrix, FR-008/SC-002): for each of `isAvailable()===false`, `render` returns `ok:false` (mock spawn non-zero / timeout / no-sentinel), and `loadHostedImages` returns `[]` — assert NO extra image `safeReply` is issued, the plain-text posts remain intact, and a failure/skip reason is logged. Assert `maybeAutoRenderImage` never throws. MUST fail before T015.

### Implementation for User Story 2

- [ ] T015 [US2] In `electron/teams/teamsService.ts` `maybeAutoRenderImage`, implement the complete non-throwing fallback + capability pre-check: call `renderer.isAvailable()` before rendering (`skipped-no-renderer`); on `render` `!ok` return `fallback-render-error`; on `loadHostedImages([]).length === 0` return `fallback-image-rejected`; wrap the whole hook so no branch throws (VI-2). Re-check `bindings.find(b => b.agentId === … && b.online)` immediately before `safeReply`; if lost, return `skipped-offline` (do not post to a stale thread). Make T014 pass.

**Checkpoint**: US1 + US2 green — auto-render succeeds when possible and always degrades to plain text on any failure.

---

## Phase 5: User Story 3 - Do not double-render when the agent already attached an image (Priority: P2)

**Goal**: When the final reply already contains a valid `<!--office-image:...-->` sentinel, auto-render is skipped so exactly one image is posted (the agent's).

**Independent Test**: Final reply contains a valid office-image sentinel plus >1000-char markdown → exactly one image posted (the agent's manual path), no auto-render duplicate.

### Tests for User Story 3 (write FIRST) ⚠️

- [ ] T016 [P] [US3] Add a no-double-render test to `tests/integration/teams/teams-auto-image-render.test.ts` (FR-009/SC-004): a qualifying >1000-char reply that ALSO contains a valid `<!--office-image:...-->` sentinel → `renderer.render` is NEVER called and NO auto-render image `safeReply` is issued (the existing sentinel path is unaffected). MUST fail before T017.

### Implementation for User Story 3

- [ ] T017 [US3] In `electron/teams/teamsService.ts` `maybeAutoRenderImage`, add the existing-sentinel guard using `hasExistingImageSentinel(replyText)` from `markdownDetect.ts` (before invoking the renderer): if true, return `skipped-existing-sentinel` and do nothing. Make T016 pass.

**Checkpoint**: US1–US3 green — manual sentinel path unchanged; never double-renders.

---

## Phase 6: User Story 4 - Opt-in / opt-out control (Priority: P3)

**Goal**: The whole behavior is gated by `autoRenderMarkdownImages` (default OFF); toggling it off makes auto-render fully inert.

**Independent Test**: Flag OFF → qualifying markdown replies post as plain text only (detector/renderer never invoked); flag ON → they auto-render per US1.

### Tests for User Story 4 (write FIRST) ⚠️

- [ ] T018 [P] [US4] Add opt-in/opt-out tests to `tests/integration/teams/teams-auto-image-render.test.ts` (FR-010/SC-005): with `autoRenderMarkdownImages: false`, a qualifying reply invokes NEITHER `shouldAutoRenderMarkdown` result nor `renderer.render` and issues NO extra image post (`disabled`); with `true`, US1 behavior holds. MUST fail before T019 if the gate is missing.

### Implementation for User Story 4

- [ ] T019 [US4] Confirm/implement the settings gate as the FIRST check in `electron/teams/teamsService.ts` `maybeAutoRenderImage` (`if (!settings.autoRenderMarkdownImages) return 'disabled'`), reading from the settings store already wired in T005/T007. Make T018 pass. (Depends on Phase 2 flag + T012 hook.)

**Checkpoint**: All user stories independently functional and gated by the opt-in flag.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Regression validation, security invariant checks, and docs.

- [ ] T020 Regression: re-run the existing Teams suites and confirm still green (SC-006) — `imageMarker`, `fileMarker`, `dispatchQueue`, `messageFilter`, `marker` (self-loop guard), `teams-ambient-stream`, `teams-lifecycle`, `teams-online-roundtrip`. Verify no change to self-loop guard / dedup / dispatch-queue / settleMs debounce (FR-012, VI-5).
- [ ] T021 [P] Security invariant check (FR-011/VI-4): add/confirm an assertion in `tests/integration/teams/teams-auto-image-render.test.ts` that auto-render posts images ONLY via `loadHostedImages` (sandbox + magic-byte + per-file/count/aggregate caps) — an absolute path or `..` traversal or oversized image in the captured sentinel is rejected and falls back to plain text (no new file-read path introduced).
- [ ] T022 [P] Run `npm run build` (TS strict, zero errors) and full `npm run test` (all new + existing suites green).
- [ ] T023 [P] Execute the `quickstart.md` manual verification checklist (US1 auto-render, plain-prose no-image, short-structured no-image, large-unstructured no-image, US2 never-drop, US3 no-double-render, US4 opt-out) and note results.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories (the opt-in flag must exist and default OFF).
- **User Story 1 (Phase 3)**: depends on Foundational. Delivers the MVP.
- **User Story 2 (Phase 4)**: depends on US1 (extends the same `maybeAutoRenderImage` hook).
- **User Story 3 (Phase 5)**: depends on US1 (adds a guard to the same hook); independent of US2.
- **User Story 4 (Phase 6)**: depends on Foundational (flag) + US1 (hook); independent of US2/US3.
- **Polish (Phase 7)**: depends on all desired user stories.

### Within Each User Story

- Tests are written FIRST and MUST FAIL before implementation (T008/T009 → T010–T013; T014 → T015; T016 → T017; T018 → T019).
- Detector (`markdownDetect.ts`) and renderer (`autoImageRenderer.ts`) are independent files → parallelizable, both before the `teamsService` wiring that consumes them.

### Parallel Opportunities

- Phase 1: T002 and T003 in parallel (different files, read-only).
- Phase 2: T006 in parallel with T007 after T004/T005 land (different files).
- Phase 3: T008 and T009 in parallel (different test files); then T010 and T011 in parallel (different source files) before T012.
- Later stories T014/T016/T018 all touch the SAME integration test file → NOT mutually [P]; sequence or coordinate edits. Their implementation tasks T015/T017/T019 all edit `teamsService.ts` → NOT [P] with each other.
- Phase 7: T021, T022, T023 in parallel.

---

## Parallel Example: User Story 1

```bash
# Write the failing tests together (different files):
Task: "markdownDetect unit truth-table tests in tests/unit/teams/markdownDetect.test.ts"     # T008
Task: "finalize-augment integration tests in tests/integration/teams/teams-auto-image-render.test.ts"  # T009

# Then implement the two independent source modules together (different files):
Task: "Pure detector electron/teams/markdownDetect.ts"       # T010
Task: "Child-process renderer electron/teams/autoImageRenderer.ts"  # T011
# T012 (teamsService wiring) follows once T010 + T011 exist.
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational (opt-in flag, default OFF).
2. Phase 3 US1 (detector test-first → detector + renderer → finalize wiring + logging).
3. STOP and VALIDATE: qualifying markdown replies auto-render inline (augment) for dispatched and ambient turns; non-qualifying replies post plain text.

### Incremental Delivery

1. Foundation ready (Phase 2).
2. US1 → test independently → MVP.
3. US2 (never-drop fallback) → test independently.
4. US3 (no-double-render) → test independently.
5. US4 (opt-in/opt-out) → test independently.
6. Polish: regression + security + build/test + quickstart.

---

## Notes

- [P] = different files, no dependencies. The three later-story integration tests (T014/T016/T018) and the three `teamsService` implementation tasks (T015/T017/T019) share files and are therefore NOT [P] among themselves.
- The hook is strictly ADDITIVE at idle-finalize; it must never alter the plain-text or notification paths (VI-5/FR-012) and never throw (VI-2/FR-008).
- Verify each test FAILS before writing its implementation.
- Commit after each task or logical group.
