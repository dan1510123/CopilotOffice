// Main-process helper that renders a markdown reply to a PNG by invoking the
// app-owned renderer script (electron/teams/render-markdown-image.mjs) as a node
// child process (spec 018, FR-007). Isolated from teamsService and fully
// injectable so the finalize hook stays testable and the side effect is
// contained. See contracts/render-child-process.md.
//
// This module NEVER throws: every failure path (renderer unavailable, spawn
// ENOENT, non-zero exit, timeout, no sentinel) resolves to `{ ok: false, reason }`
// so the caller can fall back to the already-posted plain-text reply (FR-008).

import { spawn as defaultSpawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { IMAGE_MARKER_SOURCE } from './imageMarker';

export interface AutoRenderResult {
  ok: boolean;
  /** Captured `<!--office-image:...-->` line (relative in-sandbox path) when ok. */
  sentinel?: string;
  /** Failure reason for logging when !ok. */
  reason?: string;
}

export interface AutoImageRenderer {
  /** True iff the app-owned renderer script + `marked` + an installed Chromium binary are resolvable (R1 pre-check). */
  isAvailable(): boolean;
  /** Render `markdown` to a PNG under `workingDir/.office-images`; return its sentinel. */
  render(markdown: string, workingDir: string): Promise<AutoRenderResult>;
}

export interface CreateAutoImageRendererOptions {
  /** Absolute path to render-markdown-image.mjs (default: the app-owned copy in electron/teams). */
  rendererPath?: string;
  /** Bounded render timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Injectable spawn for tests (defaults to child_process.spawn). */
  spawn?: typeof import('child_process').spawn;
  /** Injectable existence/resolve check for isAvailable() in tests. */
  probe?: () => boolean;
  warn?: (msg: string) => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Resolve the default renderer script path — the app-owned copy colocated in electron/teams. */
function defaultRendererPath(): string {
  // At runtime this module is bundled to dist/electron/main.js, so __dirname is
  // <repo>/dist/electron. The .mjs is NOT bundled (it is spawned as a child
  // process), so resolve it from the source tree: repo root → electron/teams.
  return path.resolve(__dirname, '..', '..', 'electron', 'teams', 'render-markdown-image.mjs');
}

/**
 * Best-effort capability probe. Returns true only when a render can plausibly
 * succeed, so the caller can skip the (expensive) child-process spawn otherwise:
 *   1. the renderer script exists,
 *   2. `marked` resolves from the app's own node_modules, AND
 *   3. an actual Chromium *browser binary* is installed.
 *
 * (3) is the check that matters: `marked` + `playwright` are declared root deps
 * (guaranteed by `npm install`), but the Chromium binary is a SEPARATE download
 * (`npx playwright install chromium`) that `npm install playwright` does NOT
 * perform. So a package-only probe would report available while `chromium.launch()`
 * still fails. We ask Playwright's own resolver for the expected binary path and
 * confirm it exists on disk — version/platform specifics handled by Playwright.
 */
function defaultProbe(rendererPath: string): boolean {
  try {
    if (!fs.existsSync(rendererPath)) return false;
    // repo root is two levels up from dist/electron (matches defaultRendererPath).
    const repoRoot = path.resolve(__dirname, '..', '..');
    if (!fs.existsSync(path.join(repoRoot, 'node_modules', 'marked', 'package.json'))) return false;
    // Lazy runtime require (playwright is marked external in the esbuild bundle) so the
    // heavy package never loads unless the probe actually runs. executablePath() returns
    // the expected Chromium path without launching a browser.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { chromium } = require('playwright') as typeof import('playwright');
    const exe = chromium.executablePath();
    return typeof exe === 'string' && exe.length > 0 && fs.existsSync(exe);
  } catch {
    return false;
  }
}

export function createAutoImageRenderer(
  opts: CreateAutoImageRendererOptions = {},
): AutoImageRenderer {
  const rendererPath = opts.rendererPath ?? defaultRendererPath();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnFn = opts.spawn ?? defaultSpawn;
  const probe = opts.probe ?? (() => defaultProbe(rendererPath));
  const warn = opts.warn ?? (() => {});

  let cachedAvailable: boolean | null = null;

  function isAvailable(): boolean {
    // Memoize only a positive result (the browser binary won't vanish mid-session).
    // A negative result is re-probed on each call — cheap fs checks — so a Chromium
    // install performed AFTER app start (`npx playwright install`) is picked up
    // without requiring a restart.
    if (cachedAvailable === true) return true;
    try {
      cachedAvailable = probe();
    } catch {
      cachedAvailable = false;
    }
    return cachedAvailable;
  }

  function render(markdown: string, workingDir: string): Promise<AutoRenderResult> {
    return new Promise<AutoRenderResult>((resolve) => {
      let settled = false;
      const done = (r: AutoRenderResult) => {
        if (settled) return;
        settled = true;
        resolve(r);
      };

      // workingDir is normalized upstream (see normalizeWorkingDir at the office/
      // register boundaries), so it can be passed straight through as the cwd.
      const cwd = workingDir;

      let child: import('child_process').ChildProcess;
      try {
        // Use process.execPath (the running node/electron node) for a robust interpreter.
        // In the Electron MAIN process, process.execPath is electron.exe, which by default
        // boots its argument as a GUI app (exiting non-zero, e.g. code 2) instead of running
        // it as Node. ELECTRON_RUN_AS_NODE=1 makes electron.exe behave as a plain Node runtime
        // so the .mjs renderer executes correctly. Harmless when execPath is already node.
        //
        // --timeout gives the child its OWN watchdog (a few seconds shorter than the parent
        // budget) so it closes its Chromium browser and exits cleanly BEFORE the parent has to
        // force-kill — preventing an orphaned chrome.exe when a render hangs (the parent's
        // SIGKILL would otherwise skip the .mjs's `browser.close()`).
        const childTimeoutMs = Math.max(1000, timeoutMs - 2000);
        child = spawnFn(process.execPath, [rendererPath, '--cwd', cwd, '--timeout', String(childTimeoutMs)], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        });
      } catch (e) {
        warn(`autoImageRenderer: spawn threw: ${(e as Error).message}`);
        done({ ok: false, reason: `spawn-error:${(e as Error).message}` });
        return;
      }

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        warn(`autoImageRenderer: render timed out after ${timeoutMs}ms — terminating child.`);
        // Graceful SIGTERM first: the .mjs handles it by closing its Chromium browser (no
        // orphaned process), then a short grace period before SIGKILL guarantees the child
        // dies even if it ignored SIGTERM. The grace timer is unref'd so it never keeps the
        // event loop alive; a SIGKILL to an already-exited child is a harmless no-op.
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
        const graceKill = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }, 2000);
        if (typeof graceKill.unref === 'function') graceKill.unref();
        done({ ok: false, reason: 'timeout' });
      }, timeoutMs);

      child.on('error', (e) => {
        clearTimeout(timer);
        warn(`autoImageRenderer: child error: ${e.message}`);
        done({ ok: false, reason: `spawn-error:${e.message}` });
      });

      child.stdout?.on('data', (c: Buffer | string) => {
        stdout += c.toString();
      });
      child.stderr?.on('data', (c: Buffer | string) => {
        stderr += c.toString();
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (code !== 0) {
          const errTail = stderr.trim();
          if (errTail) warn(`autoImageRenderer: renderer stderr: ${errTail}`);
          done({ ok: false, reason: errTail ? `exit-${code}: ${errTail.slice(-300)}` : `exit-${code}` });
          return;
        }
        // Fresh, non-shared regex — parse stdout for a valid sentinel with a non-empty path.
        const m = new RegExp(IMAGE_MARKER_SOURCE).exec(stdout);
        const capturedPath = (m?.[1] ?? '').trim();
        if (!m || !capturedPath) {
          done({ ok: false, reason: 'no-sentinel' });
          return;
        }
        done({ ok: true, sentinel: m[0] });
      });

      // Write the markdown to the child's stdin and end it (renderer reads stdin).
      try {
        child.stdin?.end(markdown);
      } catch (e) {
        // stdin write failure is non-fatal here; the close/error handler resolves.
        warn(`autoImageRenderer: stdin write failed: ${(e as Error).message}`);
      }
    });
  }

  return { isAvailable, render };
}
