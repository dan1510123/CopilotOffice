# Quickstart: Fix Terminal Copy/Paste

## Prerequisites

- Node.js 18+ and npm
- Repository cloned and dependencies installed (`npm install`)

## Key Files

| File | Role |
|------|------|
| `src/ui/TerminalOverlay.ts` | Primary terminal controller (Phaser game mode) |
| `src/ui/SeriousTerminalController.ts` | Secondary terminal controller (serious/split mode) |
| `tests/integration/terminal/TerminalOverlay.test.ts` | Integration tests for TerminalOverlay clipboard |
| `tests/integration/terminal/SeriousTerminalController.test.ts` | Integration tests for SeriousTerminalController clipboard |
| `tests/setup/xterm-mock.ts` | Mock Terminal class used in tests |
| `package.json` | Dependency versions |

## Development Workflow

### 1. Upgrade dependencies

```bash
npm install @xterm/xterm@^6.0.0 @xterm/addon-fit@^0.11.0
```

### 2. Run tests (before changes)

```bash
npx vitest run tests/integration/terminal/
```

### 3. Make changes

Modify the key handler in both controllers:
- `TerminalOverlay.ts` line ~1165: Change Ctrl+C from `return true` to direct clipboard write
- `SeriousTerminalController.ts` line ~745: Same change

Remove from both controllers:
- `attachTerminalCopyListener()` method
- `detachTerminalCopyListener()` method
- `terminalCopyHandler` property
- All calls referencing these

### 4. Run tests (after changes)

```bash
npx vitest run tests/integration/terminal/
```

### 5. Build and verify

```bash
npm run build
```

### 6. Manual verification checklist

- [ ] Select text in terminal → Ctrl+C → paste into external app → correct text
- [ ] Double-click word → Ctrl+C → paste → correct word
- [ ] No selection → Ctrl+C → SIGINT sent (process interrupted)
- [ ] Ctrl+V → clipboard text appears in terminal
- [ ] Multi-line paste → all lines preserved
- [ ] Right-click context menu → Copy/Paste work
- [ ] Test in both game mode (TerminalOverlay) and serious mode (SeriousTerminalController)
- [ ] Verify across office switch (terminal lifecycle transition)
- [ ] Verify in fleet mode terminal

## Architecture After Change

```
KeyboardEvent (Ctrl+C)
    │
    ▼
attachCustomKeyEventHandler
    │
    ├─ hasSelection() → true → getSelection() → writeClipboardText() → return false
    │
    └─ hasSelection() → false → return true (SIGINT passthrough)
```

No more:
- ~~copy event listener on terminalDiv~~
- ~~terminalCopyHandler property~~
- ~~attachTerminalCopyListener / detachTerminalCopyListener methods~~
