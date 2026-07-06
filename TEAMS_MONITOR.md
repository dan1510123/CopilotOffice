# Teams Monitor — How It Works

A mini technical overview of the Teams monitor subsystem in Agency Cowork.

**Code location:** `skills/teams/scripts/monitor/`
**Design reference:** `docs/PLAN-persistent-pty-monitor.md`, `architecture.md`

---

## What it does

The Teams monitor is a long-lived background service that listens to your
Microsoft Teams chats in real time. When someone (usually you) posts a message
containing a trigger keyword (default `@agent`) in a monitored conversation, the
monitor extracts the prompt, runs it through the Agency Copilot CLI, and posts
the answer back into the same Teams chat.

It turns Teams into a remote control for the agent — send a task from your phone,
get the result back as a chat reply.

---

## High-level flow

```
Teams message
   │  (real-time push)
   ▼
Trouter WebSocket  ──►  trouter_client.py   (receive + parse EventMessage)
   │
   ▼
message_handler.py  ──►  filter pipeline (dedup, keyword, sender, conversation, injection guard)
   │  passes → extract prompt
   ▼
prompt_queue.py     ──►  per-conversation queue (sequential dispatch)
   │
   ▼
pty_bridge.py  ◄──NDJSON over named pipe──►  pty-bridge/bridge.js  (Node sidecar)
   │                                              │
   │                                              ▼
   │                                     persistent PTY running `agency copilot`
   │                                              │
   │                                     reads ~/.copilot/session-state/<uuid>/events.jsonl
   ▼
_reply_to_chat()   ──►  chatsvc REST API  ──►  reply posted back to Teams
```

---

## Components

| File | Role |
|------|------|
| `service.py` | Entry point / lifecycle. Auth, Trouter connection, reconnect loop, PID/lock files, starts the PTY bridge. CLI: `enable` / `start` / `stop` / `disable` / `status`. |
| `trouter_client.py` | WebSocket client for Teams **Trouter** push service. Socket.IO-style frame parser. Delivers `EventMessage` objects to the handler. |
| `message_handler.py` | The brain. Runs the filter pipeline, extracts prompts, handles built-in commands (`join`/`leave`/`list`/`status`), and posts replies via chatsvc REST (`_reply_to_chat`). |
| `prompt_queue.py` | Per-conversation `asyncio.Queue`. Serializes prompts so one PTY session handles them one at a time; manages idle-session cleanup. |
| `pty_bridge.py` | Python client to the Node bridge. Connects over a named pipe (Windows) / Unix socket, sends `spawn`/`write`/`kill`, awaits `turn_end`. |
| `pty-bridge/bridge.js` | Node.js sidecar. Owns the actual `node-pty` sessions, drives the Copilot TUI, and watches the JSONL event log for responses. |
| `config.py` | Global + per-workspace config (`~/.agency-cowork/monitor-config.json`). Keyword, monitored conversations, dispatch settings. |
| `dispatch_store.py` | Tracks in-flight/finished dispatches. |

---

## The filter pipeline (message_handler.py `handle()`)

Every inbound message passes these gates in order — any failure drops the message silently:

1. **Dedup** — skip already-seen `message_id`.
2. **Stale filter** — skip messages older than ~5 min (avoids replaying backlog on restart).
3. **Strip HTML** to plain text for matching.
4. **Self-loop prevention** — skip messages the agent itself sent (they carry the reply prefix, e.g. `Agency Cowork: `).
5. **Keyword match** — text/HTML must contain the configured keyword (`@agent`). Keyword must start with `@` or `#`.
6. **Sender verification** — sender MRI must match the authorized user identity.
7. **Conversation check** — conversation must be in the monitored list (`*` = wildcard = all).
8. **Prompt-injection guard** (`scan_for_injections`) — external/group chats are blocked + notified on a hit; self-chat (`48:notes`, type `Self`) is trusted, logged, and proceeds.

Passing all gates → the prompt is extracted and either handled as a **built-in command** or **dispatched** to the queue.

---

## Persistent PTY dispatch (the key optimization)

The original design spawned a fresh `agency copilot` subprocess per prompt,
paying a 15–30s cold start every time (CLI boot + MCP servers + auth). The
current design keeps **one persistent PTY session per conversation** alive via
the Node bridge, so follow-up prompts run in ~1s.

