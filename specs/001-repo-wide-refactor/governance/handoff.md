# Refactor Handoff — Governance for Future PRs

Audience: maintainers landing follow-up work after the 001-repo-wide-refactor program completes.

## Review Gates

Every PR touching the codebase MUST:

1. **Pass `npm run build`** with no errors.
2. **Pass `npm run test`** with no removed tests. New behavior requires new test coverage.
3. **Preserve `window.copilotBridge`** shape unless an approved `behavior_altering` change is logged in `specs/001-repo-wide-refactor/tracking/approvals.md` (or the equivalent for a new program). Renderer ↔ main contract is load-bearing.
4. **Honor the dual-key viewer invariant** (R-002, see `electron/terminal/agent-viewers.ts`) when touching `electron/terminal/server.ts` or anything that mutates `activeAgentViewers`. Do not bypass `addAgentViewer` / `removeAgentViewer` on transfer paths.
5. **Run the relevant slice's parity-check subset** when changes touch a P1 domain (input, scene, terminal, meeting/fleet) — record the result in the slice's `Validation Runs` table or in a follow-up tracking file.

## Mandatory Parity Checks for Critical Flows

When a PR touches any of these areas, run the listed checks:

| Area touched | Required checks |
|--------------|-----------------|
| `electron/terminal/**` or `src/ui/TerminalOverlay.ts` | `npm run build` + `npm run test` + ideally `npm run test:e2e` (env-blocked on CLI runners — record as such) |
| `src/meeting/**` | `npm run test` (planParser + planApproval + fleetOrchestrator suites) + manual meeting smoke |
| `src/office/officeManager.ts` or `src/office/officePersistence.ts` | `npm run test` (`tests/unit/office/**`) + persistence round-trip smoke |
| `src/main.ts` (terminal wiring or status transitions) | `npm run test` (`tests/integration/main/**` + `tests/unit/util/toolStatus.test.ts`) |
| `src/input/**` | `npm run test` (`tests/unit/input/**` including OverlayFocusRestore) |
| `src/layouts/**` | `npm run test` (`tests/unit/layouts/**`) |
| `src/config/zIndex.ts` or any `style.zIndex = ...` site | `tests/unit/config/zIndex.test.ts` |

## Change Classification Rule

Every non-trivial change is one of:

- **`parity_preserving`** — must not alter observable behavior, must pass parity checks. No approval required. The default.
- **`behavior_altering`** — alters observable behavior (UI changes, status semantics, protocol additions/removals). REQUIRES an `approved` `ApprovalRecord` in `specs/001-repo-wide-refactor/tracking/approvals.md` (or new program's equivalent) before merge.

If a slice / PR is classified `behavior_altering`, the implementer MUST:

1. Open a pending approval entry naming the change, the scope, and why parity can't be preserved.
2. Wait for a user (not the implementer) to flip the entry to `approved`.
3. Reference the approval id in the slice's `approval_record` field.

If a classified-`behavior_altering` change cannot get approval, the slice MUST flip back to `parity_preserving` (and the change reduced) or be reverted.

## Constitution Posture

No constitution amendments were required by the 001-repo-wide-refactor program (P1+P2 all `parity_preserving`). `.specify/memory/constitution.md` is left untouched. The structural conventions added by P1+P2 (encapsulation patterns, telemetry, named constants) are documented in `.github/instructions/*.instructions.md` and `.github/copilot-instructions.md` rather than the constitution.

If a future program ratifies one of those conventions as a hard invariant, propose a constitution amendment and have it approved per the constitution's own amendment process before relying on it.

## Where the Boundaries Live

See `specs/001-repo-wide-refactor/governance/boundaries.md` for the final ownership boundaries per domain (scene, input, UI, terminal, office, layout, meeting, config).

## Open Risk Carry-Over

After P2, the following risks remain:

- **R-004** (direct Phaser keyboard manipulation outside `src/input/**`) — **open**. Audit was partially done in S1-A; not exhaustive across `src/scenes/**`. Recommend a focused follow-up.
- **R-006** (worktree `.specify/extensions.yml` missing hook automation) — **accepted**. Operational quirk, no remediation planned.
- **BL-004 session-detach on office switch** — **deferred**. No automated regression test; partial coverage via the env-blocked Playwright smoke.

See `specs/001-repo-wide-refactor/tracking/risks.md` for the full register.

## Final Validation Snapshot

See `specs/001-repo-wide-refactor/tracking/progress.md` → `Final Validation` table for the canonical exit numbers.
