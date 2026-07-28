# Quickstart: Titled Session History Entries (spec 019)

How to build, verify, and regression-test this feature. Aligns with Constitution Principle IV
(Regression-Safe Delivery) and Principle VII (Worktree-Aware Verification).

## Build & test commands

```powershell
# From repo root
npm run test            # Vitest unit + integration (primary gate for this change)
npm run build           # Rebuild dist/ (electron/* + game bundle) before manual verification
```

> **Worktree note (Principle VII)**: `dist/electron/*.js` and `dist/game.bundle.js` are
> per-worktree build artifacts. Before claiming the feature works in a running app, confirm the
> app is launched from the checkout you rebuilt (match `dist/` timestamps and grep the bundle for
> a distinctive new marker such as the `Untitled session` history fallback string).

## Automated verification (add/extend under `tests/`)

Server / persistence (unit, `tests/unit/terminal/` — pure helpers, no Electron):

1. **Archive snapshots current title** — set `sessionMeta` title, call `archiveSessionId`, assert
   the pushed entry is `{ id, title }` with the snapshot value.
2. **Archive of untitled session** — no `sessionMeta` title (or empty/whitespace) → entry is
   `{ id }` with `title` undefined.
3. **Title immutability** — archive a titled session, then change the *current* `sessionMeta`
   title; assert the archived entry's title is unchanged (FR-002).
4. **Legacy coercion** — load a `history` of bare strings; assert it becomes `{ id }[]` with no
   entry lost, and re-save writes the object shape (FR-006, SC-004).
5. **Empty-title normalization** — a persisted `{ id, title: "   " }` loads as `title` undefined.
6. **Dedupe on re-archive** — archiving an `id` already present does not append a duplicate and
   does not overwrite an existing real title with an empty one.
7. **Clear removes titles** — `clear-session-history` deletes the agent's entries entirely; no
   residual title data (FR-008).
8. **Transfer carries titles** — `transfer-session` copies entries with titles intact into the
   destination office (FR-009).

Renderer (unit/jsdom, mirror across BOTH surfaces — FR-014):

9. **Titled entry renders title + id** — given `[{id, title}]`, the row shows the title text and
   the exact id (id span `user-select: all`).
10. **Untitled entry renders fallback** — given `[{id}]`, the row shows `Untitled session` and no
    `undefined`/blank/error text (FR-005, SC-002).
11. **XSS / literal text** — a title containing `<img src=x onerror=...>` / markup is rendered as
    literal text, not as DOM markup (FR-010). Assert no injected element is created.
12. **Long-title layout** — an over-long title sets the `title` (tooltip) attribute to the full
    string and uses ellipsis styling; the popover width does not change (FR-012a).
13. **Ordering preserved** — entries render most-recent-first with `#N` numbering (FR-013).

Bridge mock: `tests/setup/copilot-bridge-mock.ts` default `getSessionHistory` stays `[]`;
populated-history tests pass entry objects.

## Manual verification (Independent Tests from the spec)

1. **US1 – recognize at a glance**: Start an agent, send a message that produces a title, start a
   New Session for the same agent (archives the previous), open **Session History** → the
   archived entry shows the title next to its ID. Copy the ID → it pastes as the exact unmodified
   UUID.
2. **US2 – legacy/untitled**: Point the app at pre-019 `.data/{officeId}.sessions.json` (history
   as bare strings), open Session History → every legacy entry shows its ID + `Untitled session`,
   nothing lost, no errors. Archive a session while it has no title → same fallback.
3. **US3 – persistence & transfer**: Archive a titled session, fully quit and relaunch, reopen
   Session History → same title/ID pairing (SC-005). Give the *current* session a new title →
   the archived entry keeps its original title. Transfer the agent to another office → archived
   titles travel. Clear History → titles gone with the IDs.
4. **Long title**: Archive a session whose title is near 80 chars; open history → title is
   ellipsis-truncated on one line, hovering shows the full title, the popover does not widen,
   wrap, or scroll horizontally.
5. **Both surfaces**: Verify the same title/ID pairing in both the `TerminalOverlay` popover and
   the `SeriousTerminalController` popover (FR-014).

## Files changed (checklist)

- [ ] `electron/terminal/protocol.ts` — add `SessionHistoryEntry`; type `get-session-history` response
- [ ] `electron/terminal/server.ts` — map value type; load-time coercion; archive-time snapshot; handler return
- [ ] `electron/terminal/ipc-relay.ts` — forwarded-result type (no logic change)
- [ ] `electron/terminal/preload.ts` — `getSessionHistory` return type (impl + `Window` type)
- [ ] `src/ui/TerminalOverlay.ts` — render title+id row (textContent), fallback, ellipsis + tooltip
- [ ] `src/ui/SeriousTerminalController.ts` — replace `history.join('\n')` with per-entry rendering
- [ ] `tests/setup/copilot-bridge-mock.ts` — keep `[]`; document entry-object usage
- [ ] `tests/unit/**` — add the cases above

## Definition of done

- `npm run test` green (new + existing).
- Both history popovers show titles consistently; legacy data loads with fallbacks and zero loss.
- Long titles truncate with tooltip; popover geometry unchanged.
- ID remains exact and copyable everywhere.
- Rebuilt `dist/` verified as the one being launched (Principle VII).
