# Feature Specification: Auto-Render Markdown Replies as Teams Images

**Feature Branch**: `018-teams-auto-image-render`  
**Created**: 2026-07-21  
**Status**: Clarified  
**Input**: User description: "A post hook on conversation ending. If the conversation has ended, and the last message has some form of obviously markdown symbols, and the Teams remote is on, then automatically call the markdown Teams render skill (`office-image-teams-reply`)."

## Clarifications

### Session 2026-07-21

All six open questions were resolved this session. Q1 (the render trigger) was
decided interactively with the user; Q2–Q6 were decided autonomously with documented
rationale while the user was away, and are flagged **(review recommended)** for the
user's later review.

- **Q1 — Render trigger / markdown heuristic (FR-002)** *(user-decided)*: Auto-render
  fires **only when BOTH** (1) the reply contains **block-level structural markdown**
  (a fenced code block, a pipe table, an ATX/setext heading, a blockquote, or a
  multi-item list of ≥2 items) **AND** (2) the reply text length is **> 1000 characters**
  (a hardcoded constant, not configurable). Inline-only emphasis (`**bold**`, `*italic*`,
  single inline `` `code` ``), a lone stray `#`/`*`/`-`, small structured snippets, and
  large-but-unstructured prose all post as normal text. Rationale: the user's pain is
  "both big AND structured" content; small plain text and small tables are fine, and a
  long wall of pure prose should not render either (structure is required, not just size).
- **Q2 — Replace vs. augment (FR-004)** *(autonomous, review recommended)*: **Augment** —
  post the rendered image **in addition to** the plain-text reply. Rationale: honors the
  never-drop-reply invariant, preserves Teams-side search/copy and client-side graceful
  degradation if the image fails to load, and matches the existing manual office-image
  behavior (surrounding prose is retained). Because per-turn text already streams to the
  thread today (see Q4), the image is appended at conversation end rather than replacing
  already-posted text.
- **Q3 — Scope of turns (FR-005)** *(autonomous, review recommended)*: **Both**
  Teams-dispatched turns and locally-driven "ambient" turns. Rationale: ambient turns are
  mirrored into Teams and suffer the same unreadable-wall problem; both already flow
  through the shared `postReply` path.
- **Q4 — Hook point (FR-006)** *(autonomous, review recommended)*: The **debounced idle
  finalize** (`finalizeDispatch` / `finalizeAmbient`, after the `settleMs` quiet period),
  evaluated against the **final turn's accumulated reply text** — NOT per-turn flush.
  Rationale: "conversation ending" maps to the agent going idle; evaluating the complete
  final reply is required to measure the >1000-char gate and to render once (avoiding
  multiple images across a multi-turn/tool response) without firing on the first
  `turn-end` and dropping a later post-tool turn.
- **Q5 — Execution model (FR-007)** *(autonomous, review recommended)*: **(b)
  Main-process direct render.** The deterministic post-hook in the Electron main process
  invokes the existing `office-image-teams-reply` renderer (`render-markdown-image.mjs`)
  as a child process (node) with `--cwd` set to the agent's `workingDir`, captures the
  emitted sentinel path, and posts via the **existing** `extractImageMarkers` /
  `loadHostedImages` / `hostedImagesHtml` inline path. Rationale: a hook must be
  deterministic; re-prompting the agent (option a) relies on nondeterministic LLM
  compliance and would restart a turn, conflicting with the idle/finalize logic. The
  trade-off — main now depends on playwright/Chromium (crossing today's agent-sandbox
  boundary, since main never renders images itself today) — is accepted and mitigated by
  the FR-008 graceful fallback.
- **Q6 — Opt-in surface / default (FR-010)** *(autonomous, review recommended)*: A **new
  global `TeamsSettings` boolean flag** (e.g. `autoRenderMarkdownImages`), default
  **OFF (opt-in)**. Rationale: new behavior in a regression-prone subsystem that adds a
  playwright dependency and latency should be opt-in until proven, consistent with how
  `TeamsSettings.enabled` already gates the whole Teams-remote feature. A per-office
  override is out of scope for v1.

## Overview

Today an online agent must **manually decide** to render its Teams reply as an image:
it invokes the `office-image-teams-reply` skill, which produces a styled PNG under
`<workingDir>/.office-images/reply-<timestamp>.png` and prints a single
`<!--office-image:<relpath>-->` sentinel. The agent copies that sentinel into its
assistant reply text; the CopilotOffice main process only **extracts** sentinels the
agent already produced and attaches the referenced image inline to the Teams thread.

