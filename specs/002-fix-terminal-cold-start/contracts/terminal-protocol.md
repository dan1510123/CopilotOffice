# Phase 1 Contracts: Terminal IPC Protocol Delta

The terminal protocol (`electron/terminal/protocol.ts`) is unchanged in shape by this feature. The contract delta is observational — what the renderer must do with the existing protocol — plus optional additive log lines for forensics.

## Existing messages (unchanged shape)

- `open { officeId, agentId, workingDir?, cols?, rows?, preseededPrompt?, launchMode? }` → `{ success, pid?, sessionId?, reused?, error? }`
- `attach { officeId, agentId }` → `{ success, scrollback?, error? }`
- `detach { officeId, agentId }` → `{ success }`
- `terminal-preload-status { agentId, status: 'preloading' | 'ready' | 'failed' }` (server → renderer event)
- `getSessionId { officeId, agentId }` → `string | null`
- `setSessionId { officeId, agentId, sessionId }`
- `resetSession { officeId, agentId }`
- `transferSession { fromOfficeId, toOfficeId, agentId }`
- `terminalWrite { officeId, agentId, data }`

## Observational contract delta (NEW expectations on the renderer)

| ID | Caller | Pre-condition | Post-condition |
|----|--------|---------------|----------------|
| **C1** | `OfficeScene.preStartAgentSessions` | Office has just become current and is in cold-start state. | EVERY agent in the current roster (not just the first two) receives exactly one `terminalStart(officeId, agent.id, ...)` call, in parallel or sequentially. Resulting `sessionId`s, observed via subsequent `getSessionId`, are pairwise distinct. |
| **C2** | `TerminalOverlay.show(agent)` | Caller wants to display `agent.id` in the terminal panel. | Sequence: `await terminalDetach(prevOfficeId, prevAgentId)` (if previous attach was non-null) → mutate `currentAgentId`/`currentAgent`/`attachedOfficeId` → `await terminalAttach(officeId, agent.id)` → register `onData` with `agentId` snapshot → `focusTerminal()`. The visible terminal MUST NOT echo input addressed to the previous agent. |
| **C3** | `TerminalOverlay.onData` callback | xterm fires `onData` with user keystrokes. | Send `terminalWrite(officeId, capturedAgentId, data)` using the `agentId` captured at registration time, not the live `this.currentAgentId`. |
| **C4** | `main.syncAgentStatuses` | A polling tick fires while `subState === 'starting'` and `(now - activityStartTime) > 60_000`. | Before calling `setAgentError(officeId, agentId, 'Startup timed out')`, query `serverStatus.alive`. If `alive`, instead call `setAgentReady(officeId, agentId)` with a warn log. |
| **C5** | `TerminalOverlay.attachCustomKeyEventHandler` and `SeriousTerminalController.attachCustomKeyEventHandler` | User presses platform-standard copy combo (Ctrl+C / Cmd+C) while a non-empty selection exists in the xterm. | `event.preventDefault()`, read `terminal.getSelection()`, write to system clipboard via `navigator.clipboard.writeText(selection)`. Return `false` from the handler so xterm does not also process the keystroke as interrupt. |

## Optional additive log lines (NEW)

These are forensic; they do not gate behavior.

- `[OfficeScene] preStart agent=<id> sessionId=<uuid> elapsedMs=<n>` — emitted from `preStartAgentSessions` after each per-agent start resolves. Lets us prove distinctness from a single log scrape.
- `[TerminalOverlay] switch from=<prev> to=<next> detachMs=<n> attachMs=<n>` — emitted from `show()` after the new attach resolves.
- `[Office] Agent X stuck in starting past timeout but PTY alive — recovering to ready` — emitted from `syncAgentStatuses` when the C4 guard fires.
- `[TermServer] Repaired duplicate sessionId for officeId=<o> agentId=<a> from=<dup> to=<new>` — emitted from `getOfficeSession`/loader if V3 repair triggers.

## Contracts NOT changing

- `protocol.ts` message shapes
- `preload.ts` `copilotBridge` surface
- `agent-viewers.ts` dual-key logic (used only by `transferSession`)
- `EventsWatcher` lifecycle
- IPC channels themselves
