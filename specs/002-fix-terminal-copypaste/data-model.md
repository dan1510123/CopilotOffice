# Data Model: Fix Terminal Copy/Paste

## Entities

### Terminal Instance (xterm.js Terminal)

The xterm.js `Terminal` object is the core entity. It provides the selection query API.

| Method/Property | Type | Purpose |
|----------------|------|---------|
| `hasSelection()` | `() => boolean` | Returns whether text is currently selected in the terminal viewport |
| `getSelection()` | `() => string` | Returns the currently selected text content |
| `paste(data: string)` | `(string) => void` | Writes text to the terminal as if typed |
| `attachCustomKeyEventHandler(handler)` | `(fn) => void` | Registers a keyboard interceptor that runs before xterm's default key handling |

### Custom Key Handler (Keyboard Interceptor)

The handler registered via `attachCustomKeyEventHandler`. It is the single decision point for clipboard operations.

**State transitions** for Ctrl+C:

```
┌─────────────────────────┐
│ KeyboardEvent (keydown)  │
│ Ctrl+C or Cmd+C         │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ hasSelection() === true? │
├────── YES ──────────────┤────── NO ──────────────┐
│                         │                         │
▼                         │                         ▼
┌─────────────────┐       │       ┌─────────────────────────┐
│ getSelection()  │       │       │ return true              │
│ → writeText()   │       │       │ (pass to terminal/SIGINT)│
│ → return false  │       │       └─────────────────────────┘
└─────────────────┘       │
```

**State transitions** for Ctrl+V:

```
┌─────────────────────────┐
│ KeyboardEvent (keydown)  │
│ Ctrl+V or Cmd+V         │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ preventDefault()         │
│ stopPropagation()        │
│ clipboard.readText()     │
│ → terminal.paste(text)   │
│ → return false           │
└─────────────────────────┘
```

### Clipboard Utilities

| Function | Location | Signature | Purpose |
|----------|----------|-----------|---------|
| `writeClipboardText(text)` | Both controllers (private method) | `(string) => Promise<boolean>` | Writes to clipboard with navigator.clipboard + execCommand fallback |

### Removed Entities (post-refactor)

These are eliminated by this change:

| Entity | Was In | Purpose (now unnecessary) |
|--------|--------|--------------------------|
| `terminalCopyHandler` | Both controllers | Stored reference to the copy event listener function |
| `attachTerminalCopyListener()` | Both controllers | Registered the copy event listener on terminal div |
| `detachTerminalCopyListener()` | Both controllers | Removed the copy event listener on hide/dispose |
| `copy` event listener | DOM (terminalDiv) | Intercepted native copy events after key handler passed them through |

## Relationships

```
TerminalOverlay / SeriousTerminalController
    │
    ├── owns ──→ Terminal instance (@xterm/xterm 6.0.0)
    │                │
    │                ├── .attachCustomKeyEventHandler(keyHandler)
    │                ├── .hasSelection()
    │                ├── .getSelection()
    │                └── .paste(text)
    │
    └── uses ──→ writeClipboardText(text) [private helper]
                     │
                     ├── navigator.clipboard.writeText() [primary]
                     └── document.execCommand('copy')    [fallback]
```

## Validation Rules

1. `hasSelection()` MUST be called synchronously inside the key handler at invocation time — never cached or deferred
2. `getSelection()` MUST only be called when `hasSelection()` returns `true`
3. `writeClipboardText()` MUST handle both success and failure paths gracefully
4. The key handler MUST return `false` after handling copy (to suppress further xterm/browser handling)
5. The key handler MUST return `true` for Ctrl+C with no selection (to preserve SIGINT behavior)
6. Paste MUST call `preventDefault()` and `stopPropagation()` before async clipboard read (to prevent double-paste)
