# Approval Record Log

Captures explicit user approval for `behavior_altering` slices per FR-011 and FR-012.

Schema matches `data-model.md` → `ApprovalRecord` entity.

| approval_id | slice_id | requested_change | approval_state | approved_by | approved_at |
|-------------|----------|------------------|----------------|-------------|-------------|
| _(none yet)_ | | | | | |

## States

- **pending**: Change proposed, awaiting user decision.
- **approved**: User explicitly approved; slice may proceed to `complete`.
- **rejected**: User declined; slice MUST flip classification back to `parity_preserving` or be removed.

## Rules

- A slice classified `behavior_altering` MUST have an `approved` record before its status moves to
  `complete` (per `data-model.md` guard conditions and FR-011).
- Approval is recorded by the user, not the implementer.
- Each approval entry links to the requesting slice file in `specs/001-repo-wide-refactor/slices/`.
- If no behavior changes are proposed during the program, this log remains empty and that is the
  expected, parity-preserving outcome.