### How the bridge drives the interactive TUI

The Copilot CLI is an interactive Ink/React terminal app — you can't just pipe
text at it. `bridge.js` uses techniques (all built on **standard, public**
terminal control sequences, tuned empirically for this CLI):

- **Ready gate** — waits for `Environment loaded:` in PTY output before sending anything (that string appears only after all MCP servers connect).
- **Bracketed paste** — writes the prompt as `\x1b[200~<text>\x1b[201~` so the TUI's re-render storm doesn't drop characters and `@`/`/` don't trigger TUI shortcuts.
- **Staggered triple-Enter** — Ctrl+U (clear line) → paste → wait `min(2000, 800 + len/3)` ms → `\r`, then again at +400ms and +500ms. Ink briefly detaches stdin during re-renders, so a single Enter is unreliable; the reliability test found this pattern hits ~100%.
- **Trust dialog auto-answer** — auto-selects "trust + remember" if the workspace-trust prompt appears.

### Reading responses

PTY stdout is full of ANSI codes and repaints, so it's **not** used for content.
Instead the bridge tails the CLI's own structured event log at
`~/.copilot/session-state/<uuid>/events.jsonl` (polled every 200ms, incremental
byte reads):

- `assistant.message` → accumulate markdown content
- `assistant.turn_end` / `session.task_complete` → turn done, flush the reply
- `session.error` → surface the error

The accumulated response flows back through the Python client → `_reply_to_chat()`
→ Teams.

### IPC protocol

Python ↔ Node communicate over a **named pipe** (`\\.\pipe\agency-pty-bridge` on
Windows, Unix socket elsewhere) using **NDJSON**. Commands: `spawn`, `write`,
`kill`, `ping`, `status`, `shutdown`. Events: `ready`, `turn_end`,
`assistant_message`, `pty_data`, `exit`, `error`, `pong`, `spawned`, `status`.

Clients identify as `ui` or `monitor`; raw `pty_data` (for the Electron Monitor
tab's live terminal view) is only sent to `ui` clients.

---

## Configuration

Global config: `~/.agency-cowork/monitor-config.json`. Identity + connection are
global (one Teams identity per user); keyword, monitored conversations, and
dispatch settings are per-workspace.

Key `DispatchConfig` fields (`config.py`):

| Field | Default | Meaning |
|-------|---------|---------|
| `use_persistent_pty` | `true` | Use the PTY bridge (vs subprocess fallback) |
| `pty_warmup_conversations` | `["48:notes"]` | Sessions pre-spawned at startup |
| `pty_max_sessions` | `5` | Max concurrent PTY sessions |
| `pty_idle_timeout_minutes` | `60` | Kill idle sessions after this |
| `pty_queue_max` | `5` | Max queued prompts per conversation |
| `autopilot_mode` / `auto_approve_permissions` | `true` | Non-interactive permission handling |

`48:notes` is the Teams "self chat" (Notes to self) — the default trusted
conversation used both as a trigger source and as a place to echo results.

---

## Fallback

If the Node bridge can't start (missing `node`, broken native deps), the handler
falls back to the original per-prompt subprocess path
(`_dispatch_prompt_subprocess_fallback` in `message_handler.py`) so the monitor
still works, just slower.

---

## Running it

```bash
python -m scripts.monitor.service enable    # one-time, shows security warning
python -m scripts.monitor.service start      # start listening
python -m scripts.monitor.service status     # check state
python -m scripts.monitor.service stop       # stop
```

The Electron UI also exposes a **Teams Monitor** view with a live read-only
terminal (fed by `pty_data`) and start/stop controls (see `ui/src/useMonitor.js`,
`ui/src/App.jsx`).

---

## Security notes

- Only messages from the **authorized sender MRI** are ever dispatched.
- External/group conversations are **prompt-injection guarded**; self-chat is trusted.
- Nothing here contains secrets — auth uses Teams chatsvc tokens acquired at runtime.
- The PTY driving technique uses standard terminal control codes; the specific
  timing/gating is this project's own empirical tuning of the Copilot CLI, not a
  documented public API.
