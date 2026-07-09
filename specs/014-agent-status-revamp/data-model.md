# Phase 1 Data Model: Agent Status Tracking Revamp

**Feature**: 014-agent-status-revamp | **Date**: 2026-07-09

No persistence or schema changes. This documents the in-memory entities the feature reads and
the new presentation entity it introduces.

## Entity: AgentStatus (existing — consumed, not reshaped)

Defined in `src/office/officeManager.ts`. Fields relevant to this feature:

| Field | Type | Use in this feature |
|-------|------|---------------------|
| `state` | `'slacking' \| 'active'` | Base slacking vs active split |
| `subState` | `'starting' \| 'ready' \| 'waiting' \| 'thinking' \| 'error' \| null` | Primary status key input |
| `completionPendingAck` | `boolean?` | Folds `ready` → `done` when true; cleared on any focus |
| `thinkingDetail` | `string \| null` | Activity detail (shown truncated / tooltip, NOT in the primary label) |
| `currentTool` | `string \| null` | Fallback activity source |
| `activityStartTime` | `number \| null` | Live mm:ss timer + stall detection input |
| `unreadCount` | `number` | Existing unread badge (unchanged) |
| `recentActions` | `RecentAction[]` | Existing activity log (unchanged) |

**Invariant (retained)**: `subState === null` iff `state === 'slacking'`. This feature does not add
or remove substates; `VALID_TRANSITIONS` is unchanged.

## Entity: StatusPresentation (NEW)

The canonical, surface-agnostic description of how a resolved status looks. Lives in
`src/config/agentStatusPresentation.ts`. One record per **presentation key**.

**Presentation keys** (derived, superset of substates): `slacking`, `starting`, `ready`, `done`, `waiting`, `thinking`, `error`.

| Field | Type | Notes |
|-------|------|-------|
| `key` | `StatusKey` | One of the presentation keys above |
| `label` | `string` | Canonical human name, e.g. `"Thinking"`, `"Waiting for input"`, `"Done"` |
| `shortLabel` | `string` | Optional compact form for tight surfaces |
| `colorHex` | `string` | DOM color, e.g. `"#50fa7b"` |
| `colorNum` | `number` | Phaser fill color, e.g. `0x50fa7b` |
| `strokeNum` | `number` | Phaser badge stroke color |
| `icon` | `string` | Single canonical icon/emoji shared by all surfaces |
| `badgeAnimation` | `'none' \| 'pulse'` | Badge motion for this key |
| `isActive` | `boolean` | True for in-progress keys (`starting`,`thinking`,`waiting`) → eligible for timer + stall |

**Completeness invariant**: every value the `resolveStatusKey` function can return MUST have a
`StatusPresentation` record (enforced by a unit test).

## Entity: StallModifier (NEW — derived, not stored)

Not a state; a computed decoration applied on top of an active `StatusPresentation`.

| Field | Type | Notes |
|-------|------|-------|
| `isStalled` | `boolean` | `isActive && (Date.now() - activityStartTime) >= STALL_THRESHOLD_MS` |
| `stallColorHex` / `stallColorNum` | color | Amber treatment applied over the base active color |
| `stallAnimation` | `'altered-pulse'` | Distinct from normal pulse and from error |

`STALL_THRESHOLD_MS = 60_000` (Clarification Q2). Cleared automatically when the agent leaves the
active state or `activityStartTime` resets on a new activity.

## Function contract: resolveStatusKey

```
resolveStatusKey(status: AgentStatus | undefined): StatusKey
```

Rules (single source of truth, replacing three inline `switch` blocks):

1. `!status || state === 'slacking'` → `'slacking'`.
2. `subState === 'ready' && completionPendingAck` → `'done'`; else `subState === 'ready'` → `'ready'`.
3. `subState === 'waiting'` → `'waiting'` (MUST win over concurrent tool completion via the existing `ask_user` guard upstream).
4. `subState === 'thinking' | 'starting' | 'error'` → same key.
5. `subState === null` (defensive) → `'slacking'`.

Stall is computed separately via `computeStall(status)` so the base key stays stable.

## Activity description resolution

`describeActivity(status): string` → `thinkingDetail ?? friendlyName(currentTool) ?? 'Working…'`.
Used only for the truncated detail line / tooltip — never concatenated into the primary label.

## Thresholds / constants (new, centralized)

| Constant | Value | Purpose |
|----------|-------|---------|
| `STALL_THRESHOLD_MS` | `60_000` | Possible-stall signal (FR-013) |
| `STATUS_DELAY_TARGET_MS` | `1_000` | Bounded-delay target for tests (SC-005) |
| `ELAPSED_TICK_MS` | `1_000` | Existing live-timer tick (reused) |

## State/render lifecycle (unchanged wiring, new consumers)

```
tool/turn events ──► main.ts status update ──► OfficeManager.setAgent* ──► agent:status:changed
                                   │                                            │
                         nextSubStateAfterToolComplete                 ┌────────┴─────────┐
                         (ask_user race-guard)                         ▼        ▼         ▼
                                                                 NPC badge  Dashboards  Notifications
                                                                     └──── all call resolveStatusKey + STATUS_PRESENTATION ────┘
```
