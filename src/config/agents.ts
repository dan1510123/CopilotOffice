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

import type { HeroConfig } from '../sprites/SpriteGenerator';

/**
 * Canonical agent ID for "the Architect" (Arthur).
 *
 * This is the single source of truth for the architect role identifier.
 * Scene/layout code MUST import this constant rather than using the literal
 * string `'architect'`, so the role can be reassigned in one place if needed.
 * See `.github/copilot-instructions.md` → "Regression-Prone Pitfalls"
 * (hardcoded agent IDs).
 */
export const ARCHITECT_AGENT_ID = 'architect';

/**
 * Named ids for the other always-present default-office agents. Use these
 * instead of raw string literals so any future rename ripples through every
 * dashboard / click handler / parser. The string values match the entries
 * in `AGENTS` below — keep in sync.
 */
export const GENERALIST_AGENT_ID = 'generalist';
export const DEBUGGER_AGENT_ID = 'debugger';
export const ADMIN_AGENT_ID = 'admin';

/**
 * Canonical valid agent ids accepted by the meeting plan parser. Re-exported
 * so `src/meeting/planParser.ts` doesn't duplicate the list literal.
 */
export const DEFAULT_PLAN_AGENT_IDS: readonly string[] = [
  GENERALIST_AGENT_ID,
  DEBUGGER_AGENT_ID,
  ADMIN_AGENT_ID,
];

