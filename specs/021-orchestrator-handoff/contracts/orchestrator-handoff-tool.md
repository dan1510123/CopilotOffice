# Contract: `handoff_session` Orchestrator SDK Tool + IPC

Extends `electron/orchestrator/tools.ts`. Registered on the single orchestrator SDK
session and backed by a `requestHandoff`/`respondHandoff` round-trip on
`OrchestratorSessionManager`, resolved late in the renderer over a new
`orchestrator:handoff:request/respond` IPC pair. Baseline tools from specs 016/017 are
unchanged.

Conventions (inherited from spec 017):
- **Gated**: omits `skipPermission`; the handler runs ONLY after the always-on, non-YOLO
  permission gate approves. Denial ⇒ `outcome:'denied'` with zero side effects.
- Returns a typed result; failure paths never throw silently.
- Targets are office-qualified and re-validated at execution time; the tool MUST NOT
  target the synthetic orchestrator identity as source or target.

## Tool: `handoff_session` (gated)

- **Description intent**: "Hand off a running agent's session: the source agent writes a
  handoff document (state, decisions, next steps) in its working directory, then a target
  session is provisioned — a fresh session of the SAME agent, or a DIFFERENT agent taking
  over — and receives a 'Pick up from this handoff' prompt pointing at that document. Use
  when a session's context is stale/too long or work should continue under a fresh or
  different agent. Gated — the user must approve. One approval covers the whole chain."
- **Parameters**:
  ```jsonc
  {
    "type": "object",
    "properties": {
      "sourceAgentId": {
        "type": "string",
        "description": "The online agent whose session is being handed off (from a status tool)."
      },
      "officeId": {
        "type": "string",
        "description": "Optional office to disambiguate the source/target."
      },
      "targetAgentId": {
        "type": "string",
        "description": "Optional. Omit (or equal to sourceAgentId) for a fresh session of the SAME agent. Provide a different agentId to have another agent take over."
      },
      "note": {
        "type": "string",
        "description": "Optional extra guidance folded into the source agent's doc-writing prompt (e.g. what to emphasize)."
      }
    },
    "required": ["sourceAgentId"],
    "additionalProperties": false
  }
  ```
- **Handler**: reached only after gate approval; delegates to `requestHandoff(args)`.

## Argument shape: `HandoffArgs`

The canonical TS shape mirrors the JSON schema above (flat, optional `targetAgentId` — NOT a
discriminated `target` union). This is the single source of truth; spec Key Entities and task
T004 must match it.

```ts
export interface HandoffArgs {
  sourceAgentId: string;   // required — online source (from a status tool)
  officeId?: string;       // optional — disambiguates source/target
  targetAgentId?: string;  // omit or === sourceAgentId ⇒ same-agent; distinct ⇒ cross-agent
  note?: string;           // optional extra guidance folded into the doc-writing prompt
}
```

## Result shape: `HandoffResult`

```ts
export type HandoffOutcome =
  | 'handed-off'      // doc-write prompt sent, target provisioned, pickup prompt delivered
  | 'denied'          // permission gate rejected by the user — zero side effects
  | 'not-approved'    // gate lapsed/timed out (no explicit user decision) — zero side effects
  | 'not-online'      // source agent had no live session
  | 'invalid-target'  // bad/absent source or target, or orchestrator identity
  | 'failed';         // an operation threw / a backing op returned false

export interface HandoffResult {
  sourceAgentId: string;
  targetAgentId: string;   // resolved target (== source for the same-agent path)
  officeId: string;
  handoffDocPath: string;  // deterministic, unique per handoff
  outcome: HandoffOutcome;
  message: string;
}
```

## Execution semantics (renderer `performHandoff`)

Runs only after approval. Order of operations:

1. **Resolve + guard source** (`resolveTarget`, spec 017): reject unknown / orchestrator
   identity ⇒ `invalid-target`. If the source is not online ⇒ `not-online` (no changes).
2. **Compute `handoffDocPath`**: `./.copilot-handoffs/handoff-<sourceAgentId>-<ISO8601>.md`
   relative to the source agent's working directory. Timestamp guarantees uniqueness.
