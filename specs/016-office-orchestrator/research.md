# Phase 0 Research: Office Orchestrator Agent

All unknowns from the Technical Context are resolved below. Findings are grounded in
the actual repo and the installed `@github/copilot-sdk@1.0.5` type definitions.

## R1 — How does the orchestrator agent expose a real, gated `bring_agent_online` action?

- **Decision**: Use an **SDK in-process custom tool** (`tools: [defineTool("bring_agent_online", { parameters, handler })]`) on the orchestrator's SDK session, gated by the session's `onPermissionRequest` handler.
- **Rationale**: `node_modules/@github/copilot-sdk/dist/types.d.ts` defines `SessionConfigBase.tools?: Tool<any>[]`, `Tool<TArgs> { name, description?, parameters?, handler?, overridesBuiltInTool?, skipPermission?, defer? }`, `ToolHandler<TArgs> = (args, invocation) => Promise<unknown> | unknown`, and `defineTool(name, {...})`. `dist/client.js` wires `config.tools` into the runtime. A custom-tool invocation raises a `PermissionRequestCustomTool { kind: "custom-tool", toolName, toolDescription, toolCallId?, args? }` to `onPermissionRequest`, so the app can detect `toolName === "bring_agent_online"` and surface an approve/deny that names the target before the handler runs. This is the lowest-risk fit and keeps the tool body in-process (no extra process).
- **Alternatives considered**:
  - *MCP stdio/HTTP server* (`SessionConfigBase.mcpServers?: Record<string, MCPServerConfig>`): viable and standards-based, but adds an external process/boundary for a single in-app action — unnecessary complexity for the initial build.
  - *Skills* (`skillDirectories` / `CustomAgentConfig.skills`): rejected — skills are prompt/context only (`electron/terminal/custom-skills.ts`), they carry no executable behavior that can signal the app.
  - *Structured-output parsing of chat text* (earlier abandoned approach): rejected — brittle and bypasses the real permission gate.

## R2 — How is the orchestrator session forced non-YOLO, independent of the global toggle?

- **Decision**: The orchestrator session registers its **own `onPermissionRequest`** that **never consults `isYoloEnabled()`** and always routes the decision to the user (returns `{ kind: "approved" }` only after an explicit approve, otherwise a denied/cancelled kind). The orchestrator runs via the SDK **stdio backend** (`new CopilotClient({ connection: RuntimeConnection.forStdio(...) })`), which does **not** launch a `--yolo` host process at all.
- **Rationale**: In `electron/terminal/terminal-backend.ts`, YOLO is enforced two ways — the ui-server host launch flag `const yoloArgs = options.yolo ? ['--yolo'] : []`, and the `ControlPlaneClient` permission handler that calls `isYoloEnabled()` **per request**. The office backends deliberately couple to the global toggle; the orchestrator deliberately does not. Using the stdio SDK backend with a fixed interactive permission handler makes "always gated" a structural property, not a runtime check.
- **Alternatives considered**: Reuse the office `ControlPlaneClient` with `isYoloEnabled: () => false` — workable, but it entangles the orchestrator with the office ui-server host/viewer machinery. A separate stdio session is cleaner and isolates blast radius.

## R3 — Where does the orchestrator session live, given office sessions are keyed by `officeId+agentId`?

- **Decision**: Add a **dedicated main-process `OrchestratorSessionManager`** that owns a single SDK session, entirely separate from the office terminal server (`electron/terminal/server.ts`) and its `activeAgentViewers` bookkeeping. It is exposed to the renderer over a new `orchestrator:*` IPC surface.
- **Rationale**: `server.ts` keys sessions by `compositeKey(officeId, agentId)` and maintains dual-key viewer invariants (`electron/terminal/agent-viewers.ts`). The orchestrator is a meta-agent, not a seated office NPC; forcing it into that keyspace would risk the documented viewer/lifecycle invariants (R-002, BL-004). A separate manager keeps office session integrity untouched while reusing the same SDK primitives.
- **Alternatives considered**: Reserved synthetic `officeId+agentId` inside the existing server — rejected to avoid polluting roster/viewer logic and the "no hardcoded agent IDs" guidance.

## R4 — How does the agent learn the candidate roster and act on a concrete agent?

- **Decision**: Provide the orchestrator two tools: a read-only `list_office_agents` (auto-approved / `skipPermission`) that returns the current office's **idle-seated + activatable-reserve** candidates with `skill`/`description`, and the gated `bring_agent_online({ agentId, reason })`. Candidate computation and execution live in the **renderer** (which owns `OfficeManager`); the main-process tool handlers round-trip to the renderer over IPC and await the response.
- **Rationale**: `OfficeManager` (`src/office/officeManager.ts`) is renderer-side and is the source of truth for `currentOfficeId`, per-agent `AgentStatus`, and seating. Candidates are: `currentOffice.agents` entries with `state === 'slacking'` (idle seated) and, when the layout has `supportsReserveAgents` and a desk id is `unassigned-*`, the matching `RESERVE_AGENTS[deskId]`. Execution reuses the proven paths: an `OfficeManager`-owned module starts an idle-seated agent directly (`setAgentStarting` + `terminalStart`), while **reserve activation is delegated to `OfficeScene`** (its private `spawnReserveAgent(deskId)` creates the NPC, physics, and walk-in animation and is not reachable from an `OfficeManager` module) via a `game.events` event. Keeping compute + the seated-start in the renderer avoids duplicating office state in main; the reserve delegation respects the scene boundary.
- **Alternatives considered**: Inject the roster as a static system-message preamble — rejected because the roster changes with office switches and agent status; a read tool stays live. Have the agent pass a free-text description and let the app match — rejected in favor of the agent doing the ranking (its core value) and passing a concrete `agentId` the app validates.

