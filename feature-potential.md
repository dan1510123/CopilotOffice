# CopilotOffice — Feature Potential

This document outlines enhancement opportunities for CopilotOffice based on the current shipped state and known in-progress items.

It is intentionally mixed-scope: practical near-term improvements and ambitious longer-term bets.

## Current baseline (for context)

CopilotOffice already has a strong core:

- Procedural 2D office gameplay with Phaser as the sole renderer
- Real Copilot CLI terminal sessions per NPC through Electron + node-pty
- Multi-office state and layout system (`default`, `fleet-vteam`)
- Meeting Mode plan parsing + approval + fleet execution tracking
- Toast/OS notifications and keyboard focus orchestration
- Feature-flagged mini-games and partial player customization support

That baseline means future work should prioritize:

1. Higher reliability and clarity for agent workflows
2. Better UX for planning and coordinating multi-agent work
3. Broader gameplay and personalization depth without breaking architecture boundaries

## Prioritization rubric

Each item includes:

- **User value**: Why players/developers care
- **Implementation surface**: Main modules likely touched
- **Dependencies / risks**: What can block or destabilize delivery
- **Priority band**:
  - **Now**: High impact, low-to-medium risk, fits current architecture
  - **Next**: Valuable, moderate complexity, requires some enabling work
  - **Later**: Ambitious or cross-cutting investments

## Opportunities — Now

### 1) Fleet reliability and observability hardening

- **User value**: Fewer stuck fleet runs, clearer understanding of why an agent is idle/failed.
- **Implementation surface**:
  - `src/meeting/fleetTracker.ts`
  - `src/meeting/fleetVisualizer.ts`
  - `electron/terminal/server.ts`
  - `electron/terminal/events-watcher.ts`
- **Dependencies / risks**: Event ordering and attach/detach edge cases can create subtle race conditions.
- **Notes**: Add explicit timeout/retry states and reason codes visible in dashboard/status badges.

### 2) Meeting plan quality guardrails

- **User value**: Fewer malformed plans and better agent/task assignments before execution.
- **Implementation surface**:
  - `src/meeting/planParser.ts`
  - `src/meeting/planApproval.ts`
  - `src/config/meetingPrompt.ts`
- **Dependencies / risks**: Too-strict validation can reject useful plans.
- **Notes**: Add richer validation errors and inline UI warnings (missing prompt, duplicate agent, vague task title).

### 3) Meeting execution dry-run mode

- **User value**: Lets users inspect assignments and prompts without spawning sessions.
- **Implementation surface**:
  - `src/meeting/planApproval.ts`
  - `src/scenes/MeetingScene.ts`
  - `src/meeting/types.ts`
- **Dependencies / risks**: Must preserve current approve/revise flow and avoid UX clutter.

### 4) Player customization UI completion

- **User value**: Tangible ownership and identity in the office world.
- **Implementation surface**:
  - `src/config/playerCustomization.ts` (already present)
  - `src/ui/` (new customization overlay)
  - `src/scenes/BootScene.ts` (sprite regeneration trigger)
- **Dependencies / risks**: Need safe regeneration flow so active scene state is not desynced.

### 5) Notification tuning presets

- **User value**: Faster setup for different work styles (quiet, balanced, verbose).
- **Implementation surface**:
  - `src/ui/NotificationSettingsPanel.ts`
  - `src/ui/NotificationService.ts`
  - `src/config/notifications.ts`
- **Dependencies / risks**: Preserve per-event custom overrides when applying presets.

### 6) Session metadata UX polish

- **User value**: Easier session history scanning and recovery after many runs.
- **Implementation surface**:
  - `src/ui/TerminalOverlay.ts`
  - `electron/terminal/server.ts`
  - `electron/terminal/preload.ts`
- **Dependencies / risks**: Metadata persistence and migration compatibility.
- **Notes**: Include fast filters (active, archived, failed, newest) and stronger title defaults.

## Opportunities — Next

### 7) Pre-seeded task prompts at spawn

- **User value**: Agents begin with clearer context, reducing first-turn overhead.
- **Implementation surface**:
  - `electron/terminal/server.ts`
  - `electron/terminal/protocol.ts`
  - `src/meeting/fleetOrchestrator.ts`
