# Phase 0 Research: Agent Status Tracking Revamp

**Feature**: 014-agent-status-revamp | **Date**: 2026-07-09

Renderer-only audit of the current status system. No unknown external tech — this is an
internal consistency/reliability revamp, so "research" is a current-state audit plus fixed
design decisions.

## Current state model (retained as-is)

- `AgentState = 'slacking' | 'active'` and `ActiveSubState = 'starting' | 'ready' | 'waiting' | 'thinking' | 'error'` (`src/office/officeManager.ts`).
- Derived `done` = `subState === 'ready' && completionPendingAck` (not a real substate).
- `VALID_TRANSITIONS` enforces legal moves and logs warnings otherwise. **Unchanged by this feature.**
- Rich per-agent fields already exist: `thinkingDetail`, `currentTool`, `completionPendingAck`, `unreadCount`, `lastEvent`, `activityStartTime`, `lastCompletedAction`, `recentActions[]`, `taskSummary`.

## Surfaces that show status (must become consistent)

| Surface | File | Today |
|---------|------|-------|
| Sprite badge | `src/entities/NPC.ts` | `BADGE_COLORS` map + icon map; **thinking icon = 🧠**; pulse on `thinking`/`starting` |
| Default dashboard | `src/layouts/default/DefaultDashboard.ts` | inline `switch` builds `statusDot`/`statusLabel`/`statusIcon`; **thinking icon = ⚡**; `Thinking: <detail>` grows card |
| Fleet dashboard | `src/layouts/fleet/FleetDashboard.ts` | near-duplicate inline `switch` of the same logic |
| Notifications | `src/ui/NotificationService.ts` | builds its own text; not aligned to badge/dashboard naming |

### Confirmed inconsistencies (the bug surface this feature fixes)

1. **Thinking icon drift**: 🧠 on the badge vs ⚡ on dashboards for the same state. (FR-007/FR-009)
2. **Label drift risk**: three independent `switch` blocks that must be hand-kept in sync (Default, Fleet, and the badge icon map) — a proven regression vector.
3. **`Thinking: <detail>` card growth**: the default/fleet dashboards append `thinkingDetail` into the label, changing card height and reflowing the dashboard. (FR-011/FR-015)
4. **Notification naming** is independent of the canonical state names. (FR-007)

## Reliability / accuracy findings

- **ask_user race-guard already exists** in `src/util/toolStatus.ts` (`nextSubStateAfterToolComplete` + `isAskUserTool`) and is used from `main.ts` (~line 2037). Decision: keep it as the canonical reducer and make **every** surface derive from the same resolved status so the guard can't be bypassed on one surface.
- **Stale in-progress states**: turn-end must force resolution off `thinking`/`starting`. `main.ts` already recomputes on tool completion; add an explicit "no tools remain + turn ended → settle" path so nothing stays stuck (FR-002).
- **Duplicate / out-of-order events**: the tool set keyed by `toolId` should make completions idempotent; a completion for an unknown `toolId` must be ignored rather than corrupting state (FR-004). Verify and add guard + tests.
- **Office-switch freshness**: `reconnectAgentStatuses()` (`main.ts` ~2404) already re-hydrates on switch. Gap = no regression test asserting no stale snapshot after switch (FR-006).
- **Live timer infra exists**: `ELAPSED_TICK_MS = 1000` interval (`main.ts` ~2447) updates `[data-elapsed-agent]` DOM text without a full re-render. Reuse for the live mm:ss timer and stall class toggle (no reflow).

## Fixed design decisions

| Topic | Decision | Rationale / Source |
|-------|----------|--------------------|
| State model | Unchanged | Spec scope: presentation + reliability only |
| Canonical mapping | New `src/config/agentStatusPresentation.ts` consumed by all 4 surfaces | Principle V (config-first); kills drift |
| Stall threshold | `STALL_THRESHOLD_MS = 60_000` | Clarification Q2 |
| Stall visual | Modifier on existing active state (amber + altered pulse), not a new state | Clarification Q4; keeps state model intact |
| Elapsed display | Live mm:ss timer while active | Clarification Q3; change `formatElapsed` |
| Done clears on | Any focus: terminal open, card select, in-world interact → one `clearCompletionAck` | Clarification Q1 |
| Notifications | Consume canonical names/icons/colors | Clarification Q5 |
| Card height | Fixed; concise label; detail via truncated line/tooltip | User request + FR-011/FR-015 |

## Alternatives considered

- **Add a real `stalled` substate** — rejected: expands the state model (out of scope) and complicates `VALID_TRANSITIONS`. A derived modifier is sufficient and reversible.
- **Per-surface presentation tables** (status quo) — rejected: this is exactly the drift source (proven by the 🧠/⚡ mismatch).
- **Coarse elapsed buckets** — rejected in favor of live mm:ss per Clarification Q3.

## Open risks

- Fleet dashboard parity: any change to Default must mirror to Fleet in the same change (Constitution delivery gate).
- Badge pulse tween interaction: stall modifier must reuse/replace the existing pulse tween cleanly (avoid orphaned tweens — `NPC.ts` already stops/nulls `badgePulseTween`).