## R5 — How is the chat TUI rendered and how does input/stream/approval flow?

- **Decision**: A new focused DOM overlay (`OrchestratorPanel`) hosts an xterm.js instance (mirroring `TerminalOverlay`) bound to the orchestrator session via a new `orchestrator:*` IPC surface: `orchestrator:input` (renderer→main user text), `orchestrator:event` (main→renderer normalized SDK stream), `orchestrator:permission:request` (main→renderer) / `orchestrator:permission:respond` (renderer→main), and `orchestrator:exit`. Prompts are submitted via `session.send({ prompt })` (default mode); events come from `session.on(...)` normalized by `mapSdkEventToCopilotEvent` (`electron/terminal/event-source.ts`).
- **Rationale**: `TerminalOverlay` already demonstrates the xterm host pattern (`terminal.open(hostDiv)`, `onData → copilotBridge.terminalWrite`, focus via `InputManager.switchToTerminal`). The `teams:*` IPC surface (`electron/teams/teamsIpc.ts`, `preload.ts`) is the template for adding a self-contained IPC channel set with `ipcMain.handle(...)` + `webContents.send(...)` + `ipcRenderer.on(...)`. The permission request/response mirrors the existing `pendingUserInput` late-resolve pattern (a promise held in the handler, resolved out-of-band by the renderer's response, correlated by `toolCallId`).
- **Alternatives considered**: A bespoke non-xterm chat DOM — deferred; reusing xterm keeps parity with the rest of the app and the ansi stream rendering for free.

## R6 — Focus, layering, and lifecycle integration

- **Decision**: Register a new `ZIndex.ORCHESTRATOR_PANEL` layer; open/close routes through `InputManager.suspendGameInput()/resumeGameInput()` via the existing `settings:open`/`settings:close` bus (or an equivalent `onOpen`/`onClose` pair); the orchestrator session **starts/reattaches on first open** and is **never killed** on panel close (parity with real-session integrity). A dismiss while a permission request is pending resolves it as **denied**.
- **Rationale**: `src/config/zIndex.ts` is the single source of truth for layers; `src/input/InputManager.ts` requires DOM-modal overlays to suspend/resume game input; the constitution (Principle III) and repo pitfalls require sessions be detached-not-killed. The orchestrator has no office viewer entry, so closing the panel simply stops streaming to the overlay without tearing down the session.
- **Alternatives considered**: Kill the session on close and recreate on open — rejected; violates session-integrity intent and loses conversation continuity.

## R7 — Persistence

- **Decision**: **No new persistence** in the initial build. The orchestrator session is ephemeral/reattach-only; there is no backlog or settings to persist (those belong to the deferred task-board phase, FR-026).
- **Rationale**: Spec scope is the agent + gated bring-online only. Global YOLO already persists via `src/config/yoloMode.ts` and is intentionally not consulted by the orchestrator.
- **Alternatives considered**: Persist chat history — out of scope; deferred.

## Resolved Technical Context values

- **Language/Version**: TypeScript (strict) on Electron 40+ (Node runtime in main; browser context in renderer), bundled with esbuild.
- **Primary Dependencies**: Phaser 3 (renderer), `@github/copilot-sdk@1.0.5` (orchestrator session + `defineTool`/`onPermissionRequest`), `@xterm/xterm` + `@xterm/addon-fit` (chat TUI), `node-pty`/`ws` (existing terminal backends, unchanged).
- **Storage**: None new (localStorage/`.data` untouched for the initial build).
- **Testing**: Vitest (`npm run test`) for unit/integration; Playwright (`npm run test:e2e`) smoke.
- **Target Platform**: Desktop (Electron) — Windows/macOS/Linux.
- **Project Type**: Desktop app (Electron main + Phaser/DOM renderer).
- **Performance Goals**: 60fps gameplay unaffected (orchestrator is DOM overlay + separate session); stream/approval latency within the existing bounded status-delay target.
- **Constraints**: Phaser sole renderer; sessions detached-not-killed; focus via `InputManager`; `ZIndex` registry; no hardcoded agent IDs or status strings/colors; orchestrator session non-YOLO regardless of global toggle.
- **Scale/Scope**: Single-user desktop; a handful of offices and dozens of agents; exactly one orchestrator session.
