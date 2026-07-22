# Implementation Plan: Auto-Render Markdown Replies as Teams Images

**Branch**: `018-teams-auto-image-render` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/018-teams-auto-image-render/spec.md`

## Summary

Add an automatic post-conversation hook to the Teams remote subsystem: when an online
agent goes idle and its final accumulated reply is **both structurally markdown AND
long (> 1000 chars)**, CopilotOffice renders that reply to a PNG (reusing the existing
`office-image-teams-reply` renderer) and posts it inline into the Teams thread **in
addition to** the plain-text reply. The behavior is opt-in (new `TeamsSettings` flag,
default OFF), never double-renders when the agent already emitted an office-image
sentinel, and always falls back to the already-posted plain text on any render failure.

**Technical approach**: introduce one new **pure, unit-testable markdown-detection
module** (`electron/teams/markdownDetect.ts`) that answers "should this reply
auto-render?" (structure heuristic + 1000-char gate + existing-sentinel guard), and one
new **main-process render helper** (`electron/teams/autoImageRenderer.ts`) that shells
out to `.github/skills/office-image-teams-reply/render-markdown-image.mjs` as a node
child process, captures the emitted sentinel, and returns it. Wire both into the two
existing debounced idle-finalize paths (`finalizeDispatch` / `finalizeAmbient`) in
`teamsService.ts`, reusing the established `extractImageMarkers` / `loadHostedImages` /
`hostedImagesHtml` inline-image path for posting. No new lifecycle, no new IPC message
types for the render itself; only the settings surface gains one boolean.

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js (Electron main process); the
renderer child script is ESM `.mjs` (Node) using `playwright` + `marked`.
**Primary Dependencies**: existing — `electron/teams/imageMarker.ts` (sentinel
extraction, sandbox, magic-byte + caps), `graphClient.ts` (inline hostedContents),
`teamsSettingsStore.ts` (global settings). **New runtime dependency crossing into the
main process**: `playwright` + Chromium, invoked out-of-process via the existing skill
renderer (`render-markdown-image.mjs`). No new npm dependency is added to the app
`package.json` — the renderer resolves `playwright`/`marked` from the **skill folder's**
own `node_modules`, exactly as the manual skill does today.
**Storage**: rendered PNG under `<agent workingDir>/.office-images/reply-<ts>.png`
(same sandbox as manual path). Setting persisted in `.data/teams-settings.json`.
**Testing**: vitest (`npm run test`); unit tests under `tests/unit/teams/`, integration
under `tests/integration/teams/`.
**Target Platform**: Electron desktop app (Windows primary).
**Project Type**: desktop-app (Electron main + Phaser/DOM renderer). This feature is
entirely main-process + skill; no Phaser/renderer changes.
**Performance Goals**: auto-render adds one child-process spawn (~Chromium screenshot,
low seconds) **only** at idle-finalize of a qualifying reply; must not block or delay
the already-streamed per-turn plain-text posts. Non-qualifying replies incur only a
cheap synchronous regex/length check.
**Constraints**: never drop a reply (FR-008); never regress sandbox/security
(FR-011); never regress self-loop guard / dedup / dispatch queue / settleMs debounce
(FR-012); opt-in default OFF (FR-010); one image max per conversation (FR-006).
**Scale/Scope**: ~2 new source modules + `teamsService` wiring + `TeamsSettings`/store/
IPC/renderer-UI flag threading. ~4–6 new test files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Phaser-first constraint respected** — no in-canvas renderer touched. Image
  rendering is an out-of-band Chromium screenshot (child process), identical in kind to
  the existing manual office-image path. DOM/renderer boundaries unchanged.
- [x] **Event-driven boundaries preserved** — the trigger hooks into the existing Teams
  turn lifecycle at the documented debounced idle-finalize (`finalizeDispatch` /
  `finalizeAmbient`). No hidden cross-layer coupling; the setting flows renderer→main
  through the existing `teams:getSettings` / `teams:saveSettings` IPC + preload bridge.
- [x] **Input focus transitions routed through `InputManager`** — N/A (no renderer input
  handling introduced).
- [x] **Session lifecycle integrity maintained** — main-process direct render (FR-007b)
  runs as a node child process out-of-band; it never touches the PTY/session, so Copilot
  CLI session semantics and event forwarding are unaffected (Principle III).
- [x] **Configuration-first approach used** — the opt-in is a new typed
  `TeamsSettings.autoRenderMarkdownImages` boolean (default OFF), added to the store's
  defaults + normalize function, not a hardcoded branch. The 1000-char gate is a named
  constant.
- [x] **Regression validation scope defined** — reuse & re-run existing Teams tests
  (imageMarker, fileMarker, dispatchQueue, ambient-stream, lifecycle, online-roundtrip,
  messageFilter, marker/self-loop). Add unit tests for the pure detector and integration
  tests for finalize-path augmentation, no-double-render, and fallback-on-failure.

**Complexity note**: FR-007 explicitly accepts that the main process now depends on
playwright/Chromium (via the skill's `node_modules`), crossing today's agent-sandbox
boundary where main renders no images itself. This is a *documented, user-clarified
tradeoff* (Q5), mitigated by the FR-008 graceful fallback + a capability pre-check
(Phase 0 research item R1). It is not a constitution violation but is tracked in
Complexity Tracking below for visibility.

## Project Structure

### Documentation (this feature)

```text
specs/018-teams-auto-image-render/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── markdown-detection.md      # Pure detector module contract
│   └── render-child-process.md    # Main→renderer child-process invocation contract
├── checklists/
│   └── requirements.md  # (already passing)
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
electron/teams/
├── markdownDetect.ts        # NEW — pure detector: shouldAutoRenderMarkdown(text) + constants
├── autoImageRenderer.ts     # NEW — main-process child-process render wrapper (spawn mjs, capture sentinel)
├── teamsService.ts          # EDIT — call detector+renderer in finalizeDispatch / finalizeAmbient
├── teamsSettingsStore.ts    # EDIT — add autoRenderMarkdownImages default + normalize
├── types.ts                 # EDIT — add autoRenderMarkdownImages to TeamsSettings
├── teamsIpc.ts              # (no new channel; existing get/saveSettings carry the flag)
├── imageMarker.ts           # REUSE unchanged (extract / loadHostedImages / hostedImagesHtml, sandbox)
└── graphClient.ts           # REUSE unchanged (inline hostedContents posting)

