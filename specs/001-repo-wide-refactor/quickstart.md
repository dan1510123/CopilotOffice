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