3. **Resolve target**:
   - `targetAgentId` omitted or `=== sourceAgentId` ⇒ **same-agent** path.
   - distinct `targetAgentId` ⇒ **cross-agent** path; resolve + guard the target
     (unknown / orchestrator identity ⇒ `invalid-target`).
4. **Doc-write prompt → source** (`deliverText`): instruct the source to write the handoff
   document at `handoffDocPath`, covering current state, decisions made, open questions,
   and next steps (plus any `note`). If delivery fails ⇒ `failed`.
5. **Provision target**:
   - same-agent ⇒ `restartSession(officeId, sourceAgentId)` (fresh session, same identity
     + working dir). On false ⇒ `failed`.
   - cross-agent ⇒ `bringOnline(officeId, targetAgentId)` (idle-seated or reserve spawn,
     waits for ready). **Boundary rule (A1):** a target that is unknown, not seatable in
     this office, or the orchestrator identity ⇒ `invalid-target` (validated in step 3,
     before any side effect). A *seatable* target whose backing `bringOnline` op throws or
     returns false mid-provision ⇒ `failed`.
6. **Pickup prompt → target** (`deliverText`): "Pick up from this handoff. Read the handoff
   document at `<handoffDocPath>` before starting; if it isn't there yet, wait a moment and
   retry, then continue the work described in it." Delivered to the **target** session
   (which, for same-agent, is the freshly-restarted source). On false ⇒ `failed`.
7. **Return** `HandoffResult` with the resolved target + `handoffDocPath`. Record the
   outcome (incl. denials, surfaced by the manager) to the orchestrator transcript.

### Ordering note (FR-008)

The orchestrator does NOT block waiting for the source's asynchronous file write. Step 6's
"read the doc first, retry if absent" instruction makes the target self-synchronize, so the
tool can return promptly after both prompts are delivered and the target is provisioned.

## IPC: `orchestrator:handoff:request` / `orchestrator:handoff:respond`

Mirrors the spec 017 act-on channels. Main emits `orchestrator:handoff:request` with
`{ requestId, args: HandoffArgs }`; the renderer resolver (`performHandoff`) replies on
`orchestrator:handoff:respond` with `{ requestId, result: HandoffResult }`. The manager
correlates by `requestId`, resolves the pending promise, and records the outcome to the
transcript. Preload exposes the matching invoke/on bridge. No new persistence.

### Gate disposition: denied vs lapsed (FR-B06, I1)

Because `handoff_session` is gated, the gate can resolve three ways, and the distinction
B1/B3 introduce MUST survive to the model:

- **Approved** ⇒ manager emits `orchestrator:handoff:request`; `performHandoff` runs and
  returns one of the post-approval outcomes.
- **Explicitly denied** by the user ⇒ manager never emits the request; the tool result is
  `outcome:'denied'` with zero side effects. This is a terminal *decision* — the model must
  NOT retry.
- **Lapsed / timed out** (no user decision within the window) ⇒ manager never emits the
  request; the tool result is `outcome:'not-approved'` with zero side effects. Framed as
  "waiting on the user", also terminal for this turn — the model must NOT re-arm a new gate
  in a retry loop (the B1 defect). The gate-disposition value (T005) is what drives the
  `denied` vs `not-approved` split; it is carried on `HandoffResult.outcome`, never silently
  collapsed into `denied`.

## Outcome matrix (unit coverage — `handoffSession.test.ts`)

| Case | source | target arg | Expected outcome |
|------|--------|-----------|------------------|
| Same-agent restart | online | omitted | `handed-off` (restartSession called; pickup to source's fresh session) |
| Target == source | online | == source | `handed-off` via same-agent path (coerced) |
| Cross-agent | online | distinct valid | `handed-off` (bringOnline(target); pickup to target) |
| Source offline | offline | any | `not-online` (no deliverText/restart/bringOnline) |
| Unknown/invalid target | online | bogus | `invalid-target` (no pickup) |
| Orchestrator identity | orch | — | `invalid-target` |
| Denied | online | any | `denied` (manager never emits request; zero side effects) |
| Gate lapsed/timeout | online | any | `not-approved` (manager never emits request; zero side effects; no retry) |
| Backing op fails | online | any | `failed` (deliverText/restart/bringOnline returns false) |
| Doc-path uniqueness | online | any (x2) | two distinct `handoffDocPath` values |
