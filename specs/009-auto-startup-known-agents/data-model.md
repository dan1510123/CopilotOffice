# Data Model — Auto-Startup of Known Agents (spec 009)

All entities introduced by this spec live in the **renderer process** memory
(or `localStorage` / `sessionStorage` for persistence). No new disk schemas;
the existing `.data/{officeId}.sessions.json` is consumed read-only by the
warming decision and written only through the existing session-lifecycle
path (when "New Session" replaces `current[agentId]`, server-side as today).

## 1. `AgentAutoStartSettings` (persisted, `localStorage`)

```ts
// src/config/agentAutoStart.ts
export interface AgentAutoStartSettings {
  /** FR-016: gates cold-launch, office-switch, and post-New-Session triggers.
   *  Default: true (FR-019, US4 SC-005). */
  autoStartKnownAgents: boolean;
}

export const DEFAULT_AGENT_AUTO_START_SETTINGS: AgentAutoStartSettings = {
  autoStartKnownAgents: true,
};

export function getAgentAutoStartSettings(): AgentAutoStartSettings;
export function setAgentAutoStartSettings(next: AgentAutoStartSettings): void;
export function resetAgentAutoStartSettings(): void;
```

- **Storage key**: `copilot-office-agent-auto-start`
- **Validation rules**:
  - Missing key → return `DEFAULT_AGENT_AUTO_START_SETTINGS` (FR-019 fail-open).
  - JSON parse error → return default + clear the corrupt key.
  - `autoStartKnownAgents` must be `boolean`; any other type → default.
- **State transitions**: None (single scalar). Mutation is atomic via
  `setAgentAutoStartSettings`.

## 2. `WarmedOfficeRegistry` (in-memory + `sessionStorage`)

```ts
// inside src/agents/AutoStartCoordinator.ts
class WarmedOfficeRegistry {
  /** OfficeIds whose auto-startup has already run this app session.
   *  Source of truth for FR-008 / SC-007. */
  private warmed = new Set<string>();
  has(officeId: string): boolean;
  mark(officeId: string): void;
  // Hydrated from sessionStorage on construction so renderer reloads do not
  // re-warm an already-warmed office (spec Assumption: renderer reload is
  // NOT a new app session). Persisted with `sessionStorage.setItem` on mark.
}
```

- **Storage key**: `copilot-office-auto-start:warmed`, value is
  `JSON.stringify(Array.from(set))`.
- **Lifetime**:
  - Within an app session (Electron main-process lifetime): in-memory Set
    accumulates as offices are visited.
  - On renderer reload (rare): `sessionStorage` restores the Set, so we
    do not re-warm.
  - On Electron quit + relaunch: `sessionStorage` is cleared by the
    platform; cold-launch trigger correctly re-warms the boot office.

## 3. `AgentReplaceTracker` (in-memory only)

```ts
class AgentReplaceTracker {
  /** Per-agent in-flight "New Session" replacement promises.
   *  Source of truth for FR-014 / SC-005 / SC-008 coalescing. */
  private inFlight = new Map<string, Promise<void>>();
  has(agentId: string): boolean;
  get(agentId: string): Promise<void> | undefined;
  set(agentId: string, p: Promise<void>): void;
  // Cleared in a `finally` after the promise settles, including failure
  // paths (FR-015).
}
```

- **Lifetime**: Per app session, NOT persisted. A renderer reload while
  a replacement was in flight (extremely unusual) drops the tracker; the
  server-side PTY state remains authoritative and the user's next click
  reattaches.

## 4. `AutoStartCoordinator` (the orchestrator)

