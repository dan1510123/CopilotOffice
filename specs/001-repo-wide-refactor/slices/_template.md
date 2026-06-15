# Slice: <slice_id> — <name>

> Instantiate one copy of this template per slice in `specs/001-repo-wide-refactor/slices/`.
> File name should be `<slice_id>-<short-name>.md` (e.g. `S1-A-input-focus.md`).

## Identity

- **slice_id**: `<S?-?>`
- **name**: `<human-readable title>`
- **domain**: `scene | input | ui | office | layout | meeting | terminal | config | test`
- **owner**: `<owner>`
- **status**: `proposed | planned | in_progress | blocked | complete | rolled_back`

## Classification

- **classification**: `parity_preserving | behavior_altering`
- **approval_record**: `<approval_id or N/A>` *(required if behavior_altering)*

## Scope

### scope_in

- `<path or responsibility>`

### scope_out

- `<explicit exclusion>`

## Behavior Baseline

- **baseline_id**: `<baseline_id>`
- **critical_flows**: `<flows from baselines/critical-flows.md>`
- **parity_checks**: `<which checks from baselines/parity-harness.md>`

## Acceptance Criteria

- [ ] `<testable behavior expectation>`

## Dependencies

- Depends on: `<slice_id list>`
- Blocks: `<slice_id list>`

## Rollback Strategy

`<steps to contain or revert this slice if parity fails>`

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
|        |       |      |     |       |

## Notes

`<implementation notes, decisions, references to agency-cowork-notes.md>`
