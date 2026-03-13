export interface AgentConfig {
  id: string;
  name: string;
  skill: string;
  sprite: string;
  color: number;
  position: { x: number; y: number };  // col, row matching chair positions
  greeting: string;
  description: string;
  workingDir?: string; // Optional custom working directory
}

// Pool of common first names for fleet agents
const FLEET_NAMES = [
  'Liam', 'Emma', 'Noah', 'Olivia', 'James', 'Ava', 'Ethan', 'Sophia',
  'Mason', 'Mia', 'Logan', 'Chloe', 'Lucas', 'Lily', 'Jack', 'Zoe',
  'Owen', 'Grace', 'Ryan', 'Ella', 'Caleb', 'Aria', 'Leo', 'Nora',
  'Max', 'Ruby', 'Eli', 'Ivy', 'Ben', 'Luna', 'Sam', 'Iris',
  'Kai', 'Maya', 'Cole', 'Jade', 'Finn', 'Rose', 'Jake', 'Hazel',
  'Adam', 'Clara', 'Seth', 'Stella', 'Dean', 'Vera', 'Troy', 'Wren',
  'Reid', 'Faye', 'Nash', 'Sage', 'Blake', 'Pearl', 'Grant', 'June',
  'Chase', 'Daphne', 'Miles', 'Freya', 'Clark', 'Thea', 'Wade', 'Skye',
  'Nolan', 'Piper', 'Tate', 'Lyra', 'Jude', 'Blair', 'Knox', 'Brynn',
  'Rhys', 'Darcy', 'Beau', 'Nell', 'Cruz', 'Sloane', 'Dane', 'Quinn',
  'Kent', 'Lena', 'Hugh', 'Esme', 'Zane', 'Cora', 'Axel', 'Fern',
  'Rory', 'Tessa', 'Joel', 'Willa', 'Nico', 'Ruth', 'Milo', 'Hope',
  'Ivan', 'Eve', 'Hugo', 'Gwen',
];

// 14 distinct colors for fleet agent uniforms
const FLEET_COLORS: number[] = [
  0x4488cc, // Steel blue
  0xcc4444, // Crimson
  0x44aa44, // Forest green
  0xcc8844, // Amber
  0x8844cc, // Purple
  0x44ccaa, // Teal
  0xcc44aa, // Magenta
  0x88aa44, // Olive
  0x4466cc, // Royal blue
  0xcc6644, // Burnt orange
  0x44cc66, // Emerald
  0xaa4488, // Plum
  0x6688cc, // Periwinkle
  0xccaa44, // Gold
];

// Seat positions around the 9×3 conference table (cols 6–14, rows 5–7)
const FLEET_SEAT_POSITIONS: { x: number; y: number }[] = [
  // Top 5 (row 4, above table — evenly spaced across cols 6–14)
  { x: 6, y: 4 }, { x: 8, y: 4 }, { x: 10, y: 4 }, { x: 12, y: 4 }, { x: 14, y: 4 },
  // Bottom 5 (row 8, below table — evenly spaced across cols 6–14)
  { x: 6, y: 8 }, { x: 8, y: 8 }, { x: 10, y: 8 }, { x: 12, y: 8 }, { x: 14, y: 8 },
  // Left 2 (col 5)
  { x: 5, y: 5.5 }, { x: 5, y: 6.5 },
  // Right 2 (col 15)
  { x: 15, y: 5.5 }, { x: 15, y: 6.5 },
];

// Bottom-middle seat index (0-based) — reserved for Arthur the Architect
const ARTHUR_FLEET_SEAT_INDEX = 7; // {x: 10, y: 8}

// Generate fleet agent configs deterministically from the name pool.
// The bottom-middle seat is reserved for Arthur (the Architect) so his
// meeting session can carry over to the fleet office.
export const FLEET_AGENTS: AgentConfig[] = FLEET_SEAT_POSITIONS.map((pos, i) => {
  if (i === ARTHUR_FLEET_SEAT_INDEX) {
    return {
      id: 'architect',
      name: 'Arthur',
      skill: 'general',
      sprite: 'npc_architect',
      color: 0x1a1a2e,
      position: pos,
      greeting: "⚡ I am Arthur, The Architect. I designed this fleet's plan and I'm overseeing execution.",
      description: 'The Architect',
    };
  }
  // Adjust name index to skip the Arthur slot
  const nameIndex = i < ARTHUR_FLEET_SEAT_INDEX ? i : i - 1;
  const name = FLEET_NAMES[nameIndex];
  return {
    id: `fleet-${i + 1}`,
    name,
    skill: 'general',
    sprite: `npc_fleet_${i + 1}`,
    color: FLEET_COLORS[i],
    position: pos,
    greeting: `Hey! I'm ${name}, part of the Fleet V-Team. Ready to collaborate!`,
    description: 'Fleet Agent',
  };
});

