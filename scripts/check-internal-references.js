#!/usr/bin/env node
/**
 * pre-push guard: scans the commits being pushed for "internal references"
 * (configurable patterns in internal-references.config.json) and blocks the
 * push if any are found in added lines.
 *
 * Invoked by .githooks/pre-push. Git passes `<remote-name> <remote-url>` as
 * argv and the ref updates on stdin, one per line:
 *   <local ref> <local oid> <remote ref> <remote oid>
 *
 * Bypass with:  SKIP_INTERNAL_REF_CHECK=1 git push ...   (or git push --no-verify)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ZERO = '0000000000000000000000000000000000000000';
const REPO_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'internal-references.config.json');

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const patterns = (raw.patterns || []).map((p) => ({ name: p.name || p.regex, re: new RegExp(p.regex, 'i') }));
  const allowlist = (raw.allowlist || []).map((a) => new RegExp(a, 'i'));
  const ignorePaths = raw.ignorePaths || [];
  return { patterns, allowlist, ignorePaths };
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Commits reachable from localOid that aren't yet on the remote. */
function commitsForPush(localOid, remoteOid) {
  if (localOid === ZERO) return []; // branch deletion
  try {
    const range = remoteOid && remoteOid !== ZERO
      ? [`${remoteOid}..${localOid}`]
      : [localOid, '--not', '--remotes'];
    const out = git(['rev-list', ...range]);
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [localOid];
  }
}

function isIgnored(file, ignorePaths) {
  return ignorePaths.some((p) => file === p || file.startsWith(p));
}

function main() {
  if (process.env.SKIP_INTERNAL_REF_CHECK === '1') {
    console.error('[internal-refs] skipped via SKIP_INTERNAL_REF_CHECK=1');
    process.exit(0);
  }

  const { patterns, allowlist, ignorePaths } = loadConfig();
  if (patterns.length === 0) process.exit(0);

  const shas = new Set();
  for (const line of readStdin().split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [, localOid, , remoteOid] = parts;
    commitsForPush(localOid, remoteOid).forEach((s) => shas.add(s));
  }

  const violations = [];
  for (const sha of shas) {
    let patch;
    try {
      patch = git(['show', '--no-color', '--unified=0', '--format=', sha]);
    } catch {
      continue;
    }
    let file = '(unknown)';
    let lineNo = 0;
    for (const l of patch.split('\n')) {
      if (l.startsWith('+++ b/')) { file = l.slice(6); continue; }
      const hunk = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (hunk) { lineNo = parseInt(hunk[1], 10); continue; }
      if (l.startsWith('+') && !l.startsWith('+++')) {
        const content = l.slice(1);
        if (!isIgnored(file, ignorePaths)) {
          for (const p of patterns) {
            const m = content.match(p.re);
            if (m && !allowlist.some((a) => a.test(m[0]))) {
              violations.push({ sha: sha.slice(0, 8), file, lineNo, pattern: p.name, match: m[0], content: content.trim().slice(0, 160) });
            }
          }
        }
        lineNo++;
      }
    }
  }

  if (violations.length === 0) {
    console.error('[internal-refs] no internal references found in pushed commits.');
    process.exit(0);
  }

  console.error('\n\u001b[31m✖ Push blocked: internal references detected in outgoing commits.\u001b[0m\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.lineNo} (${v.sha})  [${v.pattern}] -> "${v.match}"`);
    console.error(`    ${v.content}`);
  }
  console.error('\nFix the references (or update internal-references.config.json / allowlist),');
  console.error('then push again. To bypass intentionally: SKIP_INTERNAL_REF_CHECK=1 git push  (or git push --no-verify)\n');
  process.exit(1);
}

main();
