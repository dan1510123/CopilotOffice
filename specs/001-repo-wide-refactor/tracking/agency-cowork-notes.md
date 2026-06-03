# agency-cowork-main Reference Notes

> Source: `C:\Users\danielluo\repos\agency-cowork-main`
> Captures PTY lifecycle, preload IPC, and process-supervision patterns we may adapt
> for CopilotOffice terminal/session slices (S1-C, S1-D).

## Files Reviewed

- `ui/electron/main.js` — Electron main process, window lifecycle, PTY orchestration
- `ui/electron/preload.js` — context bridge defining renderer-side IPC surface
- `ui/electron/dashboard-sidecar.js` — sidecar process management
- `ui/electron/scheduler-cron.js` — long-lived scheduled work supervision
- `ui/electron/telemetry.js` — defensive logging/telemetry around process lifecycle
- `ui/electron/update-utils.js` — update flow utilities

## Patterns Identified (candidates for adaptation)

### 1. PTY lifecycle ownership

- Single PTY manager in main process owns spawn/attach/detach/dispose.
- Renderer never holds PTY handle directly — interacts via IPC channels exposed by preload.
- Pattern fits CopilotOffice S1-D goal: ensure `electron/terminal/server.ts` is the sole owner of
  PTY handles and lifecycle transitions, with the renderer only sending intent messages.

### 2. Preload IPC as a typed contract surface

- `preload.js` exposes a narrow, named API via `contextBridge.exposeInMainWorld`.
- Each method is a thin wrapper around `ipcRenderer.invoke`/`.on` with no business logic.
- Pattern fits CopilotOffice S1-C/S1-D: keep `window.copilotBridge` minimal, push all logic into
  main, and version the protocol explicitly so renderer/server changes ship together.

### 3. Process supervision and recovery

- Long-lived processes (sidecar, cron) wrapped with structured restart/backoff and telemetry hooks.
- Lifecycle events flow through a single event bus rather than ad-hoc callbacks.
- Pattern fits CopilotOffice fleet sub-agent forwarding: `copilot-event` should be a stable event
  channel that survives scene transitions and viewer detachment (per existing pitfall note).

### 4. Defensive PATH and binary resolution

- Sanitizes PATH and resolves CLI binaries explicitly to avoid picking up shadowed local installs.
- Pattern fits CopilotOffice S1-D: keep existing PATH sanitization and explicit `copilot` resolution
  invariants from `electron/terminal/server.ts` and document them as protected.

### 5. Telemetry around lifecycle transitions

- Lifecycle transitions emit structured telemetry that is cheap to grep during incidents.
- Pattern fits CopilotOffice: status badge transitions (`slacking → starting → ready ↔
  waiting/thinking → slacking`) should emit structured logs that can be replayed when debugging
  parity regressions.

## Patterns NOT to copy wholesale

- **No transplant of full IPC schema** — CopilotOffice has its own protocol types under
  `electron/terminal/` that the renderer depends on. Adapt structure, not literal channel names.
- **No sidecar/cron infrastructure** — CopilotOffice does not currently need scheduled background
  work; importing it would violate scope.
- **No telemetry endpoint** — keep CopilotOffice logging local; do not introduce external telemetry
  sinks during this refactor.

## Application Plan

- **S1-C (renderer)**: adopt narrow preload-surface discipline; keep one terminal lifecycle module.
- **S1-D (server)**: adopt single-owner PTY manager pattern; preserve current dual-key
  `activeAgentViewers` invariant; document PATH sanitization as protected.
- **S1-E (meeting/fleet)**: adopt event-bus discipline for `copilot-event` so forwarding does not
  depend on active viewers (already a known invariant; codify it).

## Verification

Any code merged from this reference adaptation MUST:
1. Compile under CopilotOffice's TypeScript strict mode.
2. Preserve the existing `window.copilotBridge` shape unless an approved behavior change is logged.
3. Pass the parity harness for terminal lifecycle and fleet session transfer.
