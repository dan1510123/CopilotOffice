# 🎥 Copilot Office — Demo Presentation Script

> **Format:** 2-minute video | **Audience:** Internal team / hackathon judges
> **Goal:** Show a working prototype, the problem tackled, and the impact

---

## ACT 1: The Problem (0:00–0:20)

### Visuals
Record your real desktop showing the chaos of multi-agent AI work:
- 5–6 Copilot CLI terminal windows tiled/overlapping across the screen
- 3–4 browser tabs open (GitHub, docs, Stack Overflow)
- VS Code with multiple editor tabs
- Rapidly click between terminals — type in one, switch, type in another
- Copy-paste output from one terminal into another

**The feeling should be: overwhelming, scattered, "which terminal was doing what?"**

### Narration (~15 seconds, ~40 words)
> *"This is what multi-agent AI development looks like today. Multiple terminals, constant context switching. What if you could visualize your AI chats as teammates sitting at desks? Introducing Copilot Office, your virtual office for AI productivity"*

### Transition
Hard cut from messy desktop → clean pixel-art office.

---

## ACT 2: The Office & Agent Interactions (0:20–0:55) ⭐ "Living Workspace"

### Visuals — Live Demo
1. **Office reveal** (5s) — Player stands in the middle of the RPG office. Four AI agents at their desks: Gene (blue), Arthur (dark), Dan (green), Alice (pink). Name labels, descriptions, and status badges visible.
2. **Mouse interaction** (5s) — Click on an agent from the overview dashboard on the right panel to open their terminal. Show the dashboard listing all agents with their current status.
3. **Start a new conversation** (5s) — Open a fresh session with an agent. Show the terminal appearing on the right, the agent's badge updating from 💤 slacking → 🚀 starting → 🧠 thinking.
4. **RPG movement** (5s) — Switch to WASD keyboard movement. Walk the player character around the office, showing the pixel-art world and proximity-based interaction prompts ("Press E").
5. **Session persistence** (8s) — Close and reopen an agent's terminal to show the previous conversation is still there. Mention sessions survive app restarts.
6. **Status tracking** (5s) — Pan across agents showing different badges: one thinking 🧠, one waiting ⏳, one ready ✓. Show custom session titles on the dashboard that describe what each agent is working on.
7. **Multiple agents active** (5s) — Show 2–3 agents with active sessions simultaneously, each with their own title and status — a living workspace where agents are working in parallel.

### Narration (~25 seconds, ~65 words)
> *"Meet Copilot Office. You can interact with this virtual office world using mouse clicks, or bring yourself into the game with RPG-like keyboard movements. Start new conversations, or pick up previous sessions — the game tracks and persists them, even after restart. Custom titles show what each agent is working on, and real-time status badges let you see at a glance who's thinking, waiting, or done. You can even add more agents to the scene as you spin up more tasks."*

### Key Callouts (text overlays)
- "Sessions persist across restarts"
- "Custom titles track each agent's work"
- "Real-time status badges: 💤 🚀 🧠 ⏳ ✓"
- "Multiple agents working simultaneously"

---

## ACT 3: Meeting Mode & Fleet (0:55–1:32) ⭐ "Orchestration"

### Part A — The Meeting Room (0:55–1:15)

#### Visuals — Live Demo
1. **Walk to Arthur** (3s) — Approach the Architect's desk, press E.
2. **Meeting room transition** (3s) — Screen fades → cozy 6×5 meeting room, 3× camera zoom. Arthur across the table. Terminal auto-opens.
3. **Describe the task** (8s) — Type into Arthur's terminal:
   > *"I want a sprite customization page so players can change their character's hair, skin, jacket, tie, and pants colors. It needs a UI panel with color swatches, live preview, and localStorage persistence."*
4. **Arthur plans** (fast-forward 2×–4×, ~5s) — Terminal shows Arthur analyzing the codebase and generating a structured JSON plan.
5. **Plan Approval modal** (5s) — Overlay appears with task cards:
   - 🔵 **Gene** → "Parameterize SpriteGenerator to accept custom player colors"
   - 🟢 **Dan** → "Build the sprite customizer UI panel with color swatches and preview"
   - 🩷 **Alice** → "Wire the panel into BootScene and main.ts with localStorage persistence"
6. **Approve** (1s) — Click "✅ Approve & Execute"

### Part B — Fleet Deployment (1:20–1:40)

#### Visuals — Live Demo
7. **Exit animation** (3s) — Player + Arthur walk to meeting room doors. Camera fades to black.
8. **Fleet office appears** (3s) — Scene transitions to the Fleet V-Team room: large conference layout with 14 seats.
9. **Agent walk-in** (5s) — Gene, Dan, and Alice spawn at the entrance and walk to their seats. Status badges appear: 🚀 starting.
10. **Agents working** (5s) — Badges update: 🧠 thinking (pulsing green). Click an agent's row in the right panel to see their live terminal — Gene editing SpriteGenerator.ts, Dan building a UI panel, Alice wiring it all together. *(Fast-forward or narrate over if fleet tracking isn't fully live.)*
11. **Results** (3s) — Badges flip to ✅ done. Three agents, one feature, built in parallel.

