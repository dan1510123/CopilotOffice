# Data Model: Repository-Wide Refactor Program

## Entity: RefactorSlice

**Purpose**: Smallest independently deliverable unit of refactor work.

**Fields**:
- `slice_id` (string, unique)
- `name` (string)
- `domain` (enum: scene, input, ui, office, layout, meeting, terminal, config, test)
- `scope_in` (list of paths/responsibilities)
- `scope_out` (list of explicit exclusions)
- `classification` (enum: parity_preserving, behavior_altering)
- `status` (enum: proposed, planned, in_progress, blocked, complete, rolled_back)
- `dependencies` (list of `slice_id`)
- `rollback_strategy` (text)
- `acceptance_criteria` (list)

**Validation Rules**:
- `classification` is required before implementation.
- `behavior_altering` requires a linked approval record before status may move to `complete`.
- `scope_in` and `scope_out` must both be non-empty.

## Entity: BehaviorBaseline

**Purpose**: Defines expected behavior parity target for a slice.

**Fields**:
- `baseline_id` (string, unique)
- `slice_id` (foreign key -> RefactorSlice)
- `critical_flows` (list: movement, interaction, terminal lifecycle, office switching, fleet/meeting lifecycle)
- `parity_checks` (list of executable checks)
- `result` (enum: pass, fail, partial)

**Validation Rules**:
- Every slice must map to exactly one baseline.
- `result` must be `pass` before completion unless slice is user-approved behavior change.

## Entity: ApprovalRecord

**Purpose**: Captures explicit user approval for intentional behavior changes.

**Fields**:
- `approval_id` (string, unique)
- `slice_id` (foreign key -> RefactorSlice)
- `requested_change` (text)
- `approval_state` (enum: pending, approved, rejected)
- `approved_by` (string)
- `approved_at` (datetime)

**Validation Rules**:
- Required only for `behavior_altering` slices.
- `approved_at` is required when `approval_state = approved`.

## Entity: DependencyRisk

**Purpose**: Tracks unresolved cross-domain risk that can block or reorder slices.

**Fields**:
- `risk_id` (string, unique)
- `slice_id` (foreign key -> RefactorSlice)
- `description` (text)
- `severity` (enum: low, medium, high, critical)
- `mitigation` (text)
- `status` (enum: open, mitigated, accepted)

## Entity: ValidationRun

**Purpose**: Records validation evidence for each slice milestone.

**Fields**:
- `run_id` (string, unique)
- `slice_id` (foreign key -> RefactorSlice)
- `build_result` (enum: pass, fail)
- `unit_result` (enum: pass, fail)
- `e2e_result` (enum: pass, fail, not_required)
- `notes` (text)

## Relationships

- RefactorSlice 1 -> 1 BehaviorBaseline
- RefactorSlice 1 -> 0..1 ApprovalRecord
- RefactorSlice 1 -> 0..N DependencyRisk
- RefactorSlice 1 -> 0..N ValidationRun

## State Transitions

RefactorSlice:
- `proposed -> planned -> in_progress -> complete`
- `in_progress -> blocked -> in_progress`
- `in_progress -> rolled_back`

Guard conditions:
- Transition to `complete` requires parity pass for parity-preserving slices.
- Transition to `complete` for behavior-altering slices requires approval_state `approved`.
