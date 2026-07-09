# Phase 0 Research: SDK Control Plane (Variant 1)

**Feature**: `013-sdk-control-plane` | **Date**: 2026-07-08

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

## In-app validation findings (T037, 2026-07-09)

Ran the BUILT terminal server (`dist/electron/terminal/server.js`) forked exactly as the app does
(`ipc-relay.ts`), with `COPILOT_TERMINAL_BACKEND=ui-server`, and drove a real `start` +
`submit-prompt`. This exercised the actual server wiring, not a standalone spike. Findings:

1. **Backend selection wiring works**: server logged `ui-server backend loaded`, accepted `start`,
   and created the per-office session GUID — the T008/T009 path is correct end to end.
2. **CRITICAL bug found + fixed**: when port discovery failed, `whenListening()`'s rejection was an
   **unhandled rejection that crashed the entire terminal server** (Node 25 treats unhandled
   rejections as fatal). Fixed by (a) a defensive `.catch` on the stored `listeningPromise` in the
   `UiServerHostRuntime` constructor, and (b) `UiServerBackend.start` now tears down a failed office
   entry (stop client + runtime, evict from registry) and rethrows a clean error. The server now
   fails gracefully and stays alive (verified: clean shutdown, exit 0). Regression test:
   `tests/unit/terminal/uiServerHostRuntime.test.ts`.
3. **CLI-resolution/capability gap (environmental, NOT yet fixed)**: on this machine
   `resolveCopilotCliPath` resolved the VS Code-bundled CLI
   (`...github.copilot-chat/copilotCli/copilot` — a 124-byte extensionless wrapper script), which
   `pty.spawn` cannot launch (only `.bat`/`.cmd` are wrapped by `createSdkCliLaunchConfig`) and
   which does not emit `listening on port`. So the capability probe passing (`--ui-server` not
   rejected) is **necessary but not sufficient** — the resolved binary must also be a real,
   ui-server-capable executable. The spikes worked only because they used the SDK-cache
   `copilot.exe` explicitly. **Follow-up (new task T039):** resolve/prefer a ui-server-capable
   executable (e.g. SDK-cache `copilot.exe`, or wrap extensionless/`.ps1` shims), and add
   **start-time fallback to node-pty** so a ui-server `start()` failure never leaves an agent
   unstarted (FR-010 spirit). Until then the `ui-server` backend cannot complete a real turn in this
   environment, which reinforces keeping `node-pty` the default.

## Start-time fallback validation (T039, 2026-07-09)

Implemented start-time fallback: when the `ui-server` backend's `start()` fails (e.g. the resolved
CLI cannot host `--ui-server`), `startTerminalForAgent` transparently retries once with a
lazily-created node-pty backend, and the rest of the start path uses that `activeBackend`.

Verified in-app (forked built server, `COPILOT_TERMINAL_BACKEND=ui-server`): ui-server start failed
with Win32 error 193 (the extensionless wrapper CLI is not a spawnable executable), the
`[lifecycle] ui-server start failed ... falling back to node-pty` log fired, and the start
**succeeded** with a real node-pty pid — the agent was NOT left unstarted. This validates **SC-005**
("when `--ui-server` is unavailable, the app operates via the legacy backend with no user-facing
error") end-to-end through the real server wiring.

Net reliability posture: the `ui-server` backend is now **safe to enable** even where the flag/CLI
is not fully capable — it degrades to node-pty per-session with no user-facing failure. A full turn
*through* `ui-server` still requires an environment whose resolved copilot CLI is a real,
ui-server-capable executable (documented; the remaining half of T039 — preferring a capable exe — is
optional given the fallback).

## Permission posture mapping (T030 / FR-009, 2026-07-09)

The app's YOLO flag (server module state, set via `set-yolo`) is now threaded into the ui-server
backend via `StartTerminalOptions.yolo` and baked at session creation (parity with node-pty, which
bakes `--yolo` at launch):
- **YOLO on** → `onPermissionRequest` = the SDK-exported `approveAll` (auto-approve every request).
  This is the **verified** path (spikes used approveAll successfully).
- **YOLO off** → `onPermissionRequest` returns `{ kind: 'no-result' }`, signalling the client does
  not decide, so the prompt defers to the hosted runtime's own TUI (which the human is
  viewing). **VERIFIED 2026-07-09** via the end-to-end ui-server spike (`spike-e2e.mjs`, run against
  SDK-cache `copilot.exe` 1.0.64-1): a yolo-off session sent a tool-requiring prompt, a permission
  request was surfaced, the client returned `no-result`, and the control plane did **not** crash and
  remained responsive (`listSessions()` succeeded afterward). See the "End-to-end ui-server spike"
  section below. Because YOLO defaults to off and the whole backend defaults to node-pty, this does
  not affect current users.

