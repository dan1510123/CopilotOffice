# Copilot Office — High-Level Overview

A simplified, concept-only companion to [`architecture.md`](./architecture.md) and
[`architecture-diagram.md`](./architecture-diagram.md). No file names — just the big ideas
and how they connect. Preview in VS Code with a Mermaid-capable Markdown preview.

---

## 1. The Big Picture

Copilot Office is a desktop app where you walk around a virtual office and talk to AI
agents. Under the hood, three processes cooperate: the **game & UI**, a **coordinator**,
and a **terminal engine** that runs real Copilot sessions.

```mermaid
flowchart LR
  User(["🧑‍💻 You"]):::actor --> Game

  subgraph Game["🎮 Game & UI"]
    direction TB
    World["Office world<br/>& agents you talk to"]:::a
    Terminals["Terminal & dashboard<br/>screens"]:::a
    Orchestrator["Orchestrator<br/>(talk to run the whole office)"]:::a
  end

  subgraph Coordinator["⚙️ Coordinator (traffic controller + services)"]
    direction TB
    Routing["Routes UI ⇄ engine<br/>& fans out results"]:::b
    OrchSvc["Runs the orchestrator agent"]:::b
    TeamsSvc["Connects to Teams"]:::b
    Services["Windows · settings · notifications<br/>· saving · process cleanup"]:::b
  end

  subgraph Engine["🧵 Terminal Engine"]
    direction TB
    Sessions["Live agent sessions<br/>(one per agent, per office)"]:::c
  end

  subgraph Outside["🌐 Outside World"]
    direction TB
    Copilot["Copilot AI runtime"]:::d
    Teams["Microsoft Teams"]:::d
    Storage[("Saved data on disk")]:::disk
  end

  Game <--> Coordinator
  Coordinator <--> Engine
  Engine <--> Copilot
  Coordinator <--> Teams
  Game <--> Storage
  Coordinator <--> Storage

  classDef actor fill:#1f2937,stroke:#111827,color:#f9fafb,font-weight:bold;
  classDef a fill:#6366f1,stroke:#3730a3,color:#fff;
  classDef b fill:#0ea5e9,stroke:#075985,color:#fff;
  classDef c fill:#10b981,stroke:#047857,color:#fff;
  classDef d fill:#f472b6,stroke:#be185d,color:#fff;
  classDef disk fill:#fbbf24,stroke:#b45309,color:#3b2600,font-weight:bold;
```

---

## 2. Talking to an Agent

When you open an agent's terminal, your request travels down to a real Copilot session and
the responses stream back up to the screen.

```mermaid
flowchart LR
  You(["🧑‍💻 You type / open a terminal"]):::actor --> UI["Game & UI"]:::a
  UI -->|"request"| Coord["Coordinator"]:::b
  Coord -->|"request"| Engine["Terminal Engine"]:::c
  Engine -->|"start or reuse"| Session["Live agent session"]:::c
  Session <--> AI(["🤖 Copilot AI"]):::d
  Session -->|"output & status"| Engine
  Engine -->|"stream back"| Coord
  Coord -->|"display"| UI

  classDef actor fill:#1f2937,stroke:#111827,color:#f9fafb,font-weight:bold;
  classDef a fill:#6366f1,stroke:#3730a3,color:#fff;
  classDef b fill:#0ea5e9,stroke:#075985,color:#fff;
  classDef c fill:#10b981,stroke:#047857,color:#fff;
  classDef d fill:#f472b6,stroke:#be185d,color:#fff;
```

---

## 3. Meetings → A Team of Agents

You brief a planning agent, approve its plan, and a whole team of agents spins up in a new
office to work in parallel — visualized as NPCs moving around.

