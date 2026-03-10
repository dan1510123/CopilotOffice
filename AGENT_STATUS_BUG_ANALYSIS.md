# Agent Status Bug Analysis

## Summary

Agent statuses in the main office keep flipping back to **"slacking"** even when agents have active PTY sessions. This happens every ~10 seconds via the periodic `syncAgentStatuses()` call. The root cause is a **composite-key mismatch** between the terminal server and the renderer.

---

## Root Cause: Composite Key Mismatch in `queryAgentStatuses`

### The Server Returns Composite Keys

**File:** `electron/terminal/server.ts` — lines 700–709

```typescript
case 'query-agent-statuses': {
  const statuses: Record<string, { alive: boolean; ready: boolean }> = {};
  for (const [ck] of agentToTerminal) {
    const key = agentToTerminal.get(ck);
    const alive = !!(key && ptyProcesses.has(key));
    const ready = agentReadyState.get(ck) ?? false;
    statuses[ck] = { alive, ready };   // ← keyed by "office-0:architect"
  }
  send({ type: 'response', requestId: msg.requestId, result: statuses });
}
```

The `agentToTerminal` map uses **composite keys** built by `compositeKey(officeId, agentId)` → `"office-0:architect"`. The response sends these composite keys directly.

### The Client Looks Up by Simple Agent ID

**File:** `src/main.ts` — lines 964–965

```typescript
for (const agent of getCurrentAgents()) {
  const serverStatus = statuses[agent.id];   // ← looks for "architect"
  const current = officeManager.getAgentStatus(officeId, agent.id);
```

`agent.id` is a simple string like `"architect"`, `"generalist"`, etc. The lookup `statuses["architect"]` always returns `undefined` because the server keyed it as `statuses["office-0:architect"]`.

### The Fallthrough Resets to Slacking

**File:** `src/main.ts` — lines 994–999

```typescript
} else {
  // Agent has no running PTY — should be slacking
  if (current && current.state === 'active') {
    officeManager.setAgentSlacking(officeId, agent.id);
    changed = true;
  }
}
```

Because `serverStatus` is always `undefined`, `serverStatus?.alive` is always `false`, and every active agent falls into this else branch — getting reset to slacking.

---

## Impact

| Trigger | Frequency | Effect |
|---------|-----------|--------|
| Periodic sync | Every 10 seconds | All active agents silently reset to slacking |
| Office switch | On every tab switch | Immediate reset on `switchToOffice()` → `syncAgentStatuses()` |
| Agent reattach | On terminal reattach | Reset via `agent:reattached` event handler |
| App startup | Once | Initial `syncAgentStatuses()` call resets any pre-existing sessions |

The bug makes it **impossible** for agents to maintain any non-slacking status (starting, ready, thinking, waiting) for longer than 10 seconds.

---

## Same Bug Affects `list-active`

**File:** `electron/terminal/server.ts` — lines 690–696

```typescript
case 'list-active': {
  const activeAgentIds = Array.from(agentToTerminal.keys()).filter(ck => {
    const key = agentToTerminal.get(ck);
    return key && ptyProcesses.has(key);
  });
  // Returns ["office-0:architect", "office-0:generalist"] instead of ["architect", "generalist"]
```

This endpoint also returns composite keys. Any consumer expecting simple agent IDs will fail.

---

## Contributing Factor: `ENABLE_STARTING_GUARD` Is Disabled

**File:** `src/main.ts` — line 47

```typescript
const ENABLE_STARTING_GUARD = false;
```

This flag was meant to prevent IPC event handlers from overwriting status while an agent is starting. The comment says server-side filtering handles it, but since the server's `queryAgentStatuses` response is broken, there's no working protection layer.

---

## Contributing Factor: No Office Scoping in Query

The `query-agent-statuses` message type (defined in `electron/terminal/protocol.ts`) accepts no `officeId` parameter:

```typescript
export interface MsgQueryAgentStatuses {
  type: 'query-agent-statuses';
  requestId: string;
  // no officeId field
}
```

The server returns statuses for **all offices**. The client only cares about the current office but has no way to filter. Even if the key mismatch is fixed, agents from other offices could pollute the results if agent IDs overlap.

---

## Race Condition: Office Switch + Periodic Sync