// Reserve agents mapped to empty communal-table stools in the default layout.
// Key = unassigned desk ID used in OfficeScene.desks[], value = full agent config.
// Sprite keys match textures already generated in BootScene.
export const RESERVE_AGENTS: Record<string, AgentConfig> = {
  'unassigned-left-4': {
    id: 'azure',
    name: 'Azure',
    skill: 'general',
    sprite: 'npc_azure',
    color: 0x0078d4,
    position: { x: 3, y: 5 },
    greeting: "☁️ Hey! I'm Azure, the Cloud Wizard. Need help with cloud architecture, deployments, or infrastructure? I've got you covered!",
    description: 'Cloud Wizard',
  },
  'unassigned-right-4': {
    id: 'validator',
    name: 'Val',
    skill: 'general',
    sprite: 'npc_validator',
    color: 0x00aa44,
    position: { x: 7, y: 5 },
    greeting: "🛡️ Greetings! I'm Val the Validator. I'll review your code, check for edge cases, and make sure everything is rock-solid!",
    description: 'The Validator',
  },
  'unassigned-above-4': {
    id: 'deployer',
    name: 'Rex',
    skill: 'general',
    sprite: 'npc_deployer',
    color: 0xff6600,
    position: { x: 6, y: 3 },
    greeting: "🚀 Hey there! I'm Rex the Deployer. CI/CD pipelines, releases, rollbacks — I'll get your code shipped!",
    description: 'The Deployer',
  },
  'unassigned-left-13': {
    id: 'doctor',
    name: 'Doc',
    skill: 'general',
    sprite: 'npc_doctor',
    color: 0xff4444,
    position: { x: 12, y: 5 },
    greeting: "🩺 Hello! I'm Doc, the Code Doctor. I diagnose performance issues, memory leaks, and unhealthy patterns. Let me take a look!",
    description: 'Code Doctor',
  },
  'unassigned-right-13': {
    id: 'scout',
    name: 'Scout',
    skill: 'general',
    sprite: 'npc_scout',
    color: 0x6622aa,
    position: { x: 16, y: 5 },
    greeting: "🔭 Hey! I'm Scout the Ranger. I explore codebases, find patterns, and map out dependencies. Where shall I look?",
    description: 'The Scout',
  },
  'unassigned-above-13': {
    id: 'accountant',
    name: 'Penny',
    skill: 'general',
    sprite: 'npc_accountant',
    color: 0x2a4a2a,
    position: { x: 15, y: 3 },
    greeting: "💰 Hi there! I'm Penny, the Accountant. I track metrics, costs, and keep your project's numbers in order!",
    description: 'The Accountant',
  },
};

// Core agent IDs that cannot be dismissed
export const CORE_AGENT_IDS = new Set(['generalist', 'architect', 'debugger', 'admin']);

// Reverse lookup: agentId → deskId (for dismiss/restore flows)
export const RESERVE_AGENT_DESK: Record<string, string> = Object.fromEntries(
  Object.entries(RESERVE_AGENTS).map(([deskId, config]) => [config.id, deskId])
);
export const AGENTS: AgentConfig[] = [
  {
    id: 'generalist',
    name: 'Gene',
    skill: 'general',
    sprite: 'npc_generalist',
    color: 0x4488cc,  // Blue
    position: { x: 4, y: 3 },  // stool above left communal table
    greeting: "Hey! I'm Gene, the Generalist. I can help with just about anything - coding, debugging, research, you name it!",
    description: 'the Generalist',
  },
  {
    id: 'architect',
    name: 'Arthur',
    skill: 'general',
    sprite: 'npc_architect',
    color: 0x1a1a2e,  // Dark blue-black
    position: { x: 2, y: 9 },  // bottom-left corner, own desk
    greeting: "⚡ I am Arthur, The Architect. I design systems, orchestrate plans, and spin up agents to execute complex tasks. Tell me your vision, and I'll build the team to make it happen.",
    description: 'The Architect',
  },
  {
    id: 'debugger',
    name: 'Dan',
    skill: 'general',
    sprite: 'npc_debugger',
    color: 0x22cc44,  // Green
    position: { x: 13, y: 3 },  // stool above right communal table
    greeting: "🔍 Hey there! I'm Dan the Debugger. Got a tricky bug? Let me dig in — I live for stack traces, breakpoints, and hunting down root causes!",
    description: 'The Debugger',
  },
  {
    id: 'admin',
    name: 'Alice',
    skill: 'general',
    sprite: 'npc_admin',
    color: 0xff69b4,  // Hot pink
    position: { x: 17, y: 9 },  // bottom-right corner, own desk
    greeting: "🎮 Hey! I'm Alice, the Office Admin. I have direct access to this game's UI code - want to change how something looks, add features, or fix bugs in Copilot Office? I'm your girl!",
    description: 'Office Admin',
    workingDir: '.',  // Points to whole project
  },
];
