# Contract: SDK Event → CopilotEvent Normalization

**Feature**: `012-sdk-control-plane` | **Date**: 2026-07-08

For `ui-server`-hosted agents, status/tool/turn signals come from the SDK's `session.on(...)`
instead of tailing `events.jsonl`. To avoid changing downstream consumers, SDK events MUST be
normalized into the existing `CopilotEvent` shape (`electron/terminal/events-watcher.ts`) consumed
by `server.ts`. This preserves the renderer, status reducers, fleet tracking, and Teams capture.

## Target shape (unchanged)

```
interface CopilotEvent { type: string; data: Record<string, unknown>; id; timestamp; parentId }
```

## Mapping (SDK event → CopilotEvent.type + data)

| SDK `session.on` event | Normalized `CopilotEvent.type` | Notes |
|------------------------|-------------------------------|-------|
| `assistant.turn_start` | `assistant.turn_start` | marks agent in-turn |
| `assistant.turn_end`   | `assistant.turn_end`   | drives ready/done + ask_user race guard (`toolStatus.ts`) |
| `session.idle`         | (readiness / done)     | used for ready detection & turn settle |
| `assistant.message`    | `assistant.message`    | **Teams capture** — assistant reply text for thread reply |
| `assistant.message_delta` | (streaming)         | optional streamed content for the TUI/preview |
| `tool.execution_start` | `tool.execution_start` | `data.toolName`, `data.toolCallId`, `data.arguments` (→ `formatToolStatus`) |
| `tool.execution_complete` | `tool.execution_complete` | `data.toolCallId`, `data.success` |
| `user.message`         | `user.message`         | ready detection; keep user-message seq/text for parity |
| `subagent.started/completed/failed` | `subagent.*` | **fleet-critical** — forward without a viewer |
| `system.notification`  | `system.notification`  | **fleet-critical** — forward without a viewer |

## Requirements

1. Normalized events MUST be emitted through the **same** server paths used today
   (`copilot-tool-start`, `copilot-tool-complete`, `copilot-turn-start/end`, `copilot-user-message`,
   `copilot-event`) so the renderer and status reducers are unchanged.
2. Fleet-critical events (`subagent.*`, `system.notification`, task `tool.execution_start`) MUST be
   forwarded even when no viewer is attached (unchanged guarantee; `isFleetCriticalEvent`).
3. Teams-online agents with no renderer viewer MUST still receive `assistant.message` mirrored to
   main-process consumers (`mainOnly: true`) so the reply posts back to the thread.
4. Ready detection MUST NOT rely on file-tailing heuristics for `ui-server` agents; use
   `session.idle` / first `turn_end` from the SDK, gated so historical events do not cause invalid
   `starting → thinking` transitions.
5. The `SdkEventSource` MUST implement the existing `CopilotEventSource` interface
   (`start(onEvent)`, `stop()`, `getSessionId()`) so `server.ts` can select it via the factory with
   no downstream changes.
6. Status transitions MUST continue routing through `src/util/toolStatus.ts`
   (`nextSubStateAfterToolComplete`) — the ask_user race guard is not reimplemented.
