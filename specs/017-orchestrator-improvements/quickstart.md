# Quickstart: Orchestrator Improvements (spec 017)

How to build, run, and validate US1–US8. This feature extends the spec-016 orchestrator;
nothing here introduces a new run mode.

## Build & typecheck

```powershell
Set-Location C:\Users\danielluo\repos\CopilotOffice
npx tsc --noEmit          # strict typecheck across electron/ + src/
npm run build             # rebuilds dist/game.bundle.js + dist/electron/*.js
```

> **Principle VII (worktree-aware):** verify you launch the bundle you just built.
> Confirm a distinctive new marker (e.g. a new tool name) is present in the running bundle:
> `Select-String -Path dist\game.bundle.js -Pattern 'get_active_agents'` and compare
> `dist/` timestamps before trusting a "fixed" report.

## Run

```powershell
npm start                 # or the app's usual launch script
```

Open the orchestrator from its focused panel/overlay as in spec 016.

## Manual validation by user story

### US1 — Persistent, fully-rendered transcript
1. Drive a few turns in the panel; bring the orchestrator online in Teams; from the Teams
   thread drive one more turn while the desktop overlay is **minimized**.
2. Reopen the panel → the full transcript is replayed in order, with the Teams turn visibly
   marked as Teams-origin, WITHOUT asking the agent to recall it (SC-001).
3. Quit and relaunch the app; open the panel → the prior conversation is restored (SC-002).
4. Click the red ✕ to close, then reopen → a fresh, clean transcript (FR-005).
5. Confirm the TUI is view-only (typing into it does nothing; only the textbox accepts
   input), Page Up/Down scrolls history, and it uses the green "hacker" theme (FR-003a).

### US2 — Status roll-up (all offices)
- With agents in at least one `done`, one `waiting`, one `thinking` state (in ≥2 offices),
  ask "what's everyone working on?" → one `get_active_agents` call lists every agent with
  office, status, activity, and time-in-state; no state omitted; labels match the in-world
  badges/dashboards (SC-003, FR-008/009/013).

### US3 — Who needs me
- Put one agent into `waiting`; ask "who's stuck?" → only waiting agents listed, longest
  first, with pending question (SC-004, FR-010).

### US4 — Unblock a waiting agent (gated)
- Ask the orchestrator to answer the waiting agent → approve the gate → the answer reaches
  the agent and it resumes; deny → nothing sent; target not actually waiting → `not-waiting`
  (US4 scenarios; FR-014/018/019).

### US5 — Send follow-up prompt (gated)
- Ask to send a follow-up to an online agent → approve → agent starts on it; offline target →
  `not-online` (FR-015).

### US6 — Stop / restart (gated)
- Stop, then restart an online agent via approvals; deny → no change; invalid/offline target →
  typed outcome (FR-016).

### US7 — Peek recent output (read-only)
- Ask "what did agent X just do?" → bounded recent output returned; no gate; agent with no
  recent output → "nothing recent" (FR-011/012).

### US8 — Agent online in Teams (gated)
- With Teams enabled, ask to bring a named agent online in Teams → approve → its Teams remote
  activates and a thread link is reported; take offline → closing notice posted; Teams
  disabled → `unavailable` (FR-017/022).

## Automated tests

```powershell
# Orchestrator + Teams unit suites (existing 204 tests MUST stay green + new ones)
npx vitest run tests/unit/orchestrator
npx vitest run tests/unit/teams

# e2e reopen-shows-history smoke (extend existing e2e)
npx playwright test tests/e2e
```

New unit coverage to add:
- `orchestratorTranscriptStore` — serialize/deserialize, bounded-window trim, origin
  fidelity, malformed-input tolerance, close/restore lifecycle.
- Each new tool's outcomes — success + `not-online`/`not-waiting`/`invalid-target`/
  `unavailable`/`denied`/`failed`, plus the orchestrator-identity guard.
- Permission-gate coverage for every act-on tool (non-YOLO) + minimized/Teams-relay parity.
- Status/awaiting/peek roll-ups derive from `agentStatusPresentation` and span all offices.

## Definition of done (spec alignment)
- All FR-001..FR-025 satisfied; SC-001..SC-009 demonstrable.
- `npx tsc --noEmit` + `npm run build` clean; existing + new vitest green; e2e smoke passing.
- No `activeAgentViewers` mutation outside sanctioned helpers; no new in-canvas renderer;
  status labels never diverge from the canonical presentation.
