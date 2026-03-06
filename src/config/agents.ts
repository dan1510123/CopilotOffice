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

// Positions match chair locations in officeLayouts.ts
export const AGENTS: AgentConfig[] = [
  {
    id: 'generalist',
    name: 'Gene',
    skill: 'general',
    sprite: 'npc_generalist',
    color: 0x4488cc,  // Blue
    position: { x: 3, y: 3 },  // chair-1 (furthest left)
    greeting: "Hey! I'm Gene, the Generalist. I can help with just about anything - coding, debugging, research, you name it!",
    description: 'the Generalist',
  },
  {
    id: 'architect',
    name: 'Arthur',
    skill: 'general',
    sprite: 'npc_architect',
    color: 0x1a1a2e,  // Dark blue-black
    position: { x: 4, y: 7 },  // bottom-left, mirroring Alice's bottom-right
    greeting: "⚡ I am Arthur, The Architect. I design systems, orchestrate plans, and spin up agents to execute complex tasks. Tell me your vision, and I'll build the team to make it happen.",
    description: 'The Architect',
  },
  {
    id: 'debugger',
    name: 'Dan',
    skill: 'general',
    sprite: 'npc_debugger',
    color: 0x22cc44,  // Green
    position: { x: 16, y: 3 },  // Right side, mirroring Gene's left-side position
    greeting: "🔍 Hey there! I'm Dan the Debugger. Got a tricky bug? Let me dig in — I live for stack traces, breakpoints, and hunting down root causes!",
    description: 'The Debugger',
  },
  {
    id: 'admin',
    name: 'Alice',
    skill: 'general',
    sprite: 'npc_admin',
    color: 0xff69b4,  // Hot pink
    position: { x: 15, y: 7 },  // chair-alice (right lower)
    greeting: "🎮 Hey! I'm Alice, the Office Admin. I have direct access to this game's UI code - want to change how something looks, add features, or fix bugs in Copilot Office? I'm your girl!",
    description: 'Office Admin',
    workingDir: '.',  // Points to whole project
  },
];