- **Dependencies / risks**: Must avoid prompt duplication with existing write flow.

### 8) Git worktree-based isolation per agent

- **User value**: Safer parallel coding with fewer merge conflicts.
- **Implementation surface**:
  - `electron/terminal/server.ts`
  - office/session metadata paths
  - meeting orchestration assignment data
- **Dependencies / risks**: Cross-platform path management and cleanup of stale worktrees.

### 9) In-progress meeting re-entry

- **User value**: Return to Arthur mid-execution for status review/replanning.
- **Implementation surface**:
  - `src/scenes/MeetingScene.ts`
  - `src/scenes/OfficeScene.ts`
  - `src/meeting/fleetTracker.ts`
- **Dependencies / risks**: Scene lifecycle cleanup and preserving active trackers across transitions.

### 10) Agent memory snippets in dashboard cards

- **User value**: Quick context continuity (recent goals, blockers, outputs).
- **Implementation surface**:
  - `src/layouts/default/DefaultDashboard.ts`
  - `src/office/officeManager.ts` (state extension)
  - terminal event mapping in `src/main.ts`
- **Dependencies / risks**: Prevent stale/conflicting summaries between office switches.

### 11) Guided onboarding path

- **User value**: New users reach first successful multi-agent run faster.
- **Implementation surface**:
  - `src/scenes/OfficeScene.ts`
  - `src/ui/` (coach marks / tutorial overlay)
  - local persistence for completion state
- **Dependencies / risks**: Must not interfere with core movement/input focus behavior.

### 12) Mini-game progression hooks

- **User value**: More playful loop and optional downtime rewards.
- **Implementation surface**:
  - `src/ui/PongGame.ts`
  - `src/ui/BasketballGame.ts`
  - `src/scenes/OfficeScene.ts` (feature flags + triggers)
- **Dependencies / risks**: Keep mini-games optional and non-blocking.

## Opportunities — Later

### 13) Layout marketplace/plugin model

- **User value**: Teams can tailor office behavior and dashboards for workflows.
- **Implementation surface**:
  - `src/layouts/types.ts`
  - `src/layouts/index.ts`
  - configuration loading boundary for safe registration
- **Dependencies / risks**: API stability and guardrails around third-party layout code.

### 14) Simulation-rich office world

- **User value**: Stronger game feel (dynamic events, ambient interactions, room states).
- **Implementation surface**:
  - `src/scenes/OfficeScene.ts`
  - `src/entities/`
  - `src/config/` (simulation toggles/settings)
- **Dependencies / risks**: Performance and visual noise in the main productivity loop.

### 15) Unified timeline and replay of agent work

- **User value**: Postmortem-friendly history across messages, tools, and session transitions.
- **Implementation surface**:
  - `electron/terminal/server.ts` (event aggregation)
  - `src/ui/TerminalOverlay.ts`
  - `src/layouts/default/DefaultDashboard.ts`
- **Dependencies / risks**: Data volume and retention policy for long-running projects.

### 16) Multi-user shared office mode

- **User value**: Collaborative planning where multiple humans coordinate agents in one workspace.
- **Implementation surface**:
  - networking/session sync layer (new)
  - conflict handling around office/agent state
  - presence UI across scenes/dashboard
- **Dependencies / risks**: Major architecture expansion and synchronization complexity.

## Cross-cutting enablers

These make many roadmap items safer:

1. **Diagnostics-first telemetry**
   - Structured event IDs/reasons for state transitions and failures
2. **Scenario-based regression suite**
   - Focus on meeting/fleet and office-switch edge cases
3. **Explicit compatibility contracts**
   - Clear protocol/version boundaries for renderer/main/server components

## Suggested sequencing

1. **Now batch**: #1, #2, #5, #6
2. **Now/Next bridge**: #3, #4, #7
3. **Next batch**: #8, #9, #10, #11
4. **Later exploration tracks**: #13, #15 (platform depth), #14, #16 (product expansion)

## Proposed next action

Select 3-5 items from **Now** and convert them into implementation-ready issues with:

- acceptance criteria
- impacted modules
- risk notes
- test strategy