// Pool of common first names for agents
export const FLEET_NAMES = [
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
      id: ARCHITECT_AGENT_ID,
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

// Temporary toggle to hide Arthur from the default office.
const SHOW_ARCHITECT_IN_DEFAULT_OFFICE = false;

// Core agent IDs that cannot be dismissed
export const CORE_AGENT_IDS = new Set([
  GENERALIST_AGENT_ID,
  ...(SHOW_ARCHITECT_IN_DEFAULT_OFFICE ? [ARCHITECT_AGENT_ID] : []),
  DEBUGGER_AGENT_ID,
  ADMIN_AGENT_ID,
]);

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
  ...(SHOW_ARCHITECT_IN_DEFAULT_OFFICE ? [{
    id: ARCHITECT_AGENT_ID,
    name: 'Arthur',
    skill: 'general',
    sprite: 'npc_architect',
    color: 0x1a1a2e,  // Dark blue-black
    position: { x: 2, y: 9 },  // bottom-left corner, own desk
    greeting: "⚡ I am Arthur, The Architect. I design systems, orchestrate plans, and spin up agents to execute complex tasks. Tell me your vision, and I'll build the team to make it happen.",
    description: 'The Architect',
  }] : []),
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

// ===== Snapshots of office-0 defaults (immutable) =====
export const DEFAULT_AGENTS: readonly AgentConfig[] = [...AGENTS];
const DEFAULT_RESERVE_MAP: Readonly<Record<string, AgentConfig>> = { ...RESERVE_AGENTS };

// ===== Random sprite pool — 20 diverse appearance presets =====
export const RANDOM_POOL_CONFIGS: { heroConfig: HeroConfig; color: number }[] = [
  { heroConfig: { skinColor: 0xffdbac, hairColor: 0xcc3333, hairStyle: 'spiky', bodyColor: 0xcc4444, bodyStyle: 'robe', accessory: 'staff', accessoryColor: 0xff8888 }, color: 0xcc4444 },
  { heroConfig: { skinColor: 0xd4a574, hairColor: 0x222222, hairStyle: 'helmet', helmetColor: 0x6688cc, bodyColor: 0x4466cc, bodyStyle: 'armor', accessory: 'shield', accessoryColor: 0x88aaff }, color: 0x4466cc },
  { heroConfig: { skinColor: 0xf1c27d, hairColor: 0x663300, hairStyle: 'goggles', bodyColor: 0xff8800, bodyStyle: 'pilot', accessory: 'rocket', accessoryColor: 0xffcc44 }, color: 0xff8800 },
  { heroConfig: { skinColor: 0xc68642, hairColor: 0x111111, hairStyle: 'short', bodyColor: 0xeeeeee, bodyStyle: 'coat', accessory: 'stethoscope', accessoryColor: 0x44cc44 }, color: 0x44cc44 },
  { heroConfig: { skinColor: 0xffdbac, hairColor: 0x6644aa, hairStyle: 'long', bodyColor: 0x553399, bodyStyle: 'cloak', accessory: 'binoculars', accessoryColor: 0x9966ff }, color: 0x553399 },
  { heroConfig: { skinColor: 0xe0ac69, hairColor: 0x1a1a1a, hairStyle: 'bun', bodyColor: 0x336633, bodyStyle: 'vest', accessory: 'coins', accessoryColor: 0xffdd00 }, color: 0x336633 },
  { heroConfig: { skinColor: 0x8d5524, hairColor: 0x442200, hairStyle: 'short', bodyColor: 0x2266aa, bodyStyle: 'coat', accessory: 'book', accessoryColor: 0x66aadd }, color: 0x2266aa },
  { heroConfig: { skinColor: 0xffdbac, hairColor: 0xaa4400, hairStyle: 'spiky', bodyColor: 0xcc6622, bodyStyle: 'vest', accessory: 'blueprint', accessoryColor: 0x88bbff }, color: 0xcc6622 },
  { heroConfig: { skinColor: 0xf1c27d, hairColor: 0x333333, hairStyle: 'helmet', helmetColor: 0xaa3366, bodyColor: 0x882255, bodyStyle: 'armor', accessory: 'shield', accessoryColor: 0xdd6699 }, color: 0x882255 },
  { heroConfig: { skinColor: 0xd4a574, hairColor: 0x884422, hairStyle: 'goggles', bodyColor: 0x44aa88, bodyStyle: 'pilot', accessory: 'rocket', accessoryColor: 0x88ddbb }, color: 0x44aa88 },
  { heroConfig: { skinColor: 0xffdbac, hairColor: 0x2244aa, hairStyle: 'long', bodyColor: 0x3355bb, bodyStyle: 'robe', accessory: 'staff', accessoryColor: 0x7799ee }, color: 0x3355bb },
  { heroConfig: { skinColor: 0xc68642, hairColor: 0x222222, hairStyle: 'bun', bodyColor: 0xbb4444, bodyStyle: 'cloak', accessory: 'binoculars', accessoryColor: 0xee8888 }, color: 0xbb4444 },
  { heroConfig: { skinColor: 0xe0ac69, hairColor: 0x664422, hairStyle: 'short', bodyColor: 0x888833, bodyStyle: 'vest', accessory: 'coins', accessoryColor: 0xcccc44 }, color: 0x888833 },
  { heroConfig: { skinColor: 0xffdbac, hairColor: 0x44aa44, hairStyle: 'spiky', bodyColor: 0x33aa55, bodyStyle: 'coat', accessory: 'book', accessoryColor: 0x77dd88 }, color: 0x33aa55 },
  { heroConfig: { skinColor: 0x8d5524, hairColor: 0x111111, hairStyle: 'helmet', helmetColor: 0xccaa22, bodyColor: 0xaa8811, bodyStyle: 'armor', accessory: 'shield', accessoryColor: 0xffdd44 }, color: 0xaa8811 },
  { heroConfig: { skinColor: 0xf1c27d, hairColor: 0x993366, hairStyle: 'long', bodyColor: 0xaa3377, bodyStyle: 'cloak', accessory: 'blueprint', accessoryColor: 0xdd77aa }, color: 0xaa3377 },
  { heroConfig: { skinColor: 0xd4a574, hairColor: 0x444444, hairStyle: 'goggles', bodyColor: 0x555555, bodyStyle: 'pilot', accessory: 'rocket', accessoryColor: 0x999999 }, color: 0x555555 },
  { heroConfig: { skinColor: 0xffdbac, hairColor: 0xcc6600, hairStyle: 'bun', bodyColor: 0xcc7722, bodyStyle: 'robe', accessory: 'staff', accessoryColor: 0xffaa55 }, color: 0xcc7722 },
  { heroConfig: { skinColor: 0xe0ac69, hairColor: 0x223344, hairStyle: 'short', bodyColor: 0x226688, bodyStyle: 'coat', accessory: 'stethoscope', accessoryColor: 0x44aacc }, color: 0x226688 },
  { heroConfig: { skinColor: 0xc68642, hairColor: 0x883344, hairStyle: 'spiky', bodyColor: 0x993355, bodyStyle: 'vest', accessory: 'binoculars', accessoryColor: 0xcc6688 }, color: 0x993355 },
];

export const RANDOM_SPRITE_COUNT = RANDOM_POOL_CONFIGS.length;

// Desk positions in the default office layout (4 core + 6 reserve)
const CORE_POSITIONS: { x: number; y: number }[] = [
  { x: 4, y: 3 },   // above-left communal table
  { x: 2, y: 9 },   // bottom-left corner desk
  { x: 13, y: 3 },  // above-right communal table
  { x: 17, y: 9 },  // bottom-right corner desk
];

const RESERVE_DESK_IDS = [
  'unassigned-left-4', 'unassigned-right-4', 'unassigned-above-4',
  'unassigned-left-13', 'unassigned-right-13', 'unassigned-above-13',
];

const RESERVE_POSITIONS: { x: number; y: number }[] = [
  { x: 3, y: 5 }, { x: 7, y: 5 }, { x: 6, y: 3 },
  { x: 12, y: 5 }, { x: 16, y: 5 }, { x: 15, y: 3 },
];

const ROLE_TITLES = [
  'Assistant', 'Analyst', 'Specialist', 'Engineer', 'Consultant',
  'Developer', 'Advisor', 'Researcher', 'Coordinator', 'Strategist',
];

/** Seeded pseudo-random number generator for deterministic office agent generation. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Generate random agents for a non-office-0 office. Returns { core, reserve }. */
export function generateRandomOfficeAgents(officeId: string): {
  coreAgents: AgentConfig[];
  reserveAgents: Record<string, AgentConfig>;
} {
  const idNum = parseInt(officeId.replace('office-', ''), 10) || 1;
  const rng = seededRandom(idNum * 7919);

  // Shuffle name indices
  const nameIndices = Array.from({ length: FLEET_NAMES.length }, (_, i) => i);
  for (let i = nameIndices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [nameIndices[i], nameIndices[j]] = [nameIndices[j], nameIndices[i]];
  }

  // Shuffle sprite indices
  const spriteIndices = Array.from({ length: RANDOM_SPRITE_COUNT }, (_, i) => i);
  for (let i = spriteIndices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [spriteIndices[i], spriteIndices[j]] = [spriteIndices[j], spriteIndices[i]];
  }

  let namePtr = 0;
  let spritePtr = 0;
  const pickName = () => FLEET_NAMES[nameIndices[namePtr++]];
  const pickSprite = () => spriteIndices[spritePtr++];

  // Generate 4 core agents
  const coreAgents: AgentConfig[] = CORE_POSITIONS.map((pos, i) => {
    const name = pickName();
    const si = pickSprite();
    const pool = RANDOM_POOL_CONFIGS[si];
    const roleIdx = Math.floor(rng() * ROLE_TITLES.length);
    return {
      id: `${officeId}-agent-${i}`,
      name,
      skill: 'general',
      sprite: `npc_random_${si}`,
      color: pool.color,
      position: pos,
      greeting: `Hey! I'm ${name}. What are we working on?`,
      description: ROLE_TITLES[roleIdx],
    };
  });

  // Generate 6 reserve agents
  const reserveAgents: Record<string, AgentConfig> = {};
  RESERVE_DESK_IDS.forEach((deskId, i) => {
    const name = pickName();
    const si = pickSprite();
    const pool = RANDOM_POOL_CONFIGS[si];
    const roleIdx = Math.floor(rng() * ROLE_TITLES.length);
    reserveAgents[deskId] = {
      id: `${officeId}-reserve-${i}`,
      name,
      skill: 'general',
      sprite: `npc_random_${si}`,
      color: pool.color,
      position: RESERVE_POSITIONS[i],
      greeting: `Hi! I'm ${name}. Ready to help!`,
      description: ROLE_TITLES[roleIdx],
    };
  });

  return { coreAgents, reserveAgents };
}

/**
 * Swap the global AGENTS and RESERVE_AGENTS contents for the given office.
 * Office-0 uses the original defaults; other offices use their custom roster.
 */
export function swapActiveAgents(officeConfig: {
  id: string;
  customAgents?: AgentConfig[];
  customReserveAgents?: Record<string, AgentConfig>;
}): void {
  AGENTS.length = 0;
  for (const key of Object.keys(RESERVE_AGENTS)) delete RESERVE_AGENTS[key];

  if (officeConfig.id === 'office-0' || !officeConfig.customAgents?.length) {
    AGENTS.push(...DEFAULT_AGENTS);
    Object.assign(RESERVE_AGENTS, DEFAULT_RESERVE_MAP);
  } else {
    AGENTS.push(...officeConfig.customAgents);
    if (officeConfig.customReserveAgents) {
      Object.assign(RESERVE_AGENTS, officeConfig.customReserveAgents);
    }
  }

  // Rebuild reverse lookup
  for (const key of Object.keys(RESERVE_AGENT_DESK)) delete RESERVE_AGENT_DESK[key];
  Object.assign(
    RESERVE_AGENT_DESK,
    Object.fromEntries(Object.entries(RESERVE_AGENTS).map(([deskId, config]) => [config.id, deskId]))
  );

  // Update CORE_AGENT_IDS — core (starting) agents are never dismissable in any office
  CORE_AGENT_IDS.clear();
  for (const a of AGENTS) CORE_AGENT_IDS.add(a.id);
}

export interface SeatedAgentRecord {
  deskId: string;
  agentId: string;
}

/**
 * Restore reserve agents that were seated in this office.
 * Returns only valid desk/agent mappings (desk exists and still matches the saved agent ID).
 */
export function restoreSeatedReserveAgents(seatedAgents: ReadonlyArray<SeatedAgentRecord>): SeatedAgentRecord[] {
  const valid: SeatedAgentRecord[] = [];

  for (const seated of seatedAgents) {
    const reserveConfig = RESERVE_AGENTS[seated.deskId];
    if (!reserveConfig || reserveConfig.id !== seated.agentId) continue;

    valid.push(seated);
    if (!AGENTS.find(a => a.id === seated.agentId)) {
      AGENTS.push(reserveConfig);
    }
  }

  return valid;
}
