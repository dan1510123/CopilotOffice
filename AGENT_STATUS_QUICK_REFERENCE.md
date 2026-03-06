# QUICK REFERENCE - Agent Status System

## 5-State State Machine
`
SLACKING (💤) ← User clicks → STARTING (🚀) ← preload:ready → READY (✓)
                                              ↑                    ↓
                                              └────────────────────┘
                                              
READY (✓) → turn:start → THINKING (⚡) → tool:complete → READY (✓)
READY (✓) → ask_user → WAITING (⏳) → turn:end → READY (✓)
`

## Key Files

| File | Purpose | Key Objects |
|------|---------|------------|
| src/office/officeManager.ts | Central status storage | AgentStatus, setAgent*() methods |
| src/main.ts | IPC event handlers | onCopilot*, onTerminalPreloadStatus |
| src/entities/NPC.ts | Visual rendering | updateAgentStatus(), badge colors |
| src/scenes/OfficeScene.ts | Event listeners | updateSessionBadges() |
| electron/terminal/preload.ts | IPC bridge | onCopilot* callbacks |
| electron/terminal/protocol.ts | Message types | SrvCopilot*, SrvTerminalPreloadStatus |

## Status Transitions (Quick Lookup)

### From STARTING State
- Only escape: preload:ready → READY
- All other events (tool, turn) are BLOCKED while starting

### From READY State
- turn:start → THINKING ("Processing...")
- tool:start (ask_user) → WAITING
- tool:start (other) → THINKING (tool name)

### From THINKING State
- turn:end → READY
- tool:complete (last) → READY
- tool:complete (more) → THINKING (next tool name)

### From WAITING State
- turn:end → READY

### From ANY State
- session:closed → SLACKING
- sync: no PTY → SLACKING

## Critical Guard: STARTING Block

All these handlers check: \if (current?.subState !== 'starting') { update(); }\
- onCopilotTurnStart (main.ts:535)
- onCopilotTurnEnd (main.ts:520)
- onCopilotToolStart (main.ts:467)
- onCopilotToolComplete (main.ts:499)
- onCopilotUserMessage (main.ts:552)

**Why:** Prevent race condition during preload (100-200ms window)
**Risk:** Events arriving during preload are silently dropped

## IPC Event Chain

Copilot CLI → Terminal Server → TerminalRelay → ipcRenderer.on() → 
officeManager.setState() → emit 'agent:status:changed' → 
OfficeScene.updateSessionBadges() → NPC.updateAgentStatus() → 
Phaser badge update + main.ts updateStatusBar() → DOM update

## Dashboard Display

Two UI systems track status:
1. **NPC Badges** (Phaser): Colored circles (💤🚀✓⏳⚡) above agent sprites
2. **Agent Cards** (HTML): Status label + icon in right panel
3. **Status Bar** (HTML): Aggregate counts at bottom

## Single Source of Truth

\\\
officeManager.currentOffice?.agents
  └─ Map<agentId, AgentStatus>
     ├─ agentId: string
     ├─ state: 'slacking' | 'active'
     ├─ subState: 'starting' | 'ready' | 'waiting' | 'thinking' | null
     ├─ thinkingDetail: string | null (what agent is doing)
     └─ currentTool: string | null (tool being used)
\\\

## Common Patterns

### Watch Status Change
\\\	ypescript
this.game.events.on('agent:status:changed', (agentId: string) => {
  const status = officeManager.getAgentStatus(officeId, agentId);
  // React to status
});
\\\

### Update Status
\\\	ypescript
const officeId = officeManager.currentOfficeId;
if (officeId) {
  officeManager.setAgentThinking(officeId, agentId, 'Tool Name', 'tool-id');
  phaserGame?.events.emit('agent:status:changed', agentId);
}
\\\

## Known Issues

| Issue | Impact | Priority |
|-------|--------|----------|
| No error state for preload fail | Agent stuck STARTING | HIGH |
| No timeout on STARTING | Guard blocks forever if stalled | HIGH |
| Office switch race condition | Status updates wrong office | MEDIUM |
| Tool state cleared on preload | Loses queued tool info | LOW |
| Full DOM rerender per event | Performance: ~40 renders/sec | LOW |

---

For full analysis, see: AGENT_STATUS_ANALYSIS.md (comprehensive 300+ line document)