```mermaid
flowchart LR
  Plan["🧠 Planning agent<br/>drafts a plan"]:::a --> Approve{"You approve?"}:::dec
  Approve -->|yes| Team["🏢 New team office<br/>opens"]:::b
  Approve -->|no| Plan
  Team --> Spawn["👥 Agents start<br/>working in parallel"]:::c
  Spawn --> Watch["📊 Progress shown as<br/>agents moving & status badges"]:::d

  classDef a fill:#6366f1,stroke:#3730a3,color:#fff;
  classDef b fill:#0ea5e9,stroke:#075985,color:#fff;
  classDef c fill:#10b981,stroke:#047857,color:#fff;
  classDef d fill:#f472b6,stroke:#be185d,color:#fff;
  classDef dec fill:#fbbf24,stroke:#b45309,color:#3b2600,font-weight:bold;
```

---

## 4. Running the Office by Conversation

Instead of walking to each agent, you can talk to one **orchestrator** in plain language.
It can look at what everyone's doing and act on your behalf — but anything that changes
state always asks your permission first.

```mermaid
flowchart LR
  You(["🧑‍💻 Plain-language commands"]):::actor --> Orch["🗣️ Orchestrator"]:::orch
  Orch --> Look["🔎 See what agents<br/>are doing"]:::ro
  Orch --> Act{"🔒 Change something?<br/>asks permission"}:::dec
  Act -->|approved| Do["Start / answer / stop<br/>an agent"]:::mut
  Look --> Office["🏢 The office & its agents"]:::a
  Do --> Office

  classDef actor fill:#1f2937,stroke:#111827,color:#f9fafb,font-weight:bold;
  classDef orch fill:#f59e0b,stroke:#b45309,color:#3b2600,font-weight:bold;
  classDef ro fill:#86efac,stroke:#15803d,color:#052e16;
  classDef mut fill:#fca5a5,stroke:#b91c1c,color:#450a0a;
  classDef a fill:#6366f1,stroke:#3730a3,color:#fff;
  classDef dec fill:#fbbf24,stroke:#b45309,color:#3b2600,font-weight:bold;
```

---

## 5. Driving Agents from Teams

Any agent can be brought "online" in a Microsoft Teams channel thread. People reply in the
thread to drive the agent, and its answers post back — so you can use it without opening the
app.

```mermaid
flowchart LR
  TeamsUser(["💬 Someone replies<br/>in a Teams thread"]):::actor --> Recv["📥 App receives<br/>the message"]:::t
  Recv --> Check["✅ Is this for an<br/>online agent?"]:::t
  Check --> Session["Live agent session"]:::c
  Session <--> AI(["🤖 Copilot AI"]):::d
  Session --> Reply["📤 Format the answer<br/>(image if rich)"]:::t
  Reply --> Thread(["📨 Posted back to<br/>the Teams thread"]):::actor

  classDef actor fill:#1f2937,stroke:#111827,color:#f9fafb,font-weight:bold;
  classDef t fill:#7c3aed,stroke:#5b21b6,color:#fff;
  classDef c fill:#10b981,stroke:#047857,color:#fff;
  classDef d fill:#f472b6,stroke:#be185d,color:#fff;
```

---

## 6. What Gets Remembered

The app saves the things that should survive a restart, so your offices, sessions, and
connections come back the way you left them.

```mermaid
flowchart TB
  App["🖥️ Copilot Office"]:::a --> Saved[("💾 Saved on disk")]:::disk

  Saved --> Offices["🏢 Offices & their agents"]:::item
  Saved --> History["🕑 Session history<br/>(restore past sessions)"]:::item
  Saved --> TeamsB["💬 Teams connections<br/>& secure tokens"]:::item
  Saved --> Prefs["⚙️ Preferences<br/>(view, zoom, settings)"]:::item

  classDef a fill:#6366f1,stroke:#3730a3,color:#fff;
  classDef disk fill:#fbbf24,stroke:#b45309,color:#3b2600,font-weight:bold;
  classDef item fill:#38bdf8,stroke:#0369a1,color:#082f49;
```

---

*Simplified overview — for the detailed, file-level architecture see `architecture.md` and
`architecture-diagram.md` in this folder.*
