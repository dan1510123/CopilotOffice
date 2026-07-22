# Quickstart: Auto-Render Markdown Replies as Teams Images

Developer-facing guide to building, enabling, and verifying feature
`018-teams-auto-image-render`.

## Prerequisites

- Repo builds and tests pass: `npm run build`, `npm run test`.
- The `office-image-teams-reply` skill is set up once (so main can shell out to it):
  ```powershell
  Set-Location .github/skills/office-image-teams-reply
  npm install
  npx playwright install chromium
  ```
  If this is skipped, auto-render simply **falls back to plain text** (FR-008) — nothing
  breaks, the image just isn't produced.

## What gets built

| File | Change |
|------|--------|
| `electron/teams/markdownDetect.ts` | NEW pure detector (`shouldAutoRenderMarkdown`, `hasBlockStructure`, `hasExistingImageSentinel`, `AUTO_RENDER_MIN_CHARS = 1000`) |
| `electron/teams/autoImageRenderer.ts` | NEW child-process render wrapper (`createAutoImageRenderer`) |
| `electron/teams/types.ts` | ADD `autoRenderMarkdownImages: boolean` to `TeamsSettings` |
| `electron/teams/teamsSettingsStore.ts` | ADD default `false` + normalize for the new flag |
| `electron/teams/teamsService.ts` | CALL detector + renderer in `finalizeDispatch` / `finalizeAmbient` (additive) |
| renderer Teams-settings UI | ADD an opt-in toggle bound to `autoRenderMarkdownImages` |

## Enable the feature

1. Ensure Teams remote is enabled and an agent is bound online.
2. In the Teams settings UI, turn **"Auto-render markdown replies as images"** ON
   (persists to `.data/teams-settings.json` as `autoRenderMarkdownImages: true`). Default
   is OFF (FR-010).

## Manual verification (maps to acceptance scenarios)

1. **US1 — auto-render (P1)**: drive an online agent to produce a final reply **> 1000
   chars** containing a markdown table or fenced code block; let it go idle. Expect the
   plain-text reply **plus** a separate inline rendered image in the thread, with no
   manual skill invocation.
2. **US1.3 — plain prose**: a long reply of pure prose (no block structure) → no image.
3. **Edge — short structured**: a ≤1000-char reply with a tiny table → no image.
4. **Edge — large unstructured**: a >1000-char wall of prose → no image.
5. **US2 — never drop (P1)**: temporarily rename the skill's `node_modules` (or force a
   render error); repeat step 1 → the plain-text reply still posts, failure logged, no
   broken image.
6. **US3 — no double-render (P2)**: have the agent emit a valid
   `<!--office-image:...-->` sentinel in a >1000-char markdown reply → exactly one image
   (the agent's); no auto-render duplicate.
7. **US4 — opt-out (P3)**: toggle the setting OFF, repeat step 1 → reply posts as plain
   text only.

## Automated tests

```powershell
npm run test -- markdownDetect          # pure detector: structure + 1000-char gate + sentinel guard
npm run test -- teams-auto-image-render # finalize augments, no-double-render, fallback-on-failure
npm run test -- teams                   # regression: existing Teams suites still green (SC-006)
npm run build                           # TS strict must pass
```

Key assertions:
- `shouldAutoRenderMarkdown` truth table (see `contracts/markdown-detection.md`) incl.
  every spec edge case.
- Finalize with the flag ON + qualifying reply → an **additional** `safeReply` carrying
  hosted image(s) is issued after the plain-text posts (augment, FR-004).
- Render helper failure (mock `spawn` non-zero / timeout / no-sentinel) → **no** extra
  image post, plain text intact (FR-008).
- Existing sentinel present → auto-render skipped (FR-009).
- Flag OFF → detector/renderer never invoked (FR-010).
- Existing imageMarker / dispatchQueue / ambient-stream / lifecycle / messageFilter /
  marker suites remain green (FR-011/FR-012, SC-006).

## Rollback

Set `autoRenderMarkdownImages: false` (or remove the key) in
`.data/teams-settings.json` — the feature is fully inert with the flag OFF; no other
Teams behavior changes.
