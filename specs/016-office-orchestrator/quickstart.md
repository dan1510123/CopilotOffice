# Quickstart: Office Orchestrator Agent

How to build, run, exercise, and verify the orchestrator agent (initial build).

## Prerequisites

- Logged-in Copilot CLI available on `PATH` (the SDK stdio backend uses
  `useLoggedInUser: true`).
- Node/Electron toolchain already used by the repo.
- SDK: `@github/copilot-sdk@1.0.5` (already a dependency).

## Build & run

```bash
npm run build     # builds game + electron bundles
npm start         # build + launch Electron
# or, watch mode:
npm run dev
```

> Ensure any new `electron/orchestrator/*.ts` files are reachable from the
> `build:electron` esbuild entry list in `package.json` (add an entry or import them
> from an existing entry such as `electron/main.ts`), or they won't be bundled.

## Exercise the feature

1. **Open the panel**: press the orchestrator hotkey / click the toolbar button. A
   focused overlay opens (dimming the game) with the orchestrator agent's chat TUI. On
   first open the orchestrator SDK session starts; the chat becomes interactive.
2. **Describe a need in natural language** (no agent name), e.g.
   *"I need someone to review this for security"* or *"help me debug a failing test"*.
3. **Watch the agent reason**: it calls `list_office_agents`, ranks the current office's
   dormant candidates (idle-seated + activatable reserves) by `skill`/`description`, and
   invokes `bring_agent_online({ agentId, reason })`.
4. **Approve or deny**: an approve/deny prompt appears in the panel naming the target
   agent. Approve → the agent is brought online (idle-seated started, or a reserve
   activated into an open seat and started). Deny → nothing is mutated and the agent is
   told, so it can propose another candidate.
5. **No match**: if nothing fits, the agent says so; pick manually from the roster.
6. **Close the panel**: focus returns to the game; the orchestrator session persists
   (reopening reattaches).

## Verification checklist (maps to spec acceptance scenarios)

- [ ] First open starts/reattaches the orchestrator SDK session; chat is interactive. *(AS-1)*
- [ ] NL request → tool invocation → approve/deny prompt naming the target. *(AS-2)*
- [ ] Approve starts an idle-seated agent (slacking → starting → ready). *(AS-3)*
- [ ] Approve activates a reserve into an open seat and starts it. *(AS-3)*
- [ ] Deny mutates nothing; denial returned to the agent. *(AS-4)*
- [ ] No-match reported; manual pick works. *(AS-5)*
- [ ] With global YOLO **ON**, the approve/deny prompt is STILL raised. *(AS-6)*
- [ ] Invalid/unknown target (bad agentId / no open seat / no reserves) is refused. *(AS-7)*
- [ ] Already-active target is a no-op (no duplicate session). *(edge case)*
- [ ] Dismissing the panel while a prompt is pending = deny (no mutation). *(edge case)*
- [ ] Closing the panel returns focus via `InputManager`; kills no session. *(AS-8)*

### Verify YOLO independence explicitly

```text
1. Toggle global YOLO ON (Settings).
2. Open the orchestrator panel; ask it to bring an agent online.
3. Confirm the approve/deny prompt STILL appears (orchestrator session is non-YOLO).
```

## Tests

```bash
npm run test        # Vitest — orchestrator unit/integration
npm run test:e2e    # Playwright — boot + open-panel smoke
```

Targeted suites:

- `tests/unit/orchestrator/candidateSelection.test.ts` — idle-seated + activatable-reserve
  computation from `OfficeManager` + `agents.ts`.
- `tests/unit/orchestrator/permissionGate.test.ts` — non-YOLO always-gate; approve →
  `{ kind: 'approved' }`, deny/dismiss → `{ kind: 'denied-interactively-by-user' }`;
  `isYoloEnabled()` never consulted.
- `tests/unit/orchestrator/bringOnlineExecute.test.ts` — started / already-active no-op /
  invalid-target / failed outcomes.

## Notes / gotchas

- The orchestrator session is **separate** from the office terminal server; it must not
  appear in `activeAgentViewers` or the `officeId+agentId` session map.
- Candidate compute + bring-online execution run in the **renderer** (owns
  `OfficeManager`); the main-process tool handlers round-trip over
  `orchestrator:candidates:*` / `orchestrator:execute:*`.
- Reserve activation is only available when the current layout has
  `supportsReserveAgents` (default office); fleet layouts do not.
