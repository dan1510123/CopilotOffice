# Quickstart: Enable & Validate the UI-Server SDK Backend

**Feature**: `012-sdk-control-plane` | **Date**: 2026-07-08

How to turn on and validate the Variant-1 backend during development. This mirrors the spikes that
proved the approach (A–E3).

## Prerequisites

- SDK upgraded to stable GA: `npm install @github/copilot-sdk@1.0.5` (blast radius:
  `terminal-backend.ts`). Pin the exact version — do NOT use `@latest` (it currently resolves to the
  prerelease `1.0.6-preview.1`).
- A Copilot CLI whose `--ui-server` flag is accepted (verify with the capability probe below).
- Build the worktree before testing (Constitution VII — verify the bundle you run is the rebuilt one):
  `npm run build`.

## Capability probe (FR-010)

The flag is undocumented; probe by argument acceptance (strict parser errors on unknown flags):

```powershell
$cli = (Get-Command copilot).Source
& $cli --this-is-not-a-flag 2>&1   # expect: error: unknown option  (parser is strict)
& $cli --ui-server 2>&1            # expect: NO "unknown option" (falls through to startup) → supported
```

If `--ui-server` is rejected, the app MUST auto-fall back to `node-pty`.

## Enable the backend

- Set the typed backend-selection setting to `ui-server` (feature flag), or during development:
  `COPILOT_TERMINAL_BACKEND=ui-server`.
- Default remains `node-pty`; `sdk` (headless Variant-2) stays available but is out of scope.

## Manual validation (mirrors spikes D + E3)

1. **Round-trip (Spike A/D)**: launch an office; open an agent; confirm the real TUI renders. Send a
   programmatic prompt (e.g., via Teams remote) and confirm the reply appears in the TUI and is
   captured as `assistant.message`.
2. **Shared port / multi-agent (Spike D)**: with 2+ agents in one office, confirm one hosted runtime
   + one control port serves both (`listSessions` returns both), and switching agents flips the
   foreground TUI (`setForegroundSessionId`).
3. **Resume (Spike D)**: restart the office; confirm sessions resume by GUID with history intact.
4. **Send-while-typing (Spike E3 / FR-019 / SC-007)**: type an unsubmitted line in the TUI, deliver
   a programmatic prompt, confirm the human line is preserved (not merged/cleared) and submits as a
   separate later turn on Enter. Turn order: programmatic first, human second.
5. **Readiness gate (FR-020)**: confirm no input is delivered before the session signals ready
   (guards the load-time keystroke-drop observed in spikes).
6. **Fallback (FR-010)**: on a CLI without `--ui-server`, confirm the app starts on `node-pty` with
   only a structured log line (no user-facing error).

## Automated checks to run

```powershell
npm run test          # unit/integration (event mapping, capability probe, readiness gate, send-while-typing)
npm run test:e2e      # full-boot smoke incl. office create/switch
```

## Rollback

Set backend selection back to `node-pty` (default). No data migration is involved — session GUIDs
and `~/.copilot` state are shared across backends.
