# Status Presentation Contract

**Feature**: 014-agent-status-revamp | **Date**: 2026-07-09

This is the internal contract every status surface MUST honor. There is no network/API surface;
the "contract" is the shared module interface plus per-surface obligations.

## Module: `src/config/agentStatusPresentation.ts`

```ts
export type StatusKey =
  | 'slacking' | 'starting' | 'ready' | 'done' | 'waiting' | 'thinking' | 'error';

export interface StatusPresentation {
  key: StatusKey;
  label: string;        // canonical name, identical across surfaces
  shortLabel: string;
  colorHex: string;     // DOM
  colorNum: number;     // Phaser fill
  strokeNum: number;    // Phaser badge stroke
  icon: string;         // single canonical icon shared by ALL surfaces
  badgeAnimation: 'none' | 'pulse';
  isActive: boolean;    // eligible for live timer + stall
}

export const STATUS_PRESENTATION: Record<StatusKey, StatusPresentation>;

export const STALL_THRESHOLD_MS = 60_000;

export interface StallInfo {
  isStalled: boolean;
  stallColorHex: string;
  stallColorNum: number;
}

export function resolveStatusKey(status: AgentStatus | undefined): StatusKey;
export function computeStall(status: AgentStatus | undefined, now?: number): StallInfo;
export function describeActivity(status: AgentStatus | undefined): string;
export function formatElapsedMmSs(startTime: number | null, now?: number): string; // "0:07", "1:23"
```

### Canonical presentation table (target values)

| key | label | icon | colorHex | animation | isActive |
|-----|-------|------|----------|-----------|----------|
| `slacking` | Slacking | 💤 | `#555555` | none | false |
| `starting` | Starting… | 🚀 | `#ff9944` | pulse | true |
| `ready` | Ready | 📭 | `#ffffff` | none | false |
| `done` | Done | 📬 | `#4a78ff` | none | false |
| `waiting` | Waiting for input | ⏳ | `#ffb86c` | none | true |
| `thinking` | Thinking | 🧠 | `#50fa7b` | pulse | true |
| `error` | Error | ❌ | `#ff4444` | none | false |

> Resolves the current 🧠-vs-⚡ drift: **🧠 is canonical** for `thinking` on every surface.

## Per-surface obligations

### Sprite badge — `src/entities/NPC.ts`
- MUST derive color/stroke/icon/animation from `STATUS_PRESENTATION[resolveStatusKey(status)]`; DELETE local `BADGE_COLORS` + icon map.
- MUST apply the stall modifier from `computeStall` (amber + altered pulse) when `isStalled`, cleanly replacing the normal pulse tween (no orphaned tweens).
- MUST hide badge/text when key is `slacking` (existing behavior).

### Default dashboard — `src/layouts/default/DefaultDashboard.ts`
- MUST replace the inline `switch` with `STATUS_PRESENTATION[resolveStatusKey(status)]` for dot color, label, icon.
- Primary label MUST be the canonical `label` only (e.g. `"Thinking"`), NEVER `Thinking: <detail>`.
- Activity detail (from `describeActivity`) MUST render on a fixed-height/truncated line or as a `title` tooltip — MUST NOT change card height.
- Card MUST keep a fixed `min-height`; live timer element carries `data-elapsed-agent` and the stall class past threshold.

### Fleet dashboard — `src/layouts/fleet/FleetDashboard.ts`
- MUST apply the identical treatment as the Default dashboard (parity is a Constitution gate).

### Notifications — `src/ui/NotificationService.ts`
- MUST use `STATUS_PRESENTATION[key].label` and `.icon` (and color where colored) for any status-derived notification — no bespoke wording/coloring per state.

### Derivation / main — `src/main.ts`
- `formatElapsed` → mm:ss (`formatElapsedMmSs`) for active states.
- Turn-end with no remaining tools MUST settle off `thinking`/`starting` (no stuck in-progress).
- Completions for unknown `toolId` MUST be ignored (idempotent, out-of-order safe).
- `clearCompletionAck(agentId)` MUST be invoked from all focus paths: terminal open, dashboard card select, in-world interact.
- Office switch MUST show fresh status (via existing `reconnectAgentStatuses()`), asserted by test.

## Test obligations (contract-level)

1. `STATUS_PRESENTATION` has a record for every `StatusKey` and every value `resolveStatusKey` can return (completeness).
2. `resolveStatusKey` folds `ready + completionPendingAck` → `done`; `ready` alone → `ready`.
3. `computeStall` flips at exactly `STALL_THRESHOLD_MS` and clears when active state ends.
4. `ask_user` waiting is preserved when an unrelated tool completes concurrently (via `toolStatus.ts`).
5. Duplicate/out-of-order tool completion does not corrupt the resolved key.
6. `formatElapsedMmSs` renders `m:ss` correctly across boundaries (0:07, 0:59, 1:00, 12:05).
7. No surface references a status color/label/icon literal outside `STATUS_PRESENTATION` (grep guard / review).
