# Copilot Office — Executive Summary

## What It Is

**Copilot Office** is a desktop application that reimagines AI-assisted software development as a 2D pixel-art RPG. Developers walk a virtual office, approach NPC agents at their desks, and collaborate through real Copilot CLI terminal sessions — turning multi-agent AI orchestration into an intuitive, spatial experience.

## The Problem

Modern AI coding assistants are powerful but isolated. Developers juggle multiple terminal windows, lose context switching between agents, and lack a natural way to coordinate parallel AI workflows. There's no shared workspace where AI agents feel like teammates rather than tools.

## The Solution

Copilot Office provides a **spatial interface for multi-agent AI collaboration**:

- **Walk up and talk** — Approach an NPC, press `E`, and a real Copilot CLI session opens. No configuration, no context switching.
- **Specialized agents** — Four active agents (Generalist, Architect, Debugger, Admin) each bring distinct expertise. Six more are ready to activate.
- **Meeting Mode** — The Architect agent plans complex tasks, decomposes them into subtasks, and assigns work to other agents — all through an in-game meeting room workflow.
- **Multi-office workspaces** — Manage multiple projects with independent agent states, each mapped to a different working directory.

## Key Capabilities

| Capability | Detail |
|---|---|
| **Real AI sessions** | Every conversation is a live Copilot CLI process with full coding capability |
| **Session persistence** | Agent sessions survive app restarts — pick up where you left off |
| **Parallel agents** | Multiple agents can work simultaneously across different tasks |
| **Real-time status** | Live badges show each agent's state: thinking, waiting, ready, or idle |
| **Toast & OS notifications** | Stay informed of agent activity without watching the terminal |
| **Meeting-driven planning** | Structured plan → approve → parallel execution workflow |
| **Zero external assets** | 100% procedurally generated pixel art — the entire visual layer is code |

## Architecture at a Glance

```
Electron Desktop App
├── Phaser 3 Game Engine ──── 2D office world, sprites, physics, scenes
├── xterm.js Terminals ────── Full VT100 terminal emulator per agent
├── node-pty ──────────────── Real pseudo-terminals running Copilot CLI
├── Layout System ─────────── Pluggable office layouts (default, fleet) via src/layouts/
└── IPC Bridge ────────────── Secure context bridge between game and system
```

Three-tier terminal stack: **xterm.js** (display) → **Electron IPC** (transport) → **node-pty** (execution). Each agent's PTY runs as a child process with session persistence, scrollback buffers, and event monitoring.

## Current State

| Area | Status |
|---|---|
| Core gameplay (movement, interaction, sprites) | ✅ Complete |
| Terminal system (sessions, persistence, events) | ✅ Complete |
| Multi-office management | ✅ Complete |
| Notification system | ✅ Complete |
| Meeting Mode — planning & approval | ✅ Complete |
| Meeting Mode — fleet orchestration | ✅ Built (orchestrator, tracker, visualizer) |
| Mini-games (Pong, Basketball) | ✅ Built, behind feature flags |

## What's Next

1. **Fleet Refinement** — Core fleet code exists (orchestrator, tracker, visualizer); polishing parallel execution and completion detection
2. **Pre-seeded Prompts** — Inject task context directly into agent terminals at spawn time
3. **Git Worktrees** — Each agent works in an isolated branch to prevent conflicts
4. **Meeting Re-entry** — Return to the meeting room to check progress while agents work

## Tech Stack

| Component | Technology |
|---|---|
| Desktop shell | Electron 40 |
| Game engine | Phaser 3 (Arcade Physics) |
| Terminal emulator | xterm.js 5 |
| PTY | node-pty 1.1 |
| Language | TypeScript (strict) |
| Bundler | esbuild |

## By the Numbers

- **4** active AI agents + **6** reserve slots
- **3** Phaser scenes (Boot, Office, Meeting)
- **20×12** tile office grid
- **0** external image assets
- **512 KB** scrollback buffer per agent
- **7** configurable notification event types
- **3-tier** input focus management system
