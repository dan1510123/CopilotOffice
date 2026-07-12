# Quickstart: Resolve ask_user Prompts via Teams Remote

**Feature**: `015-teams-ask-user-resolution` | **Date**: 2026-07-11

Setup + manual verification for surfacing an `ask_user` question in a bound Teams thread
and resolving it from Teams. Builds directly on the Teams Remote Agents feature (spec
011) — channel config, thread binding, self-marker, filtering, dispatch queue, and
chunked sending are all reused.

## Prerequisites

- Spec 011 (Teams Remote Agents) working: Teams feature flag enabled, a default channel
  deep-link configured, `az` CLI signed in (Graph + ic3 tokens acquire non-interactively).
- An agent (e.g. Gene) that can be brought online and driven to an `ask_user` decision.
- Build tooling: `npm install`; TypeScript strict; Vitest (`npm run test`); Playwright
  (`npm run test:e2e`).

## Build & run

```powershell
npm install
npm run build          # rebuild main/preload/renderer bundles (per-worktree dist/ — constitution VII)
npm start
```

> **Worktree note (constitution VII)**: verify you launch the rebuilt `dist/`. Confirm a
> distinctive new marker from this feature (e.g. a `copilot-ask-user` string) is present
> in the bundle you run before concluding "it works".

## Manual verification (maps to acceptance scenarios)

1. **See the question (US1 / SC-001)**
   - Bring Gene online in Teams; confirm a bound thread exists.
   - Drive Gene to an `ask_user` with options (e.g. "Which database? PostgreSQL /
     MySQL / SQLite").
   - **Expect**: one thread message, framed as needing an answer (distinct from ordinary
     replies), showing the question and every option with a stable label
     (`A — PostgreSQL`, `B — MySQL`, `C — SQLite`), plus a freeform hint iff freeform is
     allowed.

2. **Answer by label (US1 / SC-002/003)**
   - Reply `B` in the thread.
   - **Expect**: Gene continues as if MySQL was selected; the CopilotOffice terminal
     shows the same choice exactly once (no duplicate/divergent submission).

3. **Answer locally, then stale Teams reply (US1 scenario 4 / FR-007/008)**
   - Trigger a new `ask_user`; answer it **in the app terminal**.
   - **Expect**: thread posts a short "answered in app" notice; a later Teams reply for
     that question does nothing (no re-submit, no corruption).

4. **Unmatched reply — choices-only (US2 / FR-005 / SC-005)**
   - With a choices-only question pending, reply `maybe`.
   - **Expect**: a nudge re-listing the options + labels; the question stays open; Gene
     stays paused.

5. **Unmatched reply — freeform (US2 / FR-006)**
   - With a freeform-allowed question pending, reply arbitrary text.
   - **Expect**: the text is submitted as the answer; Gene continues.

6. **Race — Teams vs local (US2 scenario 3 / SC-004)**
   - Answer from Teams and locally at nearly the same time.
   - **Expect**: exactly one resolution applies; the loser is a no-op.

7. **Abandonment (FR-009)**
   - With a question pending, take Gene offline (or end the session).
   - **Expect**: a "no longer answerable" notice; later thread replies are ignored.

8. **Non-regression (FR-016)**
   - Ordinary Teams prompts still route and reply normally; other tool activity,
     turn-start/end, and the local ask_user waiting-state indicator are unchanged.

## Automated tests

```powershell
npm run test        # unit + integration (Vitest): server extractor, relay fan-out,
                    # gateway mapping, question posting, label/freeform/nudge matching,
                    # single-resolution race, abandonment, self-loop, dispatch ordering
npm run test:e2e    # Playwright (only if a UI-observable path is added; none required here)
```

Key targeted suites (see contracts): payload-relay contract tests
(`contracts/events-ipc.md`) and question/answer flow tests
(`contracts/question-answer-flow.md`).

## Runtime spike — COMPLETED (research Decision 1)

The answer-submission mechanism was **verified by a spike** against the real bundled CLI
(`@github/copilot-1.0.71`) + SDK (`@github/copilot-sdk@1.0.5`). Result: for the
SDK/ui-server backend, `ask_user` is the SDK **user-input interaction** — the session must
register `onUserInputRequest` (or the model refuses the tool), and a Teams answer resolves
it via `handlePendingUserInput(requestId, {answer, wasFreeform})` (the handler promise may
be resolved **late**). The node-pty fallback uses keystroke injection. Both hide behind
`gateway.submitAnswer(officeId, agentId, {requestId?, answer, wasFreeform})`. No further
spike is required; implement per research Decision 1 and `contracts/events-ipc.md` §0/§5.