.github/skills/office-image-teams-reply/
└── render-markdown-image.mjs  # REUSE unchanged (invoked as child process with --cwd)

<renderer Teams settings UI>   # EDIT — surface the new opt-in toggle (mirrors existing enabled/ack toggles)

tests/
├── unit/teams/
│   ├── markdownDetect.test.ts     # NEW — structure + 1000-char gate + sentinel guard (pure)
│   └── teamsSettingsStore.test.ts # NEW/EDIT — default OFF + normalize round-trip for new flag
└── integration/teams/
    └── teams-auto-image-render.test.ts  # NEW — finalize augments, no-double-render, fallback-on-failure
```

**Structure Decision**: desktop-app, single-project layout. All logic lands in the
existing `electron/teams/` main-process module directory alongside the sibling
sentinel/settings modules it reuses. The detector is deliberately isolated into its own
pure module (no fs, no electron, no teamsService import) so the FR-002 heuristic is
unit-testable in isolation; the child-process render side effect is isolated into
`autoImageRenderer.ts` so it can be injected/mocked in the teamsService integration test.

## Complexity Tracking

| Violation / Tradeoff | Why Needed | Simpler Alternative Rejected Because |
|----------------------|------------|--------------------------------------|
| Main process now depends on playwright/Chromium (via skill `node_modules`), crossing today's "main renders no images" boundary | FR-007 requires a **deterministic** post-hook render; the renderer already exists and produces the exact PNG + sentinel the inline path consumes | Option (a) re-prompting the agent to run the skill relies on nondeterministic LLM compliance and would restart a turn, conflicting with the idle/finalize logic (Q5). Mitigated by FR-008 fallback + capability pre-check (R1). |
| New auto-post behavior into a shared Teams channel | Core feature value: rich markdown renders faithfully on mobile without manual skill invocation | Gated behind a new opt-in `TeamsSettings` flag (default OFF, FR-010) so it cannot regress existing users until proven. |
