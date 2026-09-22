# Copilot Office — Speaker Notes

Presenter script for `CopilotOffice.md`, one entry per slide (in order). Edit
freely — this file is for your own review and rehearsal.

> **Note:** This is a standalone copy. The deck (`CopilotOffice.md`) also embeds
> these notes as Marp presenter notes, which is what exports into the PowerPoint
> notes pane on build. If you want your edits here to appear in the exported
> PPTX/PDF/HTML, mirror them back into the matching `<!-- Speaker notes: ... -->`
> block in `CopilotOffice.md` (or just present from this file directly).

---

## 1. Title — Copilot Office

The opening joke is "AI Accessibility for Humans (just a joke?)" — a playful
description of the project's goal.

## 2. Section — Motivation

*(Section divider — no notes. Transition: "First, why this exists.")*

## 3. The problem

Multi-agent AI development today means multiple terminals and constant context
switching. It works, but it's easy to lose track of what each session is doing.

## 4. The initial approach

The idea: visualize each AI chat as a teammate at a desk. Copilot Office is a
virtual office for AI productivity. You interact with mouse clicks or keyboard
movement, and each desk is a real Copilot CLI session.

## 5. Section — Session management

*(Section divider — no notes. Transition: "What started as a visualization
became how I manage day-to-day work.")*

## 6. Persistent sessions

Start new conversations or resume previous sessions. They're tracked and
persisted even after restart. Custom titles show what each agent is working on,
and real-time status badges show who's thinking, waiting, or done.

## 7. One office per project / directory

Each office keeps its own agents and working directory. An office can be
soft-reloaded to pick up a feature you just built without restarting everything.

## 8. [Deprecated] Meeting Mode → a team of agents

- Meeting Mode turns a complex request into an approved plan and parallel
  sub-agent work.
- The purpose was to try visualizing sub-agents as they work, with progress
  visible in one place.

## 9. Mini demo

Mini demo of Meeting Mode in action: briefing the planning agent, approving the
plan, and the fleet of sub-agents spinning up to work in parallel. The video only
plays in the HTML build, so present from `CopilotOffice.html`.

## 10. Section — Extensibility

*(Section divider — no notes. Transition: "On top of the core, I added my own
integrations.")*

## 11. Teams as an access and organization layer

Teams becomes a familiar bridge between personal session management and
organizational collaboration. Sessions can be organized through channels and
threads, accessed from wherever you are, shared with the wider team, and kept
in one place with their context and responses.

## 12. Office Orchestrator

The orchestrator is a concierge that identifies the right agent for a described
task and brings it online after approval. It can also be driven from Teams.

## 13. LIVE DEMO

Transition from the motivation into the live walkthrough. Use the demo sequence
below as the working guide.

## 14. Challenges

1. **Inconsistent terminal experiences** — routing messages through Copilot was
   unreliable at first; the Copilot SDK resolved this with one clean entryway.
2. **Rendering content effectively** — without an Azure Service Bot, messages can
   look clunky in Teams, so I made skills around them to improve visibility and
   readability.
3. **Tagging myself in Teams** — currently handled through an external Power
   Automate flow because the game sends messages on my behalf and cannot
   naturally @mention me in Teams.
4. **Unlimited potential / options** — there are so many directions to go and
   enhancements to make.
5. **Why am I building this?** — an important question to ask myself.

## 15. Catching up

AI tooling has already made good progress on several gaps that motivated this
project:

- **GitHub Copilot** is being updated frequently and now includes session
  persistence, interruption awareness, and many other improvements I cannot
  list exhaustively here
- Scout integrating as a tool in Microsoft Teams
- Agency hosting sessions from any of your managed devices

## 16. As other products catch up, why build this?

These are working hypotheses for now. Even when the ecosystem catches up, I
would still build this for the visual, spatial mental model; the focused
playground for testing ideas about agents, orchestration, and presence; and the
more observable and engaging way to work. Products move slowly, workflows shift
quickly, and iterating on ideas tuned to your workflows can create a major
advantage.

## 17. Try it

Walk through the npm install and controls live if demoing, then add:
"Or switch to serious mode to get some real productivity out of it."

## 18. Thank You

*(Close: reiterate the one-line takeaway — observable, manageable multi-agent
development — and invite questions.)*

---

# Demo

Live walkthrough. Ordering and inclusion TBD — see the candidate list below.

## Demo 1 — The office tour (offices & the code path)

**Goal:** orient the audience in the space — the workspace is organized into
independent offices, and the first one can reach into the game's own code.

**Steps:**
1. Walk through the **office tabs** along the top, switching between offices.
2. Point out that each office is independent — its own seated agents, status, and
   **working directory** (per project).
3. Land on the **first office** and explain it's special: its Admin agent's
   working directory is the repo root `.`, so it has **direct access to this
   game's own code path** — it can edit the game itself.

**The point:** the workspace is organized into independent offices, and one of
them can reach into the game itself.

**Talking points:**
- Offices = per-project workspaces with independent agent state.
- Flag the first office as the "self-editing" one.

---

## Demo 2 — Bring yourself into the world

**Goal:** show the two ways to work the office and that each desk is a real,
live Copilot session.

**Steps:**
1. **Mouse:** click an agent / desk to open its terminal — fast, no walking.
2. **Keyboard (RPG):** use **WASD / arrows** to walk your character over, **Shift**
   to sprint, and **E** to interact — you're literally *in* the office.
3. Open a desk's terminal and type a quick prompt to show it's a real Copilot
   CLI session, not a canned response.

**The point:** the office is navigable however you like, and "talking to an agent"
means driving a genuine terminal session.

**Talking points:**
- Mouse for speed, keyboard for the immersive/RPG feel — same underlying sessions.
- Approaching a desk is just a friendlier way to focus a terminal.

---

## Demo 3 — Serious mode

**Goal:** show that the game is optional — the same agents and sessions are
available in a focused, professional working view.

**Steps:**
1. Toggle **Serious mode**. The Phaser game world tears down and the panel becomes
   a clean **split view**: agent **dashboard** on one side, **terminal** on the other.
2. Select an agent from the dashboard — the **same live session** attaches
   instantly (nothing restarts).
3. Point out the at-a-glance **status** and per-agent info in the dashboard, and
   that you can switch agents without losing any state.
4. Open an agent's **terminal** and show that the **status, overview, and visible
   session titles stay up-leveled** — the dashboard context isn't hidden while
   you work; you see every agent's state *and* what each session is titled even
   with a terminal focused.
5. (Optional) Toggle back to game mode to show the two are just different
   presentations over the identical sessions.

**The point:** the pixel-art world makes AI work approachable, but when it's time
to focus, serious mode gives you a no-frills, dashboard-driven workspace over the
exact same agents.

**Talking points:**
- Same sessions, two surfaces — the game is a lens, not a dependency.
- Status/overview and session titles stay visible even with a terminal open — you
  never lose the fleet-wide picture to focus on one agent.
- Serious mode is the "get work done" view; the office is the "make it alive" view.

---

## Demo 4 — Sessions, persistence & history

**Goal:** show that conversations are durable first-class objects — titled,
tracked, and recoverable — not throwaway terminal buffers.

**Steps:**
1. **Start a new session** with an agent and give it a task; note the agent picks
   up a **custom title** describing what it's working on.
2. **Resume a previous session** to show continuity — you drop right back into the
   ongoing conversation, not a fresh prompt.
3. **Restart the app entirely.** Reopen and show that offices, seated agents,
   session titles, and status all **come back exactly as you left them**.
4. Open **session history** and **restore a past session** from the list —
   pulling an earlier conversation back into a live agent.

**The point:** Copilot Office treats sessions as persistent, labeled work items.
Nothing is lost on restart, and you can reach back into history to revive earlier
work.

**Talking points:**
- Custom titles turn "which tab was that?" into a glanceable list.
- Persistence across restart is what makes this a *workflow tool*, not a toy.
- Session history = a searchable/restorable archive of past conversations.

---

## Demo 4.5 (optional) — Soft reload keeps sessions alive

**Goal:** show that a **soft reload** re-renders the UI without losing any running
agent sessions — Alice and every other agent stay exactly where they were.
*(Optional / time-permitting.)*

**Steps:**
1. With agents live (e.g. Alice mid-task), press **Ctrl+R** for a **soft reload**:
   only the UI reloads — the terminal server and every live session stay alive.
2. The game re-renders and Alice (and the other agents) are still exactly where we
   left them, sessions intact.

**The point:** soft reload means iterating on the game never costs you your session
state — the server-kept-alive persistence story in one keystroke.

**Watch for / talking points:**
- Only the UI reloads; the terminal server and PTY sessions are untouched.
- Callback to Demo 1: the first office's Admin (Alice) can even edit the game's own
  code, and soft reload picks up changes without dropping sessions.
- Skip if short on time — the persistence story is already made by Demo 4.

---

## Demo 5 — Teams remote agents (+ orchestrator touch)

**Goal:** show that agents aren't trapped in the app — you can bring one online in
a Microsoft Teams channel thread and drive it from anywhere, and touch on the
Office Orchestrator as the concierge that brings the right agent online.

**Steps:**
1. Pick an agent and toggle its **Teams remote** control to bring it **online in a
   Teams channel thread**.
2. From **Teams (e.g. your phone)**, reply in that thread with a prompt — it routes
   into the agent's persistent terminal session; the answer **posts back to the
   channel**.
3. Show the same session is live in the app — Teams and the office are two ways
   into one persistent session; anyone in the thread can drive it.
4. **Orchestrator touch-on:** describe a need in plain language ("someone to review
   my code"); the **Office Orchestrator** proposes an agent and, on approval,
   brings it online — and can be driven from Teams too.
5. Show **rich rendering**: when a reply's **markdown exceeds a certain size**, it's
   rendered to an **image and posted inline** in the thread (instead of a wall of
   raw text) so tables/code look right in Teams.

**The point:** Teams is an access + organization layer — sessions live in channels
and threads, reachable from wherever you are and shareable with the team; the
orchestrator is the concierge that stands up the right agent on demand.

**Talking points:**
- One persistent session, two front doors (office + Teams thread).
- Threads/channels organize sessions and keep context with the team.
- Orchestrator = "describe what you need, approve, it's online" — also from Teams.

---

## Candidate demos (let's pick & order)

Remaining features we could still add — tell me which and where:

- **C. Custom titles + real-time status badges** — show thinking / waiting / done
  and per-agent tool activity at a glance.
- **D. Add agents on the fly** — seat a reserve agent at an empty desk as work
  scales up.
- **E. Multi-office** — switch between offices with independent agent state and
  working directories (per project).
- **F. Meeting Mode → Fleet** — Arthur decomposes a complex task; approve the
  plan; sub-agents spin up in parallel with live animations; they leave as they
  finish; Arthur wraps up. *(The headline "wow" demo.)*
- **G. Office Orchestrator** — describe a need in plain language ("someone to
  review my code"); it proposes an agent and, on approval, brings it online;
  can also switch offices.
- **H. Teams remote agents** — bring an agent online in a Teams channel thread and
  drive it from your phone; answers post back to the channel.
- **I. Player / sprite customization** — customize your character (this feature was
  itself built via self-edit through the Admin agent).
- **J. Mini-game (Galaxian)** — light "it's alive / joy" moment if time permits.

**Current confirmed flow:** 1 (office tour) → 2 (into the world) → 3 (serious mode)
→ 4 (sessions, persistence & history) → *…what next?* (suggest F as the
showpiece, then H for Teams).
