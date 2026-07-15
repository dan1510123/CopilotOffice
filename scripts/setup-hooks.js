#!/usr/bin/env node
/**
 * Points this repo's git at the committed .githooks directory so the
 * pre-push internal-reference guard is active for everyone after `npm install`.
 * Safe to run repeatedly; no-op outside a git checkout.
 */
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: REPO_ROOT, stdio: 'ignore' });
} catch {
  process.exit(0); // not a git checkout (e.g. installed as a dependency)
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: REPO_ROOT, stdio: 'ignore' });
  // Best-effort executable bit for non-Windows checkouts.
  try {
    execFileSync('git', ['update-index', '--chmod=+x', '.githooks/pre-push'], { cwd: REPO_ROOT, stdio: 'ignore' });
  } catch { /* file may not be tracked yet */ }
  console.log('[hooks] core.hooksPath set to .githooks (internal-reference pre-push guard enabled)');
} catch (e) {
  console.warn('[hooks] could not configure git hooks:', e.message);
}
