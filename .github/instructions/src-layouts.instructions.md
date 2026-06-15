---
applyTo: "src/layouts/**"
---

# Layouts — Dashboard & Click Handler System

## Purpose

The `src/layouts/` directory provides a pluggable layout system for the right-pane
agent dashboard. Each layout defines how agent cards are rendered and how clicks on
those cards are handled. The system supports multiple office types (default, fleet v-team)
with different visual styles and interaction models.

## Files

### `types.ts` — Shared Interfaces

Defines the core abstractions that all layouts implement:

- **`DashboardRenderContext`** — Context object passed to renderers. Contains:
  - `agents` — array of `AgentConfig` for the current office
  - `office` — current `OfficeData` (or null)
  - `selectedAgentId` — currently selected agent (or null)
  - `cachedSessionMeta` — session title metadata keyed by agent ID
  - `agentTools` — active tool stacks per agent
  - `formatElapsed(startTime)` — formats elapsed time from a start timestamp
  - `formatRelativeTime(timestamp)` — formats a timestamp as relative time (e.g., "2m ago")

- **`DashboardRenderer`** — Interface with a single method:
  - `renderCards(ctx: DashboardRenderContext): string` — returns HTML string for all agent cards

- **`CardClickHandler`** — Interface with two methods:
  - `handleCardClick(agentId, context)` — handles primary card click. Context provides `setSelectedAgent`, `clearUnread`, `updateContent`, `emitOpenTerminal`.
  - `handleMetaPanelClick(target, agentId, context)` — handles clicks on session metadata area. Context provides `startSessionMetaEdit`.

- **`LayoutDefinition`** — Composite type bundling a layout's components:
  - `agents: AgentConfig[]` — agent roster for this layout
  - `dashboard: DashboardRenderer` — card renderer
  - `clickHandler: CardClickHandler` — click behavior

Also re-exports `AgentConfig`, `AgentStatus`, `OfficeData`, `OfficeLayout` for convenience.

### `index.ts` — Layout Registry

Central registry mapping `OfficeLayout` types to `LayoutDefinition` objects:

- `'default'` → uses `AGENTS`, `defaultDashboard`, `defaultClickHandler`
- `'fleet-vteam'` → uses `FLEET_AGENTS`, `fleetDashboard`, `fleetClickHandler`

Exports `getLayout(layout: OfficeLayout): LayoutDefinition` which returns the matching
layout or falls back to `'default'` if not found.

### `default/DefaultDashboard.ts` — Default Office Cards

Full-featured agent card renderer for the main office layout. Each card includes:

- Agent avatar (32×34 scaled to 64×68), name, description, color badge
- Status indicator with dot + label + icon (slacking/starting/ready/waiting/thinking/error)
- Elapsed activity timer, tool queue badge
- Active tool pipeline with per-tool status
- Recent activity log (last 5 completed actions with relative timestamps)
- Task summary line
- Session metadata panel with editable title and edit button
- Unread message count badge (top-right, red)
- Selected/unselected visual states with distinct border and background colors

### `default/DefaultClickHandler.ts` — Default Click Behavior

Clicking any agent card: selects the agent, clears unread count, updates the dashboard,
and opens the terminal overlay for that agent. Clicking the session metadata area
starts inline title editing.

### `fleet/FleetDashboard.ts` — Fleet V-Team Cards

Compact agent card renderer for fleet offices. Differences from default:

- Smaller cards (48×51 avatar, reduced padding/margins)
- No session metadata panel (fleet agents don't have interactive terminals)
- Shorter activity log (last 3 actions vs. 5)
- Arthur (architect) gets a special `💬 Open Arthur's terminal` hint
- Non-pointer cursor for non-Arthur agents (read-only)

### `fleet/FleetClickHandler.ts` — Fleet Click Behavior

Most fleet agent cards are **read-only** (click is a no-op). Only Arthur (architect)
is clickable — clicking his card opens a terminal view. `handleMetaPanelClick` is
a complete no-op since fleet cards have no session metadata panel.

## How to Add a New Layout

1. Define a new value in `OfficeLayout` type in `src/office/officeManager.ts`.
2. Create a new directory under `src/layouts/` (e.g., `src/layouts/custom/`).
3. Implement `DashboardRenderer` — export an object with `renderCards(ctx)`.
4. Implement `CardClickHandler` — export an object with `handleCardClick()` and `handleMetaPanelClick()`.
5. Define the agent roster (new `AgentConfig[]` array or reuse existing).
6. Register the layout in `src/layouts/index.ts` by adding it to the `layouts` map.

## Key Rules

- **Pure HTML string output** — `renderCards()` returns an HTML string, not DOM nodes. The caller inserts it via `innerHTML`.
- **No direct DOM manipulation** — renderers must not create or modify DOM elements directly; they only produce markup.
- **Agent card `data-agent-id` attribute** — every card must include `data-agent-id="{id}"` for click delegation to work.
- **Click handlers receive context objects** — never import UI modules directly; use the provided context callbacks.
- **Fallback to default** — `getLayout()` falls back to the default layout for unknown layout types.

## Common Pitfalls

- **Missing `data-agent-id`** on card elements — click delegation silently fails.
- **Importing rendering logic into types.ts** — keep `types.ts` pure interfaces with no runtime code.
- **Forgetting to register in index.ts** — new layouts won't be discoverable by `getLayout()`.
- **Assuming terminal access in fleet layout** — fleet agents (except Arthur) have no terminal; don't render session controls for them.


## Post-Refactor (S2-B, 2026-06-04)

LayoutDefinition now carries a ehaviors: LayoutBehaviors field — declarative capability flags so scene code can ask the layout what it supports instead of string-comparing layout ids:

- `supportsReserveAgents` (default `true` / fleet `false`)
- `restrictsInteractionToArchitect` (default `false` / fleet `true`)
- `hasPlayerPcTerminal` (default `true` / fleet `false`)
- `supportsFleetExecution` (default `false` / fleet `true`)

Defaults are the most restrictive so a new layout that omits a flag can't accidentally inherit specialty behavior. Prefer `getLayout(id).behaviors.X` over `id === 'default' / 'fleet-vteam'` in new code.