```ts
// src/agents/AutoStartCoordinator.ts
export interface AutoStartCoordinatorDeps {
  /** Returns the current office id, or null. */
  getCurrentOfficeId(): string | null;
  /** Returns the agent IDs configured for the given office (rosters +
   *  customAgents, EXCLUDING fleet sub-agents — FR-020). */
  getCanonicalAgentIds(officeId: string): string[];
  /** Returns the session-meta cache for the given office. */
  getSessionMeta(officeId: string): Record<string, { title: string }>;
  /** Returns the persisted current[agentId] uuid, or null. */
  getCurrentSessionId(officeId: string, agentId: string): string | null;
  /** Returns the agent's working dir + launch mode for terminalStart. */
  getAgentLaunchConfig(officeId: string, agentId: string): {
    workingDir: string;
    launchMode: 'copilot' | 'shell';
  };
  /** Per-agent close (reset) — wraps copilotBridge.resetSession. */
  resetSession(officeId: string, agentId: string): Promise<void>;
  /** Spawn (or reattach to) the PTY for the agent. Server-side dedup
   *  ensures no second PTY if one is already alive (R5 / FR-006). */
  warmAgentSession(officeId: string, agentId: string): Promise<void>;
  /** Settings getter (read at trigger time per FR-018). */
  getSettings(): AgentAutoStartSettings;
}

export class AutoStartCoordinator {
  constructor(deps: AutoStartCoordinatorDeps);

  /** Rule #1 + #2 trigger. Idempotent: no-op if office already warmed or
   *  setting is OFF. Returns the agents it kicked off (for testing). */
  tryWarmCurrentOffice(): Promise<string[]>;

  /** Rule #3 trigger. Returns the in-flight promise for an existing
   *  replace, otherwise starts and tracks a new one. Setting OFF
   *  short-circuits to just resetSession (acts like Close Session,
   *  per FR-017). */
  replaceSession(officeId: string, agentId: string): Promise<void>;
}
```

- **`tryWarmCurrentOffice` algorithm (FR-001…FR-011)**:
  1. If `getSettings().autoStartKnownAgents === false`: return `[]`.
  2. `oid = getCurrentOfficeId()`; if null: return `[]`.
  3. If `warmed.has(oid)`: return `[]` (FR-008).
  4. `warmed.mark(oid)` BEFORE spawning (prevents re-entry from a
     simultaneous `onOfficesUpdated`).
  5. `roster = getCanonicalAgentIds(oid)` (FR-020 excludes fleet sub-agents).
  6. `meta = getSessionMeta(oid)`.
  7. `qualifying = roster.filter(id => {
        const title = meta[id]?.title?.trim();
        const cur = getCurrentSessionId(oid, id);
        return title && title.length > 0 && cur;
     })` (FR-005).
  8. For each qualifying id, kick off `deps.warmAgentSession(oid, id)`
     in parallel (FR-003 non-blocking, SC-003 parallel). Each call is
     individually try/caught so one failure does not abort the others
     (FR-007).
  9. Return the kicked-off agent IDs synchronously; the spawns continue
     in the background (FR-010 survives subsequent office switch).
- **`replaceSession` algorithm (FR-012…FR-015, FR-017)**:
  1. If `tracker.has(agentId)`: return `tracker.get(agentId)!` (FR-014).
  2. Build the promise:
     ```
     const p = (async () => {
       await deps.resetSession(officeId, agentId);             // always (FR-013 equivalent)
       if (deps.getSettings().autoStartKnownAgents) {
         await deps.warmAgentSession(officeId, agentId);       // gated (FR-017)
       }
     })().finally(() => tracker.delete(agentId));               // FR-015
     ```
  3. `tracker.set(agentId, p)` and return `p`.

## 5. Existing entities consumed (read-only)

These are NOT introduced by this spec but the coordinator depends on them:

- **`.data/{officeId}.sessions.json`** (`electron/terminal/server.ts:71+`):
  shape `{ current: Record<agentId, sessionId>, metadata: Record<agentId, { title }> }`.
  Surfaced to the renderer via `copilotBridge.getAllSessionMeta(officeId)`
  (already cached in `cachedSessionMeta` per office via
  `src/main.ts:1260-1273`).
- **Per-agent status state machine** (`slacking → starting → ready → closing → slacking`):
  driven by the terminal server via the existing per-agent status event
  channel; surfaced to the dashboard via the existing badge renderer. No
  new states added.

## 6. Relationships

```
SettingsPanel (UI) ──reads/writes──> AgentAutoStartSettings (localStorage)
                                          │
                                          ▼  (read at trigger time)
OfficeManager.onOfficesUpdated ──┐
src/main.ts switchToOffice() ────┼──> AutoStartCoordinator.tryWarmCurrentOffice()
                                 │           │
TerminalOverlay.handleNewSession ┘           ├──> WarmedOfficeRegistry (sessionStorage)
SeriousTerminalController.handleNewSession ──> AutoStartCoordinator.replaceSession()
                                              │
                                              └──> AgentReplaceTracker (in-memory)
                                                         │
                                                         ▼
                                  copilotBridge.resetSession + terminalStart (existing IPC)
```

No new IPC channels. No new disk files.
