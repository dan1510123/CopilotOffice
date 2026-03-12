---
applyTo: "src/config/**"
---

# Config Directory — Static Configuration & Constants

## Purpose

Pure data, constants, and type definitions used across the app. **No runtime logic,
no rendering, no side effects.** Files here are imported by scenes, entities, and UI
modules but never import from them.

## agents.ts — Agent Definitions

Exports the `AgentConfig` interface and `AGENTS` array. Each agent has:
- `id` — unique string identifier (used in IPC, status tracking, JSON plans)
- `name` — display name, `skill` — Copilot skill to route messages to
- `sprite` — key matching a procedurally generated sprite in BootScene
- `color` — hex number (e.g. `0x4488cc`) for sprite generation
- `position` — `{ x, y }` grid coordinates (col, row) matching chair positions in the office layout
- `greeting` — message shown on interaction, `description` — short role label
- `workingDir` — optional custom working directory for the CLI session

**Active agents (4):** Gene (generalist, blue), Arthur (architect, dark), Dan (debugger, green), Alice (admin, pink).
**Reserve agents (6):** Azure, Validator, Deployer, Doctor, Scout, Accountant — sprites already generated in BootScene; just add an entry to `AGENTS` to activate.

When adding an agent: pick a unique color, choose a non-overlapping grid position,
and ensure the sprite key exists in BootScene's generation block.

## depths.ts — Phaser Depth Layer Constants

`Depths` object defines z-ordering layers for all game objects:

| Constant | Value | Used for |
|----------|-------|----------|
| BACKGROUND | -10 | Floor tiles, background fill |
| FLOOR_DETAIL | 0 | Welcome mat, floor decorations |
| WALLS | 1 | Wall tiles, windows, door |
| NPC_EFFECTS | 9 | Highlight rings/glow (just below sortable) |
| SORTABLE_BASE | 10 | Start of y-sorted depth range |
| SORTABLE_RANGE | 40 | Range for y-sorting (10–50) |
| NPC_LABELS | 55 | Name/description labels |
| BADGES | 60 | Status badges, session text |
| UI_OVERLAY | 100 | Prompts, instruction text |
| ZOOM_BAR | 150 | Camera zoom slider bar |
| MINI_GAMES | 200 | Pong, Basketball containers |
| DIALOG | 1000 | Dialog box (deprecated) |

`ySortDepth(y, worldHeight)` maps a y-coordinate into the sortable range for dynamic depth.

## playerCustomization.ts — Player Appearance

Defines player sprite color customization with persistence.

- **`PlayerColors` interface** — six color regions: `hair`, `skin`, `suit`, `tie`, `pants`, `shoes` (all `number` hex values).
- **`DEFAULT_PLAYER_COLORS`** — default palette (dark brown hair, light peach skin, navy suit, red tie, dark pants, black shoes).
- **`COLOR_REGION_LABELS`** — human-readable labels for each region (e.g. `suit` → `'Jacket'`).
- **`PLAYER_COLOR_PRESETS`** — per-region arrays of preset hex colors (8–10 swatches each) for the customization UI.
- **`loadPlayerColors()`** — loads from `localStorage` key `agencyOffice:playerColors`, merges with defaults for forward compatibility.
- **`savePlayerColors(colors)`** — persists to `localStorage`.
- **`resetPlayerColors()`** — removes saved colors and returns defaults.

## notifications.ts — Notification Settings

Defines event types: `turnEnd`, `askUser`, `turnStart`, `toolStart`, `toolComplete`,
`sessionReady`, `sessionError`. Each has per-event config: `enabled`, `toast`,
`osNotification`, `message` (supports `{agent}` and `{tool}` placeholders).
Deduplication window defaults to 3000 ms. Settings load/save to localStorage
key `copilot-notification-settings`, merging with defaults for forward compatibility.

## meetingPrompt.ts — Meeting Coordinator Prompt

`generateMeetingPrompt(agents, userTask?)` builds the system prompt for Arthur's
meeting mode. Uses the `AgentConfig` type from agents.ts. Outputs a structured
JSON plan format with `agentId`, `title`, `description`, and `prompt` per task.

## Key Rules

- **Pure data only** — no side effects, no imports of runtime/rendering modules.
- Always use `Depths.*` constants — never hardcode depth numbers.
- Agent positions are **grid coordinates**, not pixel positions.
- Reserve agents have pre-generated sprites — activate by adding to `AGENTS`.
- When changing depth layers, update `depths.ts` **and** all consumer call sites.
