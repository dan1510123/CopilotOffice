================================================================================
DETAILED CODE SNIPPETS FOR SOFT RELOAD BUG
================================================================================

1. SOFT RELOAD MECHANISM (Ctrl+R)
================================================================================

File: src/input/GlobalInputListener.ts (`preReloadCleanup()` and `onKeydown()`)
────────────────────────────────────────────────────────────────────────────────

    // Ctrl+R — soft reload: keep terminal server alive, only reload UI
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
      e.preventDefault();
      e.stopPropagation();
      console.log('[GlobalInput] Ctrl+R — soft reload (keeping terminal server)');
      preReloadCleanup();
      window.location.reload();
    }

NOTE: preReloadCleanup() removes IPC listeners but doesn't clear 
      the TerminalOverlay instance or xterm terminal.


File: electron/main.ts (`did-start-navigation` handler)
──────────────────────────────────────────────────────────

    mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace) => {
      if (isInPlace && pendingHardReload) {
        console.log('[Main] Hard reload — restarting terminal server');
        pendingHardReload = false;
        relay.shutdown().then(() =>
          relay.spawnServer(__dirname)
        ).catch((e) =>
          console.error('[Main] Failed to respawn after reload:', e)
        );
      } else if (isInPlace) {
        console.log('[Main] Soft reload — keeping terminal server alive');
      }
    });

KEY: When isInPlace=true and pendingHardReload=false, the terminal server is 
     kept alive. The PTY processes continue running in the server process.


2. TERMINAL REATTACHMENT FLOW (THE BUG)
================================================================================

