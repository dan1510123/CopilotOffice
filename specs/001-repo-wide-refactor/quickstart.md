# Quickstart: Repository-Wide Refactor Program

## 1. Establish Slice Backlog

1. Partition repository work into bounded RefactorSlice entries.
2. Mark each slice as `parity_preserving` or `behavior_altering`.
3. Define scope-in/scope-out and rollback strategy for each slice.
4. For terminal/session slices, review `C:\Users\danielluo\repos\agency-cowork-main` and capture
   which PTY/preload patterns will be adapted.

## 2. Prioritize and Sequence

1. Schedule P1 critical runtime slices first (scene, input, terminal/session/fleet paths).
2. Add dependency links and block conditions.
3. Confirm every scheduled slice has explicit acceptance criteria.

## 3. Execute Slice Delivery

1. Implement only within the slice boundary.
2. Run parity checks for affected critical flows.
3. If parity fails, apply rollback strategy or keep slice blocked.

## 4. Handle Behavior Changes

1. For `behavior_altering` slices, create an ApprovalRecord before completion.
2. Do not mark complete until user approval is recorded.
3. Document approved behavior changes in feature artifacts.

## 5. Validate and Release

1. Run build and automated test workflows for impacted areas.
2. Confirm parity across default office and fleet/meeting paths when touched.
3. Merge only when slice acceptance and governance criteria are satisfied.

## 6. Governance Handoff

1. Capture final boundary and review rules for future features.
2. Ensure post-refactor documentation reflects new ownership boundaries.


## Walkthrough Validation (T075, 2026-06-04)

End-to-end walkthrough of the playbook against the final state of the program:

| Step | Outcome |
|------|---------|
| 1. Slice backlog | 12 slices authored under `slices/` (S1-A..E, S2-A..G), each with classification, scope, acceptance criteria, and rollback. |
| 2. Prioritize + sequence | P1 (S1-*) delivered as MVP first, then P2 (S2-*). Slice dependencies (S1-C+D paired ship, S1-E after S1-D) honored — see `tracking/progress.md`. |
| 3. Execute | Each slice landed as its own commit with parity checks recorded in the slice's `Validation Runs` table. Build + test green for every commit. |
| 4. Behavior-altering handling | None proposed during the program — all slices stayed `parity_preserving`. `tracking/approvals.md` is empty by design. |
| 5. Validate + release | Final validation captured in `tracking/progress.md` → Final Validation. |
| 6. Governance handoff | `governance/handoff.md` + `governance/boundaries.md` produced. Constitution untouched (no amendments required). |

Playbook confirmed accurate; no edits needed to steps 1–6.