**File:** `src/main.ts` — lines 277–299

```typescript
function switchToOffice(officeId: string) {
  officeManager.switchOffice(officeId);          // Updates currentOfficeId
  // ...
  syncAgentStatuses();                            // Uses new officeId
}
```

The periodic `setInterval(syncAgentStatuses, 10_000)` can fire concurrently with a manual `switchToOffice()` call. If the interval fires after `switchOffice()` but before `syncAgentStatuses()` completes, both calls race on the same async IPC round-trip. The `officeId` captured at line 957 could refer to different offices in each call.

---

## Proposed Fixes

### Fix 1 — Server: Return Office-Scoped Simple Keys (Critical)

Change `query-agent-statuses` in `server.ts` to extract the `agentId` from the composite key, and optionally accept an `officeId` to filter results:

```typescript
case 'query-agent-statuses': {
  const statuses: Record<string, { alive: boolean; ready: boolean }> = {};
  for (const [ck] of agentToTerminal) {
    const agentId = ck.split(':')[1];           // Extract "architect" from "office-0:architect"
    const key = agentToTerminal.get(ck);
    const alive = !!(key && ptyProcesses.has(key));
    const ready = agentReadyState.get(ck) ?? false;
    statuses[agentId] = { alive, ready };        // Simple key
  }
  send({ type: 'response', requestId: msg.requestId, result: statuses });
}
```

A more robust fix would add `officeId` to `MsgQueryAgentStatuses` and filter:

```typescript
case 'query-agent-statuses': {
  const { officeId } = msg as MsgQueryAgentStatuses;  // New field
  const statuses: Record<string, { alive: boolean; ready: boolean }> = {};
  for (const [ck] of agentToTerminal) {
    if (officeId && !ck.startsWith(officeId + ':')) continue;  // Filter by office
    const agentId = ck.split(':')[1];
    const key = agentToTerminal.get(ck);
    const alive = !!(key && ptyProcesses.has(key));
    const ready = agentReadyState.get(ck) ?? false;
    statuses[agentId] = { alive, ready };
  }
  send({ type: 'response', requestId: msg.requestId, result: statuses });
}
```

### Fix 2 — Client: Construct Composite Key for Lookup (Alternative)

If the server response format can't change, the client can construct the expected key:

```typescript
for (const agent of getCurrentAgents()) {
  const serverStatus = statuses[`${officeId}:${agent.id}`];  // Match server format
  // ...
}
```

This is simpler but couples the client to the server's internal key format.

### Fix 3 — Apply Same Fix to `list-active`

The `list-active` handler has the same composite-key issue and should extract simple agent IDs or accept an `officeId` filter.

### Fix 4 — Re-enable `ENABLE_STARTING_GUARD`

Set `ENABLE_STARTING_GUARD = true` in `src/main.ts` to restore the secondary safety net while agents are starting up.

### Fix 5 — Guard Against Office-Switch Race

Add a debounce or lock to prevent `syncAgentStatuses()` from running concurrently during office switches:

```typescript
let syncInProgress = false;

async function syncAgentStatuses(): Promise<void> {
  if (syncInProgress) return;
  syncInProgress = true;
  try {
    // ... existing logic
  } finally {
    syncInProgress = false;
  }
}
```

---

## Likely Introduction Point

This bug was likely introduced in commit **9cd7e20** (`feat: fleet orchestration, sub-agent tracking, and terminal improvements`) or **8301944** (`Updated sessions to have id be office-{index}`) which introduced the multi-office composite key system. The `queryAgentStatuses` handler was added using composite keys, but the renderer-side `syncAgentStatuses` was written (or left unchanged) expecting simple agent IDs.

---

## Files Involved

| File | Role |
|------|------|
| `electron/terminal/server.ts` (L700–709) | Returns composite keys in `query-agent-statuses` response |
| `src/main.ts` (L953–1020) | `syncAgentStatuses()` — looks up by simple agent ID, resets to slacking on miss |
| `electron/terminal/protocol.ts` (L111–114) | `MsgQueryAgentStatuses` type — missing `officeId` field |
| `electron/terminal/ipc-relay.ts` (L294–296) | Passes through without adding office context |
| `electron/terminal/preload.ts` (L59–61) | Bridge — no `officeId` param passed |