This feature adds an **automatic post-hook on conversation ending**: when an online
agent finishes and its final reply text contains "obviously markdown symbols" (tables,
fenced code, headings, etc.), CopilotOffice should automatically produce the
rendered-markdown image and post it inline into the Teams thread — so the reply
"looks right in Teams" without the agent having to invoke the skill or emit the
sentinel by hand. Plain text remains the guaranteed fallback: a reply is **never**
silently dropped.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Markdown reply auto-renders when the agent finishes (Priority: P1)

An online agent (Teams remote enabled) finishes answering a Teams-dispatched prompt.
Its final reply contains a markdown table and a fenced code block. When the
conversation ends (the agent goes idle), CopilotOffice detects the obvious markdown,
renders it to an image, and posts the rendered image inline into the Teams thread —
without the agent invoking the `office-image-teams-reply` skill.

**Why this priority**: This is the core value: rich markdown (tables, code) renders
faithfully on Teams/mobile automatically. It is the whole feature.

**Independent Test**: Drive an online agent to reply with a markdown table and code
block, let it go idle, and confirm an inline rendered image appears in the thread with
no manual skill invocation.

**Acceptance Scenarios**:

1. **Given** an online agent whose final reply contains a fenced code block or a
   markdown table, **When** the conversation ends (agent idle), **Then** CopilotOffice
   posts a rendered-markdown image inline into the Teams thread.
2. **Given** the same reply, **When** auto-render succeeds, **Then** the rendered image
   is posted **in addition to** the original plain-text reply (augment — see FR-004).
3. **Given** an agent whose final reply is plain prose (no obvious markdown), **When**
   the conversation ends, **Then** no image is rendered and the reply posts as normal
   plain text.

---

### User Story 2 - Never drop a reply on render failure (Priority: P1)

The renderer cannot run (Chromium/playwright missing, render error, or the image
exceeds the office-image size/count caps). The agent's reply must still reach the
thread as plain text.

**Why this priority**: The existing product invariant is that a reply is never
silently dropped. Auto-render must degrade gracefully, or it regresses a guaranteed
behavior.

**Independent Test**: Simulate a render failure (e.g. remove the Chromium browser or
force an error) and confirm the original plain-text reply is still posted to the thread.

**Acceptance Scenarios**:

1. **Given** a markdown reply that qualifies for auto-render, **When** the renderer
   fails for any reason, **Then** the original plain-text reply is posted to the thread
   and the failure is logged (not surfaced to the Teams user as a broken image).
2. **Given** a rendered image that exceeds the byte/count caps enforced by the
   image-sentinel loader, **When** the image is rejected, **Then** the plain-text reply
   is still posted.

---

### User Story 3 - Do not double-render when the agent already attached an image (Priority: P2)

An agent (or the skill) already emitted an `<!--office-image:...-->` sentinel in its
reply. Auto-render must recognize this and **not** render a second image.

**Why this priority**: The manual sentinel path must keep working unchanged; a
double image would be a visible regression and wasted work.