### Part C — Impact (1:40–1:55)

#### Impact Comparison (text overlay, 5 seconds)

| | Before | After |
|---|---|---|
| **Orchestration** | Manual copy-paste between terminals | One-click plan → parallel execution |
| **Context switching** | 6 windows, constant alt-tab | Spatial overview, click to focus |
| **Coordination** | Developer is the router | Architect decomposes & assigns |
| **Visibility** | "Which terminal was doing what?" | Live status badges on every agent |

### Narration (~40 seconds, ~100 words)
> *"But what if you want to complete a more complex task? In comes the power of orchestration and Meeting Mode which takes advantage of GitHub Copilot Fleet. Arthur — the Architect — takes your complex task and breaks it down. A sprite customization feature? He'll break it down into tasks for multiple agents to work on in parallel. You'll plan it out together and once approved, sub-agents spin up simultaneously. An animation will appear to represent which fleet agents are truly needed and which can leave. And live badges show who's thinking, who's done, and what tools they're using. Along with increased visibility over how many tasks are processing, and visual indicators for work completion."*

### Key Callouts (text overlays)
- "One feature → three parallel agents"
- "Human approves before execution"
- "Agents work simultaneously, not sequentially"
- "3× throughput, full visibility"

---

## ACT 4: Impact & Closing (1:32–2:00)

#### Impact Comparison (text overlay while narrating, ~8 seconds)

| | Before | After |
|---|---|---|
| **Orchestration** | Manual copy-paste between terminals | One-click plan → parallel execution |
| **Context switching** | 6 windows, constant alt-tab | Spatial overview, click to focus |
| **Coordination** | Developer is the router | Architect decomposes & assigns |
| **Visibility** | "Which terminal was doing what?" | Live status badges on every agent |

#### Visuals
- Impact table overlay → dissolve to full office view, all 4 agents at desks, player in center
- Fade to black → title card

#### Title Card
**Copilot Office**
*Bringing joy back to terminals and AI interactions*

#### Narration (~25 seconds, ~60 words)
> *"What used to mean juggling six terminals and constant context switching becomes one plan, parallel agents, and full visibility. But beyond the productivity gains — we built Copilot Office because we believe AI interactions should feel alive. Agents with presence, sessions with persistence, orchestration you can see. We wanted to bring joy back to the terminal. This is just the beginning."*

---

## 📋 Pre-Recording Checklist

- [ ] `npm run build && npm start` — app running clean
- [ ] Pre-warm 2–3 agent sessions (start conversations so they have titles and active states)
- [ ] Pre-warm Arthur's session (optional — or boot live for authenticity)
- [ ] Record "chaos" footage: 5-6 CLI terminals + browser tabs, 15s of switching
- [ ] Screen recording: 1920×1080, 60fps
- [ ] Clean desktop — close distracting apps, disable notifications
- [ ] Rehearse Act 2: dashboard click → new session → WASD walk → session persistence → status badges
- [ ] Rehearse Arthur's fleet task prompt
- [ ] Test transitions: F10 close, meeting room enter/exit, plan approval modal
- [ ] Record 3+ takes of each act
- [ ] Record voiceover separately (~215 words total)
- [ ] Edit: splice best takes, add overlays, speed up AI thinking (2×–4×), add music

## 🎯 Task Prompts

**Arthur (fleet planning):**
> I want a sprite customization page so players can change their character's hair, skin, jacket, tie, and pants colors. It needs a UI panel with color swatches, live preview, and localStorage persistence.

## 💡 Production Tips

- **Rehearse 3× minimum** — 2 minutes is extremely tight
- **Record voiceover separately** — way cleaner than live narration
- **Speed up AI thinking (2×)** in post — keep energy high
- **Text overlays** — reinforce key points for visual learners
- **Background music** — lo-fi or chiptune to match pixel-art aesthetic
- **End decisively** — last 5 seconds should feel conclusive
- **Keep "chaos" footage quick** — 15 seconds max, it's setup not the story

## Word Count Budget

| Act | Duration | Words (~2.5 words/sec) |
|-----|----------|------------------------|
| Act 1 — Problem | 20s | ~40 words |
| Act 2 — Office & Agents | 25s narration + 10s demo | ~65 words |
| Act 3 — Meeting + Fleet + Impact | 40s narration + 20s demo | ~100 words |
| Act 4 — Closing | 5s | ~15 words |
| **Total** | **~120s** | **~215 words** |
