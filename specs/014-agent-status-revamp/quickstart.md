# Quickstart: Verifying the Agent Status Revamp

**Feature**: 014-agent-status-revamp | **Date**: 2026-07-09

How to build, run, and verify the revamp against the spec's success criteria.

## Build & run

```powershell
npm run build      # build game + electron
npm start          # launch the app
```

## Unit / integration tests

```powershell
npm run test       # includes agentStatusPresentation.test.ts + toolStatus.test.ts
```

Focused run while iterating:

```powershell
npx vitest run tests/unit/config/agentStatusPresentation.test.ts tests/unit/util/toolStatus.test.ts
```

## End-to-end (boot + office switch + badge parity)

```powershell
npm run test:e2e
```

## Manual verification checklist (maps to Success Criteria)

1. **Consistency (SC-003, FR-007/009)** — Trigger each state on an agent and confirm the sprite
   badge and the dashboard card show the **same** name, color, and icon. Specifically confirm
   `thinking` shows 🧠 on BOTH (regression: it used to be ⚡ on the dashboard).
2. **No stuck states (SC-001, FR-002)** — Give an agent a task; when it finishes, confirm within
   ~1s no surface still says "Thinking"/"Starting"; it settles to Done then Ready.
3. **Done vs Ready + clear-on-focus (FR-008/010, Q1)** — Let an agent finish while not viewing it →
   shows "Done" (📬, blue) everywhere. Then (a) open its terminal, (b) on another finished agent
   select its dashboard card, (c) on a third walk up and press E — each independently clears Done → Ready.
4. **ask_user race (SC-004, FR-003)** — Put an agent into `ask_user` waiting while another tool
   completes in the same moment; confirm it stays "Waiting for input", never flips to Thinking/Ready.
5. **Live timer (FR-012, Q3)** — While an agent is active, confirm a ticking `m:ss` timer on the card.
6. **Stall signal (SC-007, FR-013, Q2/Q4)** — Keep an agent in one active state ~60s with no
   progress; confirm the badge/card shows the distinct amber/altered-pulse stall treatment (not the
   red error look), and that it clears when activity resumes.
7. **Fixed card height (SC-009, FR-011/015)** — Cycle an agent through states incl. a long
   activity detail; confirm the card height never changes and the dashboard does not reflow; the
   label stays the concise state name with detail in the truncated line/tooltip.
8. **Office-switch freshness (FR-006)** — Switch offices and back; confirm each agent shows its
   current true state, not a stale snapshot.
9. **Fleet parity** — Repeat 1–7 in a fleet-vteam office; behavior must match the default office.
10. **Notifications (FR-007, Q5)** — Trigger a status notification; confirm its wording/icon match
    the canonical presentation.

## Definition of done

- All manual checks pass in both default and fleet offices.
- `npm run test` and `npm run test:e2e` green.
- No status color/label/icon literal remains outside `src/config/agentStatusPresentation.ts`
  (grep the four surfaces).
