// Main-process helper that renders a markdown reply to a PNG by invoking the
// existing skill renderer as a node child process (spec 018, FR-007). Isolated
// from teamsService and fully injectable so the finalize hook stays testable and
// the side effect is contained. See contracts/render-child-process.md.
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
  /** True iff the skill renderer + its playwright dependency are resolvable (R1 pre-check). */
  isAvailable(): boolean;
  /** Render `markdown` to a PNG under `workingDir/.office-images`; return its sentinel. */
  render(markdown: string, workingDir: string): Promise<AutoRenderResult>;
}

export interface CreateAutoImageRendererOptions {
  /** Absolute path to render-markdown-image.mjs (default: resolve under .github/skills/...). */
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

/** Resolve the default renderer script path under the repo's skills folder. */
function defaultRendererPath(): string {
  // electron/teams/autoImageRenderer.ts → repo root is two levels up.
  return path.resolve(
    __dirname,
    '..',
    '..',
    '.github',
    'skills',
    'office-image-teams-reply',
    'render-markdown-image.mjs',
  );
}

/** Best-effort capability probe: renderer script exists AND its playwright dep resolves. */
function defaultProbe(rendererPath: string): boolean {
  try {
    if (!fs.existsSync(rendererPath)) return false;
    const skillDir = path.dirname(rendererPath);
    const playwrightPkg = path.join(skillDir, 'node_modules', 'playwright', 'package.json');
    return fs.existsSync(playwrightPkg);
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
    if (cachedAvailable === null) {
      try {
        cachedAvailable = probe();
      } catch {
        cachedAvailable = false;
      }
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
        child = spawnFn(process.execPath, [rendererPath, '--cwd', cwd], {
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
        warn(`autoImageRenderer: render timed out after ${timeoutMs}ms — killing child.`);
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
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
