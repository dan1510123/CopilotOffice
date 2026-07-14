// office-image-reply — render markdown to a PNG inside the agent's working
// directory and print the CopilotOffice image sentinel.
//
// Usage:
//   node render-markdown-image.mjs --cwd "<workingDir>" [--input <file.md>] [--out-dir .office-images]
//   echo "# hi" | node render-markdown-image.mjs --cwd "<workingDir>"
//
// Behavior:
//   1. Reads markdown from --input <file> or stdin.
//   2. Renders it (marked → styled HTML → Playwright Chromium screenshot).
//   3. Saves <cwd>/<out-dir>/reply-<timestamp>.png.
//   4. Prints EXACTLY one sentinel line to stdout:
//        <!--office-image:<out-dir>/reply-<timestamp>.png-->
//      The path is RELATIVE to the working directory — CopilotOffice rejects
//      absolute paths and `..` traversal for security.
//
// Node resolves marked/playwright from THIS folder's node_modules, so the
// script works regardless of the agent's own working directory.

import { chromium } from 'playwright';
import { marked } from 'marked';
import * as fs from 'node:fs';
import * as path from 'node:path';

function parseArgs(argv) {
  const args = { cwd: process.cwd(), input: null, outDir: '.office-images', visible: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd') args.cwd = argv[++i];
    else if (a === '--input') args.input = argv[++i];
    else if (a === '--out-dir') args.outDir = argv[++i];
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

function pageHtml(bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
           padding: 28px; width: 760px; color: #24292f; background: #ffffff; }
    h1 { font-size: 28px; border-bottom: 1px solid #d0d7de; padding-bottom: 8px; }
    h2 { font-size: 21px; margin-top: 24px; }
    h3 { font-size: 17px; }
    table { border-collapse: collapse; margin: 12px 0; }
    th, td { border: 1px solid #d0d7de; padding: 6px 13px; }
    th { background: #f6f8fa; }
    code { background: #eff1f3; padding: 2px 6px; border-radius: 6px;
           font-family: "Cascadia Code", Consolas, monospace; font-size: 90%; }
    pre { background: #f6f8fa; padding: 16px; border-radius: 8px; overflow: auto; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #d0d7de; margin: 0; padding: 0 16px; color: #57606a; }
    ul, ol { padding-left: 22px; }
    img { max-width: 100%; }
  </style></head><body>${bodyHtml}</body></html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const md = args.input ? fs.readFileSync(args.input, 'utf8') : await readStdin();
  if (!md.trim()) {
    console.error('office-image-reply: no markdown provided (use --input <file> or pipe via stdin).');
    process.exit(2);
  }

  const outDirAbs = path.resolve(args.cwd, args.outDir);
  fs.mkdirSync(outDirAbs, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `reply-${stamp}.png`;
  const outAbs = path.join(outDirAbs, fileName);

  const bodyHtml = marked.parse(md);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.setContent(pageHtml(bodyHtml), { waitUntil: 'networkidle' });
    const el = await page.$('body');
    await el.screenshot({ type: 'png', path: outAbs });
  } finally {
    await browser.close();
  }

  // Relative POSIX-style path for the sentinel (CopilotOffice resolves it against workingDir).
  const rel = path.join(args.outDir, fileName).replace(/\\/g, '/');
  // Optional visible affordance (for testing): a human-visible line the agent can keep
  // in its reply so the attachment is confirmable at a glance. The sentinel itself is
  // an HTML comment and stays invisible in both the CLI and Teams.
  if (args.visible) process.stdout.write(`📎 image attached (${rel})\n`);
  process.stdout.write(`<!--office-image:${rel}-->\n`);
}

main().catch((e) => {
  console.error('office-image-reply: render failed:', e?.message ?? e);
  process.exit(1);
});
