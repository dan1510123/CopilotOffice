# Agent Status Reference

This document defines the agent status tracking model used in Agency Office. Reference this from `.github/copilot-instructions.md` or custom instructions to understand agent states.

## Status Model

Agency Office uses a **two-tier status model**:

- **AgentState** — top-level: `slacking` or `active`
- **ActiveSubState** — when active: `initializing`, `ready`, `waiting`, or `thinking`

## Statuses

### Slacking 💤
- **State**: `slacking`
- **Meaning**: No terminal session exists for this agent
- **Color**: `#555` (gray)
- **Icon**: 💤
- **When**: Agent has never been started, or its terminal was killed/destroyed

### Initializing ⟳
- **State**: `active` → `initializing`
- **Meaning**: Agent's terminal is starting up (preloading)
- **Color**: `#ff4` (yellow)
- **Icon**: ⟳
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

### Thinking ⚡
- **State**: `active` → `thinking`
- **Meaning**: Agent is actively doing work
- **Color**: `#50fa7b` (green)
- **Icon**: ⚡
- **Detail**: `thinkingDetail` provides info on what the agent is doing (e.g. tool name, "Processing...")
- **When**: A tool starts (`onCopilotToolStart`), or user sends a message (`onCopilotUserMessage`)

## State Transitions

```
[startup] ──→ Slacking
                 │
        terminal starts
                 │
                 ▼
           Initializing
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
type ActiveSubState = 'initializing' | 'ready' | 'waiting' | 'thinking';

interface AgentStatus {
  agentId: string;
  state: AgentState;
  subState: ActiveSubState | null;   // null when slacking
  thinkingDetail: string | null;     // what agent is doing when thinking
  currentTool: string | null;        // raw tool name
}
```

## Visual Indicators

| Status | Dashboard | NPC Badge | Status Bar |
|--------|-----------|-----------|------------|
| Slacking | Gray `💤 Slacking` | No badge | `💤 N` |
| Initializing | Yellow `⟳ Initializing...` | Yellow badge + ⟳ | `⟳ N` |
| Ready | Cyan `✓ Ready` | Cyan badge + ✓ | `✓ N` |
| Waiting | Orange `⏳ Waiting for input` | Orange badge + ⏳ | `⏳ N` |
| Thinking | Green `⚡ Thinking: {detail}` | Green pulsing badge + ⚡ | `⚡ N` |
