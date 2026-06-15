# Phase 0 Research: Repository-Wide Refactor Program

## Decision 1: Refactor delivery uses bounded domain slices with strict parity contracts

**Rationale**: The repo is bug-prone and cross-cutting, so slice-based delivery reduces blast radius,
keeps reviews tractable, and allows rollback per slice while preserving behavior.

**Alternatives considered**:
- Big-bang rewrite: rejected due to high regression risk and weak rollback control.
- Pure file-by-file cleanup: rejected because it does not control cross-domain behavior risk.

## Decision 2: High-risk runtime pathways execute first

**Rationale**: Scene/input/terminal/session/fleet flows are highest product risk; stabilizing them
first gives reliable guardrails for later structural refactors.

**Alternatives considered**:
- Start with low-risk cleanup first: rejected because it delays risk retirement in critical flows.
- Randomized by team preference: rejected because ordering would be inconsistent and unmeasurable.

## Decision 3: Behavior baseline is explicit and approval-gated for intentional deviations

**Rationale**: User requirement allows design reversal but not behavior drift without approval. Each
slice must declare parity-preserving vs behavior-altering before implementation.

**Alternatives considered**:
- Implicit parity expectations: rejected due to ambiguity and inconsistent enforcement.
- Auto-allow behavior improvements: rejected because user approval is mandatory.

## Decision 4: Regression containment requires pre-declared rollback path per slice

**Rationale**: Refactoring a bug-heavy app can expose hidden coupling. Rollback instructions must be
defined up front to keep integration safe.

**Alternatives considered**:
- Decide rollback ad hoc during incidents: rejected as too slow and error-prone.
- No rollback, forward-fix only: rejected for high-risk runtime paths.

## Decision 5: Documentation and governance handoff are part of done criteria

**Rationale**: Without explicit handoff, architectural drift will return quickly after refactor.
Governance ensures future changes preserve new boundaries.

**Alternatives considered**:
- Keep governance informal in PR comments: rejected; not durable or auditable.
- Defer handoff until after implementation: rejected because it weakens enforcement during execution.

## Decision 6: Use agency-cowork-main as terminal-handling reference source

**Rationale**: `C:\Users\danielluo\repos\agency-cowork-main` has mature patterns for PTY lifecycle,
preload IPC contracts, and defensive process handling that are directly relevant to this refactor.
Using it as a reference reduces reinvention risk for terminal-session reliability.

**Alternatives considered**:
- Build all terminal handling patterns from scratch: rejected due to high defect risk.
- Copy implementation directly without adaptation: rejected because CopilotOffice architecture and
  constitution constraints require selective reuse, not wholesale transplant.