File: src/ui/TerminalOverlay.ts (`show()` method — reattach path)
─────────────────────────────────────────────────────────────────

    // Create or reuse terminal
    if (!this.terminal) {
      this.createTerminal();
    } else {
      // Reusing existing terminal for a returning session — clear screen but 
      // preserve state
      this.terminal.clear();  // ← BUG #1: Clears display but not cursor state
    }

    // Reset session ID for this agent
    this.sessionId = null;

    // Check if terminal session exists, if not start one
    if (window.copilotBridge) {
      try {
        const exists = await withTimeout(
          window.copilotBridge.terminalExists(agent.id),
          IPC_TIMEOUT, 'terminalExists'
        );
        if (!exists) {
          await this.startNewSession(agent.id, agent.workingDir);
        } else {
          // Session exists - reattach by triggering a resize (SIGWINCH), which 
          // forces the Copilot CLI TUI to fully redraw at the correct dimensions 
          // and cursor position.
          // Do NOT replay raw scrollback — it fights with the live PTY cursor 
          // position.
          await withTimeout(
            window.copilotBridge.terminalAttach(agent.id),  // ← BUG #2: Response has scrollback that's IGNORED
            IPC_TIMEOUT, 'terminalAttach'
          );

          // Notify main.ts to refresh this agent's badge status
          this.scene.game.events.emit('agent:reattached', agent.id);

          // Do NOT fit() here — the container may not be visible/laid out yet.
          // All sizing is deferred to the post-layout rAF block below.

          // Try to get saved session ID
          const savedId = await withTimeout(
            window.copilotBridge.getSessionId(agent.id),
            IPC_TIMEOUT, 'getSessionId'
          );
          if (savedId) {
            this.sessionId = savedId;
            this.updateSessionDisplay();
          }
        }
      } catch (e) {
        this.terminal?.writeln(\\r\n\x1b[31m[\]\x1b[0m\r\n\);
      }
      
      // Resize terminal — use debouncedRefit for multi-stage layout settling
      if (this.fitAddon && this.terminal) {
        this.terminal.focus();  // ← BUG #3: Focus before layout settled & xterm in wrong state
        this.debouncedRefit();
      }
    }

    this.isVisible = true;

PROBLEM SUMMARY:
- `clear()` wipes display but doesn't sync xterm cursor with PTY cursor
- `terminalAttach()` returns scrollback but it's never written back
- `focus()` is called while xterm state is wrong

WHAT SHOULD HAPPEN:
- After clear(), xterm should be reset or scrollback should be replayed
- terminalAttach() response has scrollback (raw string) that should be written to terminal
- focus() should only happen after terminal state matches PTY state


3. SERVER ATTACH HANDLER (Returns scrollback)
================================================================================

File: electron/terminal/server.ts (`attach` handler)
──────────────────────────────────────────────────────

    case 'attach': {
      console.log(`[TermServer] Attaching viewer for ${ck}`);
      activeAgentViewers.add(ck);
      const chunks = agentScrollbackBuffers.get(ck) || [];
      const rawScrollback = chunks.join('');
      send({ type: 'response', requestId: msg.requestId, result: { 
        success: true, scrollback: rawScrollback 
      } });
      break;
    }

THE SERVER CORRECTLY PROVIDES THE SCROLLBACK! But the renderer ignores it.

The scrollback is built up in the PTY data handler:

    proc.onData((data: string) => {
      appendToScrollback(agentId, data);  // ← Accumulates all PTY output
      ...
    });

Where `appendToScrollback()` stores raw data as byte-counted chunks:

    function appendToScrollback(agentId: string, data: string): void {
      let buf = agentScrollbackBuffers.get(agentId);
      if (!buf) {
        buf = [];
        agentScrollbackBuffers.set(agentId, buf);
        agentScrollbackBytes.set(agentId, 0);
      }
      buf.push(data);
      const currentBytes = (agentScrollbackBytes.get(agentId) || 0) + data.length;
      agentScrollbackBytes.set(agentId, currentBytes);
      // Trim oldest chunks if over byte limit
      while ((agentScrollbackBytes.get(agentId) || 0) > MAX_BUFFER_BYTES && buf.length > 1) {
        const removed = buf.shift()!;
        agentScrollbackBytes.set(agentId,
          (agentScrollbackBytes.get(agentId) || 0) - removed.length);
      }
    }

STORAGE: const MAX_BUFFER_BYTES = 512 * 1024; // 512 KB (byte-based, not line-based)
Scrollback is returned as a single joined string on attach, not an array of lines.


4. TERMINAL CREATION & INITIALIZATION
================================================================================

File: src/ui/TerminalOverlay.ts (`createTerminal()` method)
───────────────────────────────────────────────────────────

    private createTerminal(): void {
      if (!this.terminalDiv) return;

      this.terminal = new Terminal({
        theme: {
          background: '#0a0a14',
          foreground: '#e0e0e0',
          cursor: '#00ff88',
          cursorAccent: '#0a0a14',
          selectionBackground: '#3a5a8a',
          // ... 16 colors defined
        },
        fontFamily: 'Cascadia Code, Consolas, Monaco, monospace',
        fontSize: 16,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 10000,
        allowProposedApi: true,
      });

      this.fitAddon = new FitAddon();
      this.terminal.loadAddon(this.fitAddon);

      this.terminal.open(this.terminalDiv);  // ← xterm initializes HERE
      this.fitAddon.fit();

      // Handle terminal input
      this.terminal.onData((data: string) => {
        if (this.currentAgentId && window.copilotBridge) {
          window.copilotBridge.terminalWrite(this.currentAgentId, data);
        }
      });

      // Handle resize — store reference for cleanup in destroy()
      this.resizeHandler = () => {
        if (this.isVisible) {
          this.debouncedRefit();
        }
      };
      window.addEventListener('resize', this.resizeHandler);

      // ResizeObserver catches CSS-driven panel resizes that window.resize misses
      this.resizeObserver = new ResizeObserver(() => {
        if (this.isVisible) {
          this.debouncedRefit();
        }
      });
      if (this.terminalDiv) {
        this.resizeObserver.observe(this.terminalDiv);
      }
    }

KEY POINTS:
- xterm is created fresh with new Terminal() and opened into this.terminalDiv
- Initial cursor position is (0, 0) when opened
- When reusing existing terminal after reload, createTerminal() is NOT called
- Instead, the existing instance is reused (in the reattach branch of `show()`)
- This is where the mismatch occurs


5. IPC BRIDGE & PRELOAD
================================================================================

File: electron/terminal/preload.ts (`terminalAttach` in copilotBridge)
──────────────────────────────────────────────────────────────────────

    terminalAttach: (agentId: string): Promise<{ success: boolean; 
                                                   scrollback?: string }> => {
      return ipcRenderer.invoke('terminal-attach', agentId);
    },

The type signature shows scrollback SHOULD be returned (as a raw string), but the renderer's 
TerminalOverlay.ts doesn't use it.


File: electron/terminal/ipc-relay.ts (`terminal-attach` IPC handler)
────────────────────────────────────────────────────────────────────

    ipcMain.handle('terminal-attach', (_event, agentId: string) =>
      this.request({ type: 'attach', requestId: this.id(), agentId })
    );

This registers the IPC handler and forwards to server via request().
The request() method (lines 140-152) waits for server response.


6. FOCUS & INPUT MANAGEMENT
================================================================================

File: src/input/InputManager.ts (`focusTerminalXterm()` method)
───────────────────────────────────────────────────────────────────

    focusTerminalXterm(terminal: any): void {
      console.log(\[InputManager] focusTerminalXterm() scheduled (+100ms) | 
                   time: \\);
      const attempt = (n: number, delay: number) => {
        setTimeout(() => {
          terminal?.focus();
          console.log(\[InputManager] focusTerminalXterm() attempt \ executed | 
                       time: \\);
          // Check if xterm's textarea actually received focus
          const textarea = terminal?.textarea as HTMLTextAreaElement | undefined;
          if (textarea && document.activeElement !== textarea && n < 3) {
            console.warn(\[InputManager] focus attempt \ didn't stick — 
                         retrying (+\ms)\);
            attempt(n + 1, delay * 2);
          }
        }, delay);
      };
      attempt(1, 100);
    }

TIMING:
- First focus attempt at +100ms
- Retries at +200ms, then +400ms if needed
- Logs whether xterm.textarea got focus

This works IF xterm's internal state is correct. If scrollback wasn't replayed, 
xterm's cursor position is wrong and input handling fails.


File: src/ui/TerminalOverlay.ts (`focusTerminal()` method)
───────────────────────────────────────────────────────────

    focusTerminal(): void {
      console.log('[TerminalOverlay] focusTerminal() — delegating to InputManager');
      this.inputManager.switchToTerminal(
        'TerminalOverlay.focusTerminal()',
        () => this.handleNewSession(),
        () => this.toggleFullWidth()
      );
      this.inputManager.focusTerminalXterm(this.terminal);

      // Restore NPC highlight for the active agent
      if (this.currentAgent) {
        this.scene.game.events.emit('npc:highlight', this.currentAgent.id);
        // Restore sprite canvas glow
        const spriteCanvas = document.getElementById('agent-sprite-canvas') 
          as HTMLCanvasElement | null;
        if (spriteCanvas) {
          const colorHex = '#' + this.currentAgent.color.toString(16)
                                  .padStart(6, '0');
          spriteCanvas.style.boxShadow = 
            \  0 18px 6px \99, 0 0 6px 2px \\;
          spriteCanvas.style.border = \2px solid \\;
        }
      }

      // Remove dimmed visual state
      this.setTerminalFocusVisual(true);
    }

This is called from `show()` after `terminalAttach()` returns.


7. CURSOR POSITIONING AFTER REATTACH
================================================================================

THE CORE ISSUE: When .clear() is called on a terminal that's already been 
written to, xterm's cursor position is (0, 0) but the PTY's cursor may be 
at a different position.

When new data arrives from the PTY, xterm writes to where it THINKS the 
cursor is, not where the PTY actually is.

EXAMPLE SCENARIO:
1. User types "ls" → PTY outputs 10 lines → xterm cursor is at row 10, col 0
2. Ctrl+R soft reload happens
3. TerminalOverlay.show() called
4. this.terminal.clear() called → xterm display clears, cursor resets to (0, 0)
5. terminalAttach() called → returns scrollback with those 10 lines
6. BUT scrollback is never written to terminal!
7. PTY sends "$ " prompt
8. xterm thinks cursor is at (0, 0) but PTY thinks it's at (10, col)
9. Text appears at (0, 0) when it should appear at (10, col)
10. Cursor blink is at (0, 0) but user expects it at (10, col)


8. DEBOUNCEDREFIT MECHANISM  
================================================================================

File: src/ui/TerminalOverlay.ts (`debouncedRefit()` method)
────────────────────────────────────────────────────────────

    private debouncedRefit(): void {
      if (!this.fitAddon || !this.terminal || !this.currentAgentId) return;

      // Cancel any pending refit timers
      for (const t of this.refitTimers) clearTimeout(t);
      this.refitTimers.length = 0;

      const doFit = () => {
        this.fitAddon?.fit();
        const dims = this.fitAddon?.proposeDimensions();
        if (dims && window.copilotBridge && this.currentAgentId) {
          window.copilotBridge.terminalResize(this.currentAgentId, 
                                               dims.cols, dims.rows);
        }
      };

      // Stage 1: immediate (next frame)
      requestAnimationFrame(() => {
        doFit();
        // Stage 2: after 150ms
        this.refitTimers.push(setTimeout(() => {
          doFit();
          // Stage 3: after 350ms
          this.refitTimers.push(setTimeout(doFit, 200));
        }, 150));
      });
    }

This does fit() + sends resize to PTY at 3 stages to catch layout settling.

The comment in the reattach path of `show()` says:
    // Do NOT fit() here — the container may not be visible/laid out yet.
    // All sizing is deferred to the post-layout rAF block below.

But focus() is still called BEFORE debouncedRefit()!


================================================================================
SUMMARY OF ALL AFFECTED LOCATIONS
================================================================================

TO FIX THE BUG, CHANGES NEEDED IN:

1. src/ui/TerminalOverlay.ts, `show()` method (reattach path)
   - Capture terminalAttach() response
   - Write scrollback to terminal if reattaching existing session
   - Defer focus() to after layout settles

2. electron/terminal/server.ts (already correct, no changes needed)
   - Already provides scrollback on attach

3. src/input/InputManager.ts (no changes needed)
   - Focus mechanism works fine if xterm state is correct

The fix is PURELY in the show() method reattachment logic.

