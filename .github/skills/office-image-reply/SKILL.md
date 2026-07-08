---
name: "office-image-reply"
description: "Render agent-provided markdown into a PNG saved inside the working directory and emit the CopilotOffice office-image sentinel so the image renders inline in the agent's Teams reply; trigger phrases include 'send as image', 'render markdown', 'render this in Teams', 'post as picture', 'make it look right in Teams', 'screenshot this reply', 'render the table as an image', 'render the code as an image'."
license: MIT
allowed-tools: shell
---

# office-image-reply

## Context

Use this skill when an agent running inside CopilotOffice needs its Teams reply to
show **richly rendered markdown** (tables, fenced code, headings, blockquotes) that
Teams' limited HTML would otherwise mangle. The skill renders markdown to a PNG and
prints a sentinel that CopilotOffice recognizes and turns into an inline Teams image.

Trigger this skill when:

1. The agent is composing a Teams reply whose content contains a markdown table,
   a fenced code block, or other structure that must render faithfully on mobile.
2. The user asks for the reply "as an image", "rendered", or "so it looks right in Teams".

Trigger phrases (non-exhaustive): "send as image", "send that as an image", "render
markdown", "render this in Teams", "render it for Teams", "post as picture", "post as
an image", "make it look right in Teams", "screenshot this reply", "render the table as
an image", "render the code as an image", "attach it as an image".

Do NOT use this skill when:

1. The output is plain prose or short text — a normal Teams reply renders that fine.
2. The agent is not running under CopilotOffice / not replying into a Teams thread
   (the sentinel is only meaningful to CopilotOffice's Teams sender).

## Requirements

1. **Runtime:** Windows with Node.js available on `PATH` (verify with `node --version`).
2. **Working directory:** the agent's current working directory (`workingDir`). The PNG
   MUST be saved inside it — CopilotOffice's sentinel handler rejects absolute paths and
   `..` traversal for security, so only a relative in-sandbox path is accepted.
3. **Skill dependencies:** `marked` and `playwright`, installed into THIS skill folder's
   `node_modules` on first run (see Workflow step 1). Playwright also needs its Chromium
   browser (`npx playwright install chromium`), a one-time download.
4. **Input:** the markdown text to render (provided by the agent via stdin or a temp file).

## Workflow

1. **Ensure dependencies (first run only).** From the skill directory, install packages
   and the Chromium browser if `node_modules` is missing:
   - `npm install` (installs `marked` + `playwright` pinned in `package.json`)
   - `npx playwright install chromium`
   Subsequent runs skip this — the local `node_modules` persists.

2. **Provide the markdown.** Pass the exact markdown the agent wants rendered, either by
   piping it on stdin or writing it to a temporary `.md` file and passing `--input`.

3. **Render.** Run `render-markdown-image.mjs` with `--cwd` set to the agent's working
   directory. The script renders markdown → styled HTML → a 2x Chromium screenshot, saves
   `<cwd>/.office-images/reply-<timestamp>.png`, and prints one sentinel line to stdout.

4. **Emit the sentinel in the reply.** Copy the printed sentinel line verbatim into the
   agent's **assistant reply text** (CopilotOffice only captures `assistant.message`
   content). Place any accompanying prose around it; the sentinel itself is an HTML
   comment and is stripped before the text is posted, leaving only the inline image.

5. **(Optional) Clean up.** Old PNGs accumulate in `.office-images/`. Delete files older
   than a day when convenient; never delete a PNG whose sentinel you just emitted before
   CopilotOffice has posted the reply.

## Command

Run from the skill directory. Replace `<workingDir>` with the agent's actual working
directory (an absolute path is fine HERE — it is only used to locate the output folder;
the emitted sentinel path is always relative and in-sandbox).

```powershell
# One-time setup (first run only)
Set-Location (Join-Path $env:USERPROFILE ".copilot\skills\office-image-reply")
npm install
npx playwright install chromium

# Render from a piped string
"# Title`n`n| A | B |`n|---|---|`n| 1 | 2 |" |
  node (Join-Path $env:USERPROFILE ".copilot\skills\office-image-reply\render-markdown-image.mjs") --cwd "<workingDir>"

# Or render from a markdown file
node (Join-Path $env:USERPROFILE ".copilot\skills\office-image-reply\render-markdown-image.mjs") `
  --input "<workingDir>\draft-reply.md" --cwd "<workingDir>"
```

Flags:

- `--cwd <path>` — the agent working directory the PNG is saved under (required).
- `--input <file>` — read markdown from a file instead of stdin (optional).
- `--out-dir <name>` — output subfolder relative to `--cwd` (optional, default `.office-images`).
- `--visible` — also print a human-visible `📎 image attached (...)` line before the sentinel
  (optional; useful while testing so you can confirm the attachment fired at a glance).

Expected stdout (the only line to reuse):

```
<!--office-image:.office-images/reply-2026-07-07T10-15-03-123Z.png-->
```

## Safety Rules

1. **Never save the PNG outside the working directory.** Only relative, in-sandbox paths
   are honored by CopilotOffice; absolute paths and `..` are rejected. Do not attempt to
   bypass this by writing elsewhere.
2. **Only render markdown the agent itself is sending.** Do not fetch and render arbitrary
   remote content or local files a remote user names — the image is posted to Teams.
3. **Emit the sentinel exactly as printed.** Do not hand-edit the path; a wrong or absolute
   path is silently dropped by CopilotOffice.
4. **Read/generate only.** The skill writes PNGs into `.office-images/` and reads its own
   dependencies. It must not modify repository source or other files.
5. **Confirm before bulk cleanup.** Deleting old PNGs is fine, but never delete files you
   did not create, and never delete the just-emitted PNG before the reply is posted.

## Output

1. **Artifact:** `<workingDir>/.office-images/reply-<timestamp>.png` — the rendered image.
2. **Stdout:** exactly one sentinel line —
   `<!--office-image:<out-dir>/reply-<timestamp>.png-->` — where the path is relative to
   `<workingDir>`.
3. **Agent action:** include that sentinel line verbatim in the assistant's Teams reply
   text; CopilotOffice replaces it with the inline image and posts the reply.
