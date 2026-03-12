# Agent Status Reference

This document defines the agent status tracking model used in Copilot Office. Reference this from `.github/copilot-instructions.md` or custom instructions to understand agent states.

## Status Model

Copilot Office uses a **two-tier status model**:

- **AgentState** — top-level: `slacking` or `active`
- **ActiveSubState** — when active: `starting`, `ready`, `waiting`, `thinking`, or `error`

## Statuses

### Slacking 💤
- **State**: `slacking`
- **Meaning**: No terminal session exists for this agent
- **Color**: `#555` (gray)
- **Icon**: 💤
- **When**: Agent has never been started, or its terminal was killed/destroyed

### Starting 🚀
- **State**: `active` → `starting`
- **Meaning**: Agent's terminal is starting up (preloading)
- **Color**: `#ff9944` (orange)
- **Icon**: 🚀
- **Pulse**: Yes (pulsing badge animation)
- **When**: `terminalPreloadStatus` reports `'preloading'`

### Ready ✓
- **State**: `active` → `ready`
- **Meaning**: Agent has started up and is ready to interact with
- **Color**: `#4af` (cyan)
- **Icon**: ✓
- **When**: Terminal preload completes, or all tools finish running (before turn ends)

### Waiting ⏳
- **State**: `active` → `waiting`
- **Meaning**: Agent is waiting on user input
- **Color**: `#ffb86c` (orange)
- **Icon**: ⏳
- **When**: Copilot turn ends (`onCopilotTurnEnd`)

### Error ❌
- **State**: `active` → `error`
- **Meaning**: Agent failed to start or timed out during startup
- **Color**: `#f44` (red)
- **Icon**: ❌
- **When**: Preload failed, or agent was stuck in `starting` for >60 seconds

### Thinking 🧠
- **State**: `active` → `thinking`
- **Meaning**: Agent is actively doing work
- **Color**: `#50fa7b` (green)
- **Icon**: 🧠
- **Pulse**: Yes (pulsing badge animation)
- **Detail**: `thinkingDetail` provides info on what the agent is doing (e.g. tool name, "Processing...")
- **When**: A tool starts (`onCopilotToolStart`), or user sends a message (`onCopilotUserMessage`)

## State Transitions

```
[startup] ──→ Slacking
                 │
        terminal starts
                 │
                 ▼
             Starting
                 │
          preload ready
                 │
                 ▼
              Ready ◄──────── tool complete (no more tools)
                 │
          user message
                 │
                 ▼
            Thinking ◄──────── tool start / user message
                 │
            turn ends
                 │
                 ▼
             Waiting
                 │
          user message
                 │
                 ▼
            Thinking ──→ ...
```

Terminal killed at any point → **Slacking**

## TypeScript Types

```typescript
type AgentState = 'slacking' | 'active';
type ActiveSubState = 'starting' | 'ready' | 'waiting' | 'thinking' | 'error';

interface AgentStatus {
  agentId: string;
  state: AgentState;
  subState: ActiveSubState | null;   // null when slacking
  thinkingDetail: string | null;     // what agent is doing when thinking
  currentTool: string | null;        // derived from agentTools stack (last tool name)
  unreadCount: number;               // unread action count
  lastEvent: string | null;          // last event type received
  activityStartTime: number | null;  // when current activity began
  lastCompletedAction: string | null; // last completed tool/action
  recentActions: RecentAction[];     // recent action history
  taskSummary: string | null;        // summary of current task
}
```

## Visual Indicators

| Status | Dashboard | NPC Badge | Status Bar |
|--------|-----------|-----------|------------|
| Slacking | Gray `💤 Slacking` | Gray badge + 💤 | `💤 N` |
| Starting | Orange `🚀 Starting...` | Orange pulsing badge + 🚀 | `🚀 N` |
| Ready | Cyan `✓ Ready` | Cyan badge + ✓ | `✓ N` |
| Waiting | Orange `⏳ Waiting for input` | Orange badge + ⏳ | `⏳ N` |
| Error | Red `❌ Error: {detail}` | Red badge + ❌ | `❌ N` |
| Thinking | Green `🧠 Thinking: {detail}` | Green pulsing badge + 🧠 | `🧠 N` |
