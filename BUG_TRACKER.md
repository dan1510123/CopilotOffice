# Copilot Upgrade Bug Tracker

This file tracks defects found while upgrading to Copilot CLI 1.0.88, Copilot SDK
1.0.14, and the per-agent native-TUI bridge. A bug is only marked fixed when it
has regression coverage and the applicable smoke path passes.

| ID | Status | Defect | Resolution / evidence |
|---|---|---|---|
| CO-001 | Fixed | CLI 1.0.88 no longer starts the hidden `--ui-server` mode, leaving startup waiting forever for a port. | Capability probing now rejects unsupported UI-server startup; `native-bridge` is the default and `sdk` is its explicit fallback. |
| CO-002 | Fixed | `EventsWatcher` synchronously read and parsed the complete historical `events.jsonl`; several large histories could block terminal-server IPC and time out startup requests. | Historical replay now uses bounded asynchronous chunks with coalesced triggers, UTF-8-safe buffering, and regression coverage (`0a590d0`). |
| CO-003 | Fixed | Bridge credentials could leak into shell or MCP tool child environments. | Bridge variables are passed via `--secret-env-vars` and stripped from inherited child environments (`85f4686`). |
| CO-004 | Fixed | Parent PID was treated as sufficient bridge identity and could be spoofed. | Each launch now requires a random per-TUI nonce, constant-time comparison, and expected-parent validation (`85f4686`). |
| CO-005 | Fixed | Bridge readiness could remain latched after the extension disconnected. | Readiness now checks the broker's live registration and bounded reconnect path (`85f4686`). |
| CO-006 | Fixed | Interactive `ask_user` and plan responses could race session replacement or resolve the wrong request. | Requests are correlated by ID, stale pending interactions are cleared on replacement, and payloads survive reconnect buffering (`9fa4233`, `85f4686`). |
| CO-007 | Fixed | Oversized SDK events could disconnect the bridge and silently lose subsequent events. | Event payloads are bounded/truncated before framing, with regression coverage (`9fa4233`). |
| CO-008 | Fixed | Events emitted while the broker was reconnecting could be lost. | The extension keeps a bounded event backlog and flushes it after registration (`85f4686`). |
| CO-009 | Fixed | Coalesced or pre-seeded fleet prompts could be dropped while an agent was warming or already existed. | Prompts are queued and delivered after live readiness for both new and reused sessions (`9fa4233`, `85f4686`). |
| CO-010 | Fixed | Fleet completion and lifecycle events could cross office boundaries after session transfer. | IPC events carry `officeId`, routing is office-scoped, and transferred aliases mirror completion safely (`9fa4233`, `85f4686`). |
| CO-011 | Fixed | `/clear` replaced the foreground session and could leave stale broker/session mappings. | Registration generations replace stale mappings and persist the new authoritative session ID (`6a62e13`, `85f4686`). |
| CO-012 | Fixed | Smoke failures could leave native TUI processes or temporary Copilot session directories behind. | The bounded smoke harness tracks and removes every process and session artifact in `finally` (`19a212c`, `85f4686`). |
| CO-013 | Fixed | Teams could unnecessarily respawn a native session instead of reusing an active bridged agent. | Teams now checks live bridge readiness first and resumes persisted sessions only when disconnected (`375a011`, `85f4686`). |
| CO-014 | Fixed | Every fresh native TUI could block on the SDK extension's sensitive-environment consent dialog, so active agents never registered with the broker without manual input. | The backend recognizes only the exact CopilotOffice extension and three-variable prompt, selects its repo-scoped approval, rearms after a live connection for `/clear`, and retains CLI secret-variable stripping. |

## Verification

All tracked defects are closed. The final gate passed TypeScript, production
build, 1,263 tests across 148 files, and `npm run smoke:native-bridge`. The
smoke proved two independent native TUI processes and sessions, matching
SDK-to-TUI prompt routing, `/clear` replacement and post-clear delivery, and
complete process/temp-session cleanup.
