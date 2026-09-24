# Copilot Office — Presentation

A **Marp** (Markdown → slides) deck for Copilot Office. Fully offline once
`marp-cli` is cached. Source of truth: [`CopilotOffice.md`](./CopilotOffice.md).

**Speaker notes** live in two places:
- Embedded in `CopilotOffice.md` as Marp presenter notes (these export to the
  PowerPoint notes pane on build).
- A standalone, editable copy in [`SpeakerNotes.md`](./SpeakerNotes.md) for
  review and rehearsal. Edits there don't auto-sync to the deck — mirror them
  back into `CopilotOffice.md` if you want them in the exported PPTX.

## Edit

Best experience: install the **Marp for VS Code** extension
(`marp-team.marp-vscode`) — live preview + export straight from the editor.

## Build (PPTX + PDF + HTML)

From the repo root or this folder:

```bash
# One-off, no install (downloads marp-cli once, then works offline)
npx --yes @marp-team/marp-cli presentation/CopilotOffice.md -o presentation/CopilotOffice.pptx
npx --yes @marp-team/marp-cli presentation/CopilotOffice.md -o presentation/CopilotOffice.pdf
npx --yes @marp-team/marp-cli presentation/CopilotOffice.md -o presentation/CopilotOffice.html

# Or use the helper script (builds all three, auto-detects a browser)
pwsh presentation/build.ps1
```

> **Browser note:** HTML export needs no browser. **PPTX/PDF** export drives a
> headless Chromium. marp-cli's bundled puppeteer can fail to launch on some
> Node versions (seen with Node 25) or when it hands off to a running Edge —
> the symptom is `Failed to launch the browser process: Code: 0` with empty
> stderr. Fix: pass a clean Chromium explicitly, e.g.
> `--browser-path "<...>\ms-playwright\chromium-*\chrome-win*\chrome.exe"`.
> `build.ps1` does this auto-detection for you (prefers Playwright's Chromium,
> falls back to installed Edge/Chrome).

## Present

- **HTML**: open `CopilotOffice.html` in any browser, press `F` for fullscreen.
- **PPTX**: open in PowerPoint (editable, Microsoft-native).
- **PDF**: open anywhere, present page-by-page.

## Notes

- Format is **16:9 landscape** (`size: 16:9` in the front-matter).
- Theme is `uncover` with a dark GitHub-style palette; tweak the `style:` block
  in the front-matter to restyle.
- Generated output files (`.pptx`, `.pdf`, `.html`) are git-ignored.
