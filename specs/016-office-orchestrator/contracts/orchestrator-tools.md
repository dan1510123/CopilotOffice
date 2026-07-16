# Contract: Orchestrator SDK Tools + Permission Gate

The orchestrator agent's SDK session (`@github/copilot-sdk@1.0.5`) is configured with
two in-process tools (`SessionConfigBase.tools: Tool<any>[]`, via `defineTool`) and a
bespoke `onPermissionRequest` handler. Types below reference the installed SDK
(`node_modules/@github/copilot-sdk/dist/types.d.ts`).

## Tool: `list_office_agents` (read-only, auto-approved)

Lets the agent discover who it can bring online in the current office so it can rank
candidates against the user's natural-language request.

- **Registration**: `defineTool('list_office_agents', { description, parameters, handler, skipPermission: true })`.
- **Parameters**: `{}` (no args) — always scoped to the currently viewed office.
- **Handler** (main): round-trips to the renderer via
  `orchestrator:candidates:request` → `orchestrator:candidates:respond` and returns the
  `BringOnlineCandidate[]`.
- **Returns** to the model:
  ```jsonc
  {
    "officeId": "default",
    "candidates": [
      { "agentId": "debugger", "name": "Dan", "skill": "general",
        "description": "Debugger — investigates and fixes issues", "source": "idle-seated" },
      { "agentId": "validator", "name": "…", "skill": "general",
        "description": "The Validator", "source": "reserve", "deskId": "unassigned-3" }
    ]
  }
  ```
- **Gate**: none (read-only, `skipPermission`). It exposes no mutation.

## Tool: `bring_agent_online` (gated)

The single mutation the agent can request.

- **Registration**: `defineTool('bring_agent_online', { description, parameters, handler })` — **no** `skipPermission`.
- **Parameters** (JSON schema):
  ```jsonc
  {
    "type": "object",
    "properties": {
      "agentId": { "type": "string", "description": "Candidate agentId from list_office_agents" },
      "reason":  { "type": "string", "description": "Why this agent fits the request" }
    },
    "required": ["agentId"]
  }
  ```
- **Handler** (main), invoked ONLY after the gate approves: round-trips to the renderer
  via `orchestrator:execute:request` → `orchestrator:execute:respond` and returns the
  `BringOnlineResult` to the model. On `invalid-target` / `already-active` / `failed`,
  the handler returns that outcome so the agent can adjust or inform the user.

## Permission gate (`onPermissionRequest`)

- **Signature** (SDK): `PermissionHandler = (request: PermissionRequest, invocation: { sessionId: string }) => Promise<PermissionRequestResult> | PermissionRequestResult`.
- **Relevant request variant**: `PermissionRequestCustomTool { kind: 'custom-tool'; toolName; toolDescription; toolCallId?; args? }`.
- **Behavior**:
  1. If `request.kind === 'custom-tool' && request.toolName === 'bring_agent_online'`:
     emit `orchestrator:permission:request` (with `toolCallId`, `args.agentId`,
     `args.reason`) to the renderer and **await** the panel's decision. Resolve:
     - approve → `{ kind: 'approved' }`
     - deny / dismiss-while-pending → `{ kind: 'denied-interactively-by-user' }`
  2. **MUST NOT** consult `isYoloEnabled()` — the orchestrator session is always gated,
     independent of the global YOLO toggle.
  3. Any other request kind (should not occur for this session's toolset) → deny by
     default (`{ kind: 'denied-interactively-by-user' }`), never auto-approve.
- **Correlation**: the pending decision promise is keyed by `toolCallId` (a session has
  at most a handful concurrently; a per-`toolCallId` map is the correct model, analogous
  to the `pendingUserInput` single-slot-per-session pattern).

## Session configuration invariants

- Session created via `new CopilotClient({ connection: RuntimeConnection.forStdio(...) })`
  → `createSession({ workingDirectory, streaming: true, tools: [listTool, bringOnlineTool], onPermissionRequest, onUserInputRequest })`.
- **No `--yolo`**: the stdio SDK backend launches no `--yolo` host; combined with the
  non-YOLO permission handler, bring-online is structurally always gated.
- Stream consumed via `session.on(evt => …)` → `mapSdkEventToCopilotEvent` → forwarded
  over `orchestrator:event`.