**Independent Test**: Have the agent emit a valid office-image sentinel in a reply that
also contains markdown, and confirm exactly one image is posted (the agent's), with no
auto-render duplicate.

**Acceptance Scenarios**:

1. **Given** a final reply that already contains one or more valid
   `<!--office-image:...-->` sentinels, **When** the conversation ends, **Then**
   auto-render does not produce an additional image.

---

### User Story 4 - Opt-in / opt-out control (Priority: P3)

An operator wants to control whether auto-render is active. The behavior is gated by a
setting so it can be turned off without disabling Teams remote entirely.

**Why this priority**: Auto-behaviors that post to a shared Teams channel need an
off-switch. Priority is lower than the core behavior but required for safe rollout.

**Independent Test**: Toggle the setting off and confirm markdown replies post as plain
text; toggle it on and confirm they auto-render.

**Acceptance Scenarios**:

1. **Given** the auto-render setting is disabled, **When** an online agent finishes a
   markdown reply, **Then** no image is auto-rendered and the reply posts as plain text.
2. **Given** the auto-render setting is enabled, **When** an online agent finishes a
   markdown reply, **Then** the reply auto-renders per User Story 1.

---

### Edge Cases

- **Stray markdown in prose**: a plain sentence containing a lone `#`, `*`, or `-`
  MUST NOT trigger auto-render (false-positive image spam). Detection requires *structural*
  block-level markdown AND a reply length > 1000 characters (see FR-002).
- **Small structured snippet**: a short reply (≤ 1000 chars) containing a tiny 2×2 table
  or a 3-line code block MUST NOT trigger auto-render — it posts as normal text (FR-002).
- **Large unstructured prose**: a reply > 1000 chars with no block-level structural
  markdown MUST NOT trigger auto-render — structure is required, not just size (FR-002).
- **Multi-turn / post-tool responses**: a tool-using response finishes across several
  turns; a later post-tool turn may carry the markdown (or a manual sentinel). The hook
  fires only at the debounced idle finalize on the final accumulated reply, so it never
  fires on the first `turn-end` and drops later content (see FR-006).
- **Very long reply chunked into multiple Teams messages**: how auto-render interacts
  with existing reply chunking (the plain-text path splits at ~3500 chars) must be
  defined — render the whole reply as one image, or per chunk.
- **Agent goes offline mid-render**: if the online binding is lost while rendering,
  the result must not be posted to a stale thread; behavior must be defined.
- **Empty/whitespace-only reply**: no image, no post (existing no-op behavior preserved).
- **Markdown that renders to an oversized image**: falls back to plain text (User Story 2).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide an automatic post-conversation hook that, for an
  agent with an **online Teams binding** (Teams remote on for that agent), inspects the
  agent's final reply text when the conversation ends.
- **FR-002**: The system MUST detect "obviously markdown" content using a heuristic that
  fires **only when BOTH** conditions hold: (a) the reply contains at least one
  **block-level structural markdown** construct — a fenced code block (```` ``` ````), a
  pipe table (a `|...|` row followed by a `---|---` separator), an ATX heading
  (`^#{1,6}\s`) or setext heading, a blockquote (`^>\s`), or a list of **≥2 items** — AND
  (b) the reply text length is **> 1000 characters**. Inline-only markers (`**bold**`,
  `*italic*`, single inline `` `code` ``, a lone stray `#`/`*`/`-`) MUST NOT count toward
  (a). The 1000-character threshold MUST be a named hardcoded constant (not configurable).
- **FR-003**: When markdown is detected and auto-render is enabled, the system MUST
  produce a rendered-markdown image equivalent to the `office-image-teams-reply` skill's
  output (markdown → styled HTML → 2x screenshot PNG saved under the agent's
  `workingDir`/`.office-images`) and post it inline into the agent's Teams thread using
  the existing inline image attachment path.
- **FR-004**: When auto-render succeeds, the system MUST post the rendered image **in
  addition to** the original plain-text reply (augment, not replace). Because per-turn
  reply text already streams to the thread (FR-006), the image is appended at
  conversation end; the plain text is never removed.
- **FR-005**: Auto-render MUST apply to **both** Teams-dispatched turns
  (`flushTurn`/`finalizeDispatch`) and locally-driven "ambient" turns
  (`flushAmbient`/`finalizeAmbient`), since both are mirrored into the Teams thread.
- **FR-006**: The trigger MUST be bound to the **debounced idle finalize**
  (`finalizeDispatch`/`finalizeAmbient`, after the `settleMs` quiet period) and evaluated
  against the **final turn's accumulated reply text**. It MUST NOT fire on per-turn flush
  or on the first `turn-end`, so a later post-tool turn carrying the markdown or a manual
  sentinel is never dropped, and only one image is produced per conversation.
- **FR-007**: Rendering MUST use **main-process direct render**: the Electron main-process
  post-hook invokes the existing `office-image-teams-reply` renderer
  (`render-markdown-image.mjs`) as a node child process with `--cwd` set to the agent's
  `workingDir`, captures the emitted `<!--office-image:...-->` sentinel path, and posts
  via the existing `extractImageMarkers` / `loadHostedImages` / `hostedImagesHtml` inline
  path. The main process therefore depends on playwright/Chromium; this crosses the
  current agent-sandbox boundary (main renders no images today) and is mitigated by the
  FR-008 fallback. Re-prompting the agent to run the skill is explicitly NOT used.
- **FR-008**: On any render failure — playwright/Chromium missing, render error, or the
  rendered image being rejected by the image-sentinel size/count/aggregate caps — the
  system MUST fall back to posting the original plain-text reply. A reply MUST NEVER be
  silently dropped.
- **FR-009**: If the final reply ALREADY contains one or more valid
  `<!--office-image:...-->` sentinels, the system MUST NOT auto-render an additional
  image (no double-render).
- **FR-010**: The system MUST gate auto-render behind a **new global `TeamsSettings`
  boolean flag** (e.g. `autoRenderMarkdownImages`), defaulting to **OFF (opt-in)**. A
  per-office override is out of scope for v1.
- **FR-011**: The system MUST NOT weaken the image-sentinel path security: rendered
  image paths remain relative and confined to the agent `workingDir` sandbox; absolute
  paths and `..` traversal remain rejected; magic-byte image validation and per-file /
  count / aggregate byte caps remain enforced.
- **FR-012**: The system MUST preserve existing Teams invariants: the self-loop control
  marker guard, message dedup/filtering, and the per-agent dispatch queue and
  `settleMs` debounce behavior MUST NOT regress.
- **FR-013**: The auto-render decision and outcome (triggered, skipped-no-markdown,
  skipped-existing-sentinel, rendered, fallback-on-failure) SHOULD be logged via the
  existing Teams logging so operators can diagnose false positives/negatives.

### Key Entities *(include if feature involves data)*

- **Final reply text**: the agent's assistant-message content for the ending
  conversation; the input to markdown detection and rendering.
- **Online agent binding**: the record indicating the agent is live in Teams
  (`binding.online`, with `workingDir`, `handle`, thread ids). Auto-render only applies
  when such a binding exists.
- **Auto-render setting**: the opt-in/opt-out flag(s) governing the behavior (global
  and/or per-office); exact shape per FR-010.
- **Rendered image artifact**: the PNG produced under `workingDir/.office-images/`,
  attached inline exactly like a manually emitted office-image sentinel.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For replies containing a markdown table or fenced code block, at least 95%
  auto-render into an inline Teams image with no manual skill invocation (when the
  setting is enabled and Teams remote is on).
- **SC-002**: Zero replies are silently dropped: in 100% of render-failure cases, the
  original plain-text reply reaches the thread.
- **SC-003**: Replies that are plain prose (no structural markdown) OR ≤ 1000 characters
  trigger auto-render in 0% of cases — no false-positive image spam.
- **SC-004**: When the agent already attached an image sentinel, exactly one image is
  posted in 100% of cases (no double-render).
- **SC-005**: With the setting disabled, auto-render fires in 0% of cases; with it
  enabled, qualifying replies render per SC-001.
- **SC-006**: No regression in the existing Teams reply flow: manual office-image
  sentinels, office-file attachments, self-loop guard, dedup, and dispatch-queue/
  debounce behavior continue to pass their existing tests.

## Assumptions

- The rendered image is produced by the same pipeline the `office-image-teams-reply`
  skill uses today (markdown → styled HTML → 2x Chromium screenshot), reused rather than
  reinvented.
- The inline attachment uses the existing `extractImageMarkers` / `loadHostedImages` /
  `hostedImagesHtml` path and its security sandbox unchanged.
- "Teams remote is on" means the agent has an online binding
  (`bindings.find(b => b.agentId === … && b.online)`) AND the global Teams feature is
  enabled (`TeamsSettings.enabled`).
- Markdown detection operates on the same assistant-message text captured for the reply
  (the agent's `assistant.message` content), before Teams HTML conversion.
- The feature reuses existing per-agent dispatch queueing and the `settleMs` idle
  debounce rather than introducing a new lifecycle.

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: No Phaser/in-canvas rendering is affected. Image rendering is
  an out-of-band PNG (Chromium screenshot) for Teams, consistent with the existing
  office-image path; DOM/renderer boundaries are unchanged.
- **Event & Input Boundary**: The trigger flows through the existing Teams event/turn
  lifecycle at the debounced idle-finalize hook (FR-006) and the documented main-process
  Teams service; no hidden cross-layer coupling and no new ad-hoc input handling.
- **Session Integrity Impact**: Must not alter Copilot CLI session semantics or event
  forwarding. The chosen execution model is main-process direct render (FR-007b): main
  renders out-of-band as a node child process and never touches the PTY/session, so
  session continuity and the dispatch/turn lifecycle are unaffected.
- **Configuration Impact**: The opt-in surface (FR-010) is a new typed global
  `TeamsSettings` boolean (default OFF), consistent with Configuration-First
  Extensibility rather than hardcoded behavior. The 1000-character size gate is a named
  constant (FR-002).
- **Regression Plan**: Preserve and re-run the Teams-subsystem tests (specs 011/015/016):
  self-loop marker guard, dedup/message filtering, dispatch-queue and `settleMs` debounce,
  and the existing office-image sentinel security tests (sandbox path rejection, magic-byte
  validation, size/count caps). Add tests for markdown detection (positive/negative,
  no-false-positive on prose or on ≤1000-char structured snippets, no-trigger on
  large-but-unstructured prose), no-double-render with an existing sentinel, and
  fallback-to-plain-text on render failure.