## End-to-end ui-server spike (2026-07-09)

An out-of-tree harness (`spike-e2e.mjs`, since deleted) exercised the full production path against a
**ui-server-capable** CLI (`%LOCALAPPDATA%\github-copilot-sdk\cli\1.0.64-1\copilot.exe`), mirroring
`terminal-backend.ts` exactly: node-pty hosts `copilot --ui-server --port 0`, port discovered from
`/listening on port (\d+)/i`, SDK attaches via `RuntimeConnection.forUri(localhost:PORT)` with no
auth options. Results (all PASS):

- **port_discovery** — host emitted the port; SDK client `start()` succeeded.
- **turn_roundtrip_pong** — programmatic `session.send({prompt, mode:'enqueue'})` produced an
  assistant-only reply of exactly `PONG`, with the full event lifecycle observed:
  `assistant.message_start → assistant.message_delta → assistant.message → assistant.turn_end →
  assistant.idle → session.idle`. (An earlier draft false-positived by matching the echoed prompt in
  `user.message`; detection was tightened to assistant-authored events + turn-end before claiming.)
- **foreground_switch** — `setForegroundSessionId(B)` then `(A)` both resolved.
- **t029_yolooff_deferral** — see T030 above (permission surfaced, no-result, no crash, responsive).
- **NEW robustness finding — promo-modal interstitial:** the CLI shows a one-time install-nudge
  "Now generally available! … Would you like to install it? [Yes, install] [No, thanks]" modal on
  startup that **blocks `--ui-server` from listening** until dismissed (it waits on stdin). It is a
  **one-time nudge per profile**, tracked by the persistent boolean `appInstallNudgeResponded` in
  `~/.copilot/config.json` (alongside a separate one-time `appTipShown`) — NOT a daily/periodic
  prompt. Empirically it appeared on a fresh launch while `appInstallNudgeResponded` was still
  `false` and stopped once answered. So it re-fires on a fresh machine/user profile, on a config
  reset, or when a CLI upgrade introduces a *new* interstitial keyed on a new flag. The spike
  detected `/install it\?|Yes, install/i` in the pty stream and wrote `n\r` to dismiss. **Production
  `UiServerHostRuntime` handles this** (implemented: bounded rolling-buffer detection + one-shot
  `n\r`), else ui-server startup would hang until the port-discovery timeout and fall back to
  node-pty (T039).

## Residual & deferred verification (2026-07-09)

These items are designed and code-verified where possible, but their live-runtime behavior is
**blocked by the CLI-resolution gap** (this environment resolves a wrapper CLI that cannot host
`--ui-server`), so they are documented rather than claimed as fully verified:

- **T029 / FR-021 modal collision (VERIFIED 2026-07-09):** the yolo-off `{ kind: 'no-result' }`
  deferral was exercised end-to-end (see "End-to-end ui-server spike"): a permission request on a
  live ui-server session was surfaced and deferred without crashing the control plane, which stayed
  responsive. The remaining nuance — whether the runtime's TUI prompt visually coexists with a
  human's *in-progress input line* on the same foreground session — is a rendering concern owned by
  the hosted runtime, not the control plane; mitigation if it ever misbehaves: gate programmatic
  sends while a modal is pending, or route elicitation through the SDK `session.ui` API.
- **T026 background-sessions-events-only (code-verified):** only the foreground session renders TUI
  bytes (a hosted runtime shows one session at a time; `setForegroundSessionId` selects it);
  background sessions still emit events via `SdkEventSource`. This is inherent to the design; live
  multi-session rendering behavior was shown in spike D but not re-run in-app.
- **T031 office-switch continuity (code-verified):** `UiServerProcess.kill()` calls
  `session.disconnect()` (NOT `deleteSession`), preserving on-disk history so the session resumes by
  GUID; the office detach path is unchanged. End-to-end office-switch on `ui-server` not re-run
  in-app (same CLI gap).
- **T025/T033/T034/T035 (verified via diff):** the feature touches neither `TerminalOverlay`,
  `SeriousTerminalController`, `src/util/toolStatus`, `src/scenes`, `src/entities`, nor `src/input`
  — so Phaser-first rendering (I), InputManager focus (II), and clipboard/selection discipline (VI)
  are structurally preserved for the default path; `ui-server` adds behavior additively.
