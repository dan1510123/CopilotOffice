# Phase 0 Research: SDK Control Plane (Variant 1)

**Feature**: `012-sdk-control-plane` | **Date**: 2026-07-08

All major unknowns were resolved empirically via spikes A–E3 (run in this worktree, isolated with
fresh session GUIDs and own-PID cleanup, then deleted). This document consolidates the findings so
the design phase and tasks inherit them.

## Decisions (from /speckit.clarify, 2026-07-08)

| ID | Decision | Rationale |
|----|----------|-----------|
| FR-016 | **One hosted runtime per office** | Crash isolation between offices; maps to per-office session files; foreground-TUI model fits one-visible-agent UX |
| FR-017 | **SDK carries programmatic prompts only**; humans type into the real TUI | Preserves native slash commands, autocomplete, ask_user modals, plan mode |
| FR-018 | **Permanent dual-backend** + auto-fallback | `--ui-server` is undocumented; keep legacy node-pty as supported fallback |

## Spike evidence

- **Spike A** — SDK `send`/receive on upgraded 1.0.4: streamed reply, clean shutdown (0 cleanup
  errors). Confirms the send path and de-risks the version bump.
- **Spike B** — node-pty TUI resuming an SDK-created session: TUI rendered the prior SDK turn from
  the shared session store (sequential handoff works).
- **Spike C** — two independent runtimes on one GUID: **fails** — TUI logs "session already in use
  by another client"; live render did not occur. → Two competing runtimes is the wrong model.
- **Spike D** — `--ui-server` in a PTY + SDK `forUri` attach (one shared runtime):
  - Port discovery from stdout `listening on port <N>` (matches the SDK's own regex).
  - `session.send()` **live-rendered** in the open TUI (`LIVE_RENDER_A/B=true`).
  - Two sessions shared **one** port; `listSessions()` returned both → port = runtime, not session.
  - `setForegroundSessionId` **flipped** the visible TUI (`FOREGROUND_FLIPPED=true`).
  - `resumeSession(guid)` over the same connection returned history (resume works in ui-server mode).
  - `forUri` clients must **not** pass `useLoggedInUser`/`gitHubToken` (throws — server owns auth).
- **Spike E3** — SDK send while a human has an unsubmitted line (ground truth from session history):
  final turns `[WARM][INJECTED][testline]` — the human's line was **preserved** (not cleared, not
  merged) and submitted as its own later turn on the human's Enter. `mode:'enqueue'` preserves
  submission order without splicing text. Also observed: keystrokes typed during session **load**
  can be dropped → gate input on readiness (FR-020).

## CLI / `--ui-server` provenance

- Documented across all six `github/copilot-sdk` bindings (Node/Python/Go/Rust/.NET/Java) on
  `getForegroundSessionId`/`setForegroundSessionId`: "Only available when connecting to a server
  running in TUI+server mode (`--ui-server`)." First-class RPC kind
  (`AgentRegistryLiveTargetEntryKind { UI_SERVER, MANAGED_SERVER }`).
- **Undocumented at the CLI layer**: absent from `copilot --help` and the CLI changelog through
  1.0.68. Empirically **accepted** by the installed 1.0.64 strict parser (bogus flags error;
  `--ui-server` falls through to startup). Treat as experimental/hidden → capability probe +
  permanent fallback required.

## SDK API deltas (0.1.32 → 1.x) — blast radius: `electron/terminal/terminal-backend.ts`

- `new CopilotClient({ cliPath, cliArgs, autoStart })` → `new CopilotClient({ connection:
  RuntimeConnection.forStdio({ path, args }) })`; drop `autoStart`. For Variant 1 use
  `RuntimeConnection.forUri('localhost:<port>')` against the PTY-hosted `--ui-server` runtime.
- `forUri` connections MUST NOT pass `useLoggedInUser`/`gitHubToken`.
- `session.send({ prompt, mode: 'enqueue' })`, `resumeSession`, and `session.on(type, handler)`
  event names are **unchanged**.
- Prefer the SDK's exported `approveAll` permission handler over the hand-rolled `{ kind: 'approved' }`.
- New capabilities available: `setForegroundSessionId`/`getForegroundSessionId`, `listSessions`,
  `session.on` typed handlers, `sendAndWait`.
- **Target version: `1.0.5` (stable GA)** — validated 2026-07-08 (send round-trip + full API surface
  present: `RuntimeConnection.forUri/forStdio`, `send`/`sendAndWait`/`on`/`disconnect`,
  `setForegroundSessionId`/`listSessions`/`resumeSession`). ⚠️ Pin explicitly: the npm `latest`
  dist-tag currently points to a **prerelease** (`1.0.6-preview.1`), so `@latest` must NOT be used;
  `1.0.5` is the newest clean release with no prerelease suffix.

## Current codebase baseline (main branch)

- `electron/terminal/terminal-backend.ts` already defines `TerminalBackend`/`TerminalProcess`,
  `NodePtyBackend`, and a `CopilotSdkBackend` that uses the **old headless `cliPath`/`cliArgs`**
  model (Variant 2 "fake terminal"). This is **not** the ui-server model and is not the target of
  this feature — the new `UiServerBackend` is additive.
- `server.ts` selects backend via `COPILOT_TERMINAL_BACKEND` (default `node-pty`), tails
  `events.jsonl` via `FileWatcherEventSource`, and drives programmatic prompts via
  `submitViaKeystrokes` (Ctrl+U → bracketed paste → idle-gated Enter → poll for `user.message`).
- `event-source.ts` already abstracts `CopilotEventSource`/`Factory` — the seam for adding an
  `SdkEventSource`.
- SDK pinned at `^0.1.32` (upgrade to `1.0.5` GA is a prerequisite; `1.0.6` has no stable release
  yet — only `1.0.6-preview.1`).

## Open risks carried into design

- **Modal collision (FR-021, unverified)**: a programmatic turn that triggers a permission /
  ask_user / plan modal on a human-viewed session. Needs an explicit test in tasks.
- **Crash domain (per office)**: relaunch office runtime + resume sessions by GUID on unexpected
  exit; surface via error channels.
- **Auth**: the PTY-hosted `--ui-server` runtime must be launched with the app's existing auth
  environment (the `forUri` client can't supply it).
