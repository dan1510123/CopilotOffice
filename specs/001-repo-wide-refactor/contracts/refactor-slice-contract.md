# Contract: Refactor Slice Delivery

## Purpose

Define the required contract for each refactor slice so maintainers can review progress and
enforce behavior parity and approval gates consistently.

## Required Slice Contract Fields

1. `slice_id`: Unique identifier.
2. `name`: Human-readable slice title.
3. `domain`: Primary domain surface.
4. `scope_in`: Explicit included paths/responsibilities.
5. `scope_out`: Explicit exclusions.
6. `classification`: `parity_preserving` or `behavior_altering`.
7. `acceptance_criteria`: Testable behavior expectations.
8. `parity_checks`: Validation checks for impacted critical flows.
9. `rollback_strategy`: Steps for containment/reversion.
10. `dependencies`: Upstream/downstream slice references.
11. `approval_record`: Required when classification is behavior-altering.

## Validation Rules

- A slice is invalid if any required field is missing.
- A behavior-altering slice is invalid without explicit approval.
- A parity-preserving slice is invalid if parity checks are absent or failing.
- A slice cannot close while declared dependencies are incomplete unless an approved override is logged.

## Completion Criteria

A slice is considered complete only when:

1. Scope boundary is met without untracked spillover.
2. Required parity checks pass for impacted flows.
3. Approval record exists for behavior-altering slices.
4. Documentation updates are included where boundaries or workflows changed.
