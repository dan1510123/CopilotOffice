// office-file-reply — write a CSV inside the agent's working directory and print
// the CopilotOffice file sentinel.
//
// Usage:
//   node emit-csv-attachment.mjs --cwd "<workingDir>" [--input <file>] \
//        [--out-dir .office-files] [--name data] [--from-markdown] [--visible]
//
// Behavior:
//   1. Reads content from --input <file>, or from stdin if --input is omitted.
//   2. If --from-markdown is set, converts a GitHub-style markdown table to CSV.
//      Otherwise the input is treated as already-CSV and written verbatim.
//   3. Saves <cwd>/<out-dir>/<name>-<timestamp>.csv.
//   4. Prints EXACTLY one sentinel line to stdout:
//        <!--office-file:<out-dir>/<name>-<timestamp>.csv-->
//      The path is RELATIVE to the working directory — CopilotOffice rejects
//      absolute paths and ".." traversal for security.

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    cwd: process.cwd(),
    input: null,
    outDir: '.office-files',
    name: 'data',
    fromMarkdown: false,
    visible: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd') args.cwd = argv[++i];
    else if (a === '--input') args.input = argv[++i];
    else if (a === '--out-dir') args.outDir = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--from-markdown') args.fromMarkdown = true;
    else if (a === '--visible') args.visible = true;
  }
  return args;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
  });
}

// Escape a single CSV field per RFC 4180: quote if it contains comma, quote,
// CR, or LF; double any embedded quotes.
function csvField(value) {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Convert a GitHub-style markdown table to CSV text. Rows are lines containing
// pipes; the header separator row (dashes/colons only) is dropped. Leading and
// trailing pipes are trimmed before splitting on unescaped pipes.
function markdownTableToCsv(md) {
  const lines = md
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.includes('|'));

  const rows = [];
  for (const line of lines) {
    const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
    const cells = trimmed.split('|').map((c) => c.trim());
    // Skip the header separator row (e.g. |---|:--:|---|).
    const isSeparator = cells.every((c) => /^:?-+:?$/.test(c));
    if (isSeparator) continue;
    rows.push(cells.map(csvField).join(','));
  }
  return rows.join('\r\n') + (rows.length ? '\r\n' : '');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = args.input ? fs.readFileSync(args.input, 'utf8') : await readStdin();
  if (!raw.trim()) {
    console.error('office-file-reply: no content provided (use --input <file> or pipe via stdin).');
    process.exit(2);
  }

  const csv = args.fromMarkdown ? markdownTableToCsv(raw) : raw;
  if (!csv.trim()) {
    console.error('office-file-reply: no rows produced from input.');
    process.exit(2);
  }

  const outDirAbs = path.resolve(args.cwd, args.outDir);
  fs.mkdirSync(outDirAbs, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = String(args.name).replace(/[^A-Za-z0-9._-]/g, '_');
  const fileName = `${safeName}-${stamp}.csv`;
  const outAbs = path.join(outDirAbs, fileName);

  fs.writeFileSync(outAbs, csv, 'utf8');

  // Relative POSIX-style path for the sentinel (CopilotOffice resolves it against workingDir).
  const rel = path.join(args.outDir, fileName).replace(/\\/g, '/');
  // Optional visible affordance (for testing): a human-visible line the agent can keep
  // in its reply so the attachment is confirmable at a glance. The sentinel itself is
  // an HTML comment and stays invisible in both the CLI and Teams.
  if (args.visible) process.stdout.write(`📎 file attached (${rel})\n`);
  process.stdout.write(`<!--office-file:${rel}-->\n`);
}

main().catch((e) => {
  console.error('office-file-reply: failed:', e?.message ?? e);
  process.exit(1);
});
