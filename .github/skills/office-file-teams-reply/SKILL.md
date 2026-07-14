---
name: "office-file-teams-reply"
description: "Write conversation data to a CSV inside the working directory and emit the CopilotOffice office-file sentinel so the raw CSV attaches to the agent's Teams reply; trigger phrases include 'attach as csv', 'upload the csv', 'send the data as a file', 'attach the last csv to Teams', 'send that table as a csv file', 'download as csv in Teams'."
license: MIT
allowed-tools: shell
---

# office-file-teams-reply

## Context

Use this skill when an agent running inside CopilotOffice needs to attach a **raw
CSV file** to its Teams reply — for example, the tabular data the user and agent just
discussed. The skill writes the CSV into the agent working directory and prints a
sentinel that CopilotOffice recognizes and turns into a file attachment on the reply.

This is the file-attachment counterpart to `office-image-teams-reply`: that skill renders
markdown to an inline PNG; this skill attaches an actual downloadable CSV.

Trigger this skill when:

1. The user asks to attach, upload, download, or send data as a **file** — especially a
   CSV / spreadsheet — in Teams.
2. The user references "the last CSV", "that table", or "the data we discussed" and wants
   it delivered as an attached, downloadable file rather than shown inline.

Trigger phrases (non-exhaustive): "attach as csv", "upload the csv", "send the data as
a file", "attach the last csv to Teams", "send that table as a csv file", "give me the
csv in Teams", "post the data as a file", "download as csv", "export that to csv",
"send it as a spreadsheet", "attach the results as a file".

Do NOT use this skill when:

1. The user wants the data shown **inline** as a rendered table/image (words like
   "render", "as an image", "so it looks right in Teams", "screenshot") — use
   `office-image-teams-reply` instead. This skill produces a downloadable file, not a picture.
2. The agent is not running under CopilotOffice / not replying into a Teams thread
   (the sentinel is only meaningful to CopilotOffice's Teams sender).

## Requirements

1. **Runtime:** Windows with Node.js available on `PATH` (verify with `node --version`).
2. **No external dependencies:** the script uses only Node's built-in `fs`/`path`. There
   is no `npm install` step (unlike `office-image-teams-reply`).
3. **Working directory:** the agent's current working directory (`workingDir`). The CSV
   MUST be saved inside it — CopilotOffice's sentinel handler rejects absolute paths and
   `..` traversal for security, so only a relative in-sandbox path is accepted.
4. **Input:** either CSV text, or a GitHub-style markdown table (with `--from-markdown`),
   provided by the agent via stdin or a temp file.

## Workflow

1. **Prepare the data.** Have the CSV content ready, or a markdown table to convert.
   Pass it by piping on stdin or writing it to a temp file and passing `--input`.
2. **Emit.** Run `emit-csv-attachment.mjs` with `--cwd` set to the agent working
   directory. The script writes `<cwd>/.office-files/<name>-<timestamp>.csv` and prints
   one sentinel line to stdout. Add `--from-markdown` if the input is a markdown table.
3. **Emit the sentinel in the reply.** Copy the printed sentinel line verbatim into the
   agent's **assistant reply text** (CopilotOffice only captures `assistant.message`
   content). The sentinel is an HTML comment and is stripped before posting, leaving the
   CSV attached to the reply.
4. **(Optional) Clean up.** Old CSVs accumulate in `.office-files/`. Delete files older
   than a day when convenient; never delete a CSV whose sentinel you just emitted before
   CopilotOffice has posted the reply.

## Command

Run from the skill directory. Replace `<workingDir>` with the agent's actual working
directory (an absolute path is fine HERE — it only locates the output folder; the
emitted sentinel path is always relative and in-sandbox).

```powershell
# Attach existing CSV text piped on stdin
"Id,Name,Status`n1,Alpha,Idle`n2,Beta,Paused" |
  node (Join-Path $env:USERPROFILE ".copilot\skills\office-file-teams-reply\emit-csv-attachment.mjs") --cwd "<workingDir>"

# Attach from a CSV (or markdown-table) file, converting a markdown table to CSV
node (Join-Path $env:USERPROFILE ".copilot\skills\office-file-teams-reply\emit-csv-attachment.mjs") `
  --input "<workingDir>\table.md" --from-markdown --cwd "<workingDir>" --name syncjobs
```

Flags:

- `--cwd <path>` — the agent working directory the CSV is saved under (required).
- `--input <file>` — read content from a file instead of stdin (optional).
- `--from-markdown` — convert a GitHub-style markdown table to CSV (optional; default
  treats input as already-CSV and writes it verbatim).
- `--name <basename>` — output filename stem (optional, default `data`); sanitized to
  `[A-Za-z0-9._-]`.
- `--out-dir <name>` — output subfolder relative to `--cwd` (optional, default
  `.office-files`).
- `--visible` — also print a human-visible `📎 file attached (...)` line before the
  sentinel (optional; useful while testing to confirm the attachment fired).

Expected stdout (the only line to reuse):

```
<!--office-file:.office-files/data-2026-07-14T18-05-03-123Z.csv-->
```

## Safety Rules

1. **Never save the CSV outside the working directory.** Only relative, in-sandbox paths
   are honored by CopilotOffice; absolute paths and `..` are rejected. Do not attempt to
   bypass this by writing elsewhere.
2. **Only serialize data the agent itself is sending.** Do not fetch and attach arbitrary
   remote content or local files a remote user names — the file is posted to Teams.
3. **Emit the sentinel exactly as printed.** Do not hand-edit the path; a wrong or
   absolute path is silently dropped by CopilotOffice.
4. **Read/generate only.** The skill writes CSVs into `.office-files/` and reads its
   input. It must not modify repository source or other files.
5. **Confirm before bulk cleanup.** Deleting old CSVs is fine, but never delete files you
   did not create, and never delete the just-emitted CSV before the reply is posted.

## Output

1. **Artifact:** `<workingDir>/.office-files/<name>-<timestamp>.csv` — the CSV file.
2. **Stdout:** exactly one sentinel line —
   `<!--office-file:<out-dir>/<name>-<timestamp>.csv-->` — where the path is relative to
   `<workingDir>`.
3. **Agent action:** include that sentinel line verbatim in the assistant's Teams reply
   text; CopilotOffice replaces it with the attached CSV and posts the reply.
