import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { NPC } from '../entities/NPC';
import { TerminalOverlay } from '../ui/TerminalOverlay';
import { PongGame } from '../ui/PongGame';
import { AGENTS, AgentConfig } from '../config/agents';
import { InputManager } from '../input/InputManager';
import { officeManager } from '../office/officeManager';

interface DeskInfo {
  sprite: Phaser.GameObjects.Sprite;
  agentId: string;
  x: number;
  y: number;
}

interface GameTable {
  sprite: Phaser.GameObjects.Sprite;
  x: number;
  y: number;
}

interface ExitDoor {
  x: number;
  y: number;
}

// Feature flags
const ENABLE_PING_PONG = false;
const ENABLE_DECORATIONS = false;

export class OfficeScene extends Phaser.Scene {
  private player!: Player;
  private npcs: NPC[] = [];
  private desks: DeskInfo[] = [];
  private terminalOverlay!: TerminalOverlay;
  private pongGame!: PongGame;
  private pingPongTable: GameTable | null = null;
  private nearPingPong: boolean = false;
  private pingPongPrompt!: Phaser.GameObjects.Text;
  private tileSize: number = 64;
  private mapWidth: number = 20;
  private mapHeight: number = 12;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private nearestNPC: NPC | null = null;
  private nearestDesk: DeskInfo | null = null;
  private titleText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private spriteScale: number = 1;
  private playerMovementEnabled: boolean = true;
  private playerInScene: boolean = false;
  private exitDoors: ExitDoor[] = [];
  private nearestExitDoor: ExitDoor | null = null;
  private exitPrompt!: Phaser.GameObjects.Text;
  private inputManager!: InputManager;

  constructor() {
    super({ key: 'OfficeScene' });
  }

  create(): void {
    // Calculate tile size based on screen
    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;
    
    // Size tiles to fill screen
    this.tileSize = Math.max(48, Math.floor(Math.min(screenWidth / this.mapWidth, screenHeight / this.mapHeight)));
    this.spriteScale = this.tileSize / 32; // Scale factor for 32px sprites
    
    // World bounds - expanded: 2 tiles lower on top, 2 tiles lower on bottom, 2 extra on right
    // Walls are decorative at rows 0 and mapHeight-1, but player can walk closer to edges
    const boundsTop = 2 * this.tileSize;  // Start 2 tiles down
    const boundsBottom = (this.mapHeight + 1) * this.tileSize;  // End 2 tiles below bottom wall
    const boundsRight = this.mapWidth * this.tileSize;  // Full width (already added 2 to mapWidth)
    this.physics.world.setBounds(this.tileSize, boundsTop, boundsRight - this.tileSize, boundsBottom - boundsTop);
    
    // Create the office layout
    this.createOfficeLayout();
    
    // Create player off-screen below the entrance
    const entranceX = this.mapWidth * this.tileSize / 2;
    const entranceY = (this.mapHeight + 1) * this.tileSize;
    this.player = new Player(
      this,
      entranceX,
      entranceY
    );
    this.player.setScale(this.spriteScale);
    this.player.setDepth(50);
    this.player.setVisible(false);
    this.player.disableMovement();
    
    // Create NPCs
    this.createNPCs();
    
    // Create InputManager (must be before TerminalOverlay)
    this.inputManager = new InputManager(this);
    console.log('[OfficeScene] InputManager created');

    // Create terminal overlay (replaces dialog box)
    this.terminalOverlay = new TerminalOverlay(this, this.inputManager);

    // Create pong game overlay
    this.pongGame = new PongGame(this);

    // Create ping pong prompt (hidden by default)
    this.pingPongPrompt = this.add.text(0, 0, '[E] Play Ping Pong', {
      font: 'bold 14px monospace',
      color: '#ffcc00',
      backgroundColor: '#000000',
      padding: { x: 8, y: 4 },
    });
    this.pingPongPrompt.setOrigin(0.5, 1);
    this.pingPongPrompt.setDepth(100);
    this.pingPongPrompt.setVisible(false);

    // Create exit prompt (hidden by default)
    this.exitPrompt = this.add.text(0, 0, '[E] Exit', {
      font: 'bold 14px monospace',
      color: '#ffcc00',
      backgroundColor: '#000000',
      padding: { x: 8, y: 4 },
    });
    this.exitPrompt.setOrigin(0.5, 1);
    this.exitPrompt.setDepth(100);
    this.exitPrompt.setVisible(false);

    // Register exit zone at the center of the grand entrance doors
    this.exitDoors.push({
      x: 10 * this.tileSize,
      y: (this.mapHeight - 1) * this.tileSize,
    });

    // Pre-start copilot sessions for all agents in background
    this.preStartAgentSessions();
    
    // Set up interact key (E)
    if (this.input.keyboard) {
      this.interactKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    }
    
    // Add collision between player and walls
    this.physics.add.collider(this.player, this.walls);
    
    // Font sizes based on screen
    const titleFontSize = Math.max(24, Math.floor(screenHeight / 40));
    const instructionFontSize = Math.max(14, Math.floor(screenHeight / 70));
    
    // Add title
    this.titleText = this.add.text(screenWidth / 2, 10, '🏢 AGENCY OFFICE', {
      font: `bold ${titleFontSize}px monospace`,
      color: '#ffffff',
    });
    this.titleText.setOrigin(0.5, 0);
    this.titleText.setScrollFactor(0);
    this.titleText.setDepth(100);
    
    // Add instructions (initially show entrance prompt)
    this.instructionText = this.add.text(screenWidth / 2, screenHeight - 78, 
      '[Space / Enter] Enter the office', {
      font: `${instructionFontSize}px monospace`,
      color: '#888888',
    });
    this.instructionText.setOrigin(0.5, 1);
    this.instructionText.setScrollFactor(0);
    this.instructionText.setDepth(100);

    // Camera setup - no follow needed since room fits
    this.cameras.main.setBounds(0, 0, this.mapWidth * this.tileSize, this.mapHeight * this.tileSize);
    this.cameras.main.centerOn(this.mapWidth * this.tileSize / 2, this.mapHeight * this.tileSize / 2);

    // Listen for terminal open/close from main.ts to toggle player movement
    this.game.events.on('terminal:open', () => {
      this.playerMovementEnabled = false;
      if (this.playerInScene) this.player.disableMovement();
    }, this);

    this.game.events.on('terminal:close', () => {
      this.playerMovementEnabled = true;
      if (this.playerInScene) this.player.enableMovement();
    }, this);

    // Allow external UI (e.g. overview panel) to open agent terminal directly
    this.game.events.on('open:agent:terminal', (agentId: string) => {
      const agent = AGENTS.find(a => a.id === agentId);
      if (agent) this.startConversation(agent);
    }, this);

    // Highlight the NPC whose terminal is open
    this.game.events.on('npc:highlight', (agentId: string) => {
      for (const npc of this.npcs) {
        npc.setHighlighted(npc.config.id === agentId);
      }
    }, this);

    this.game.events.on('npc:clear-highlight', () => {
      for (const npc of this.npcs) {
        npc.setHighlighted(false);
      }
    }, this);

    // Update NPC badges when agent status changes (tool start/complete/turn end)
    this.game.events.on('agent:tool:start', () => {
      this.updateSessionBadges();
    }, this);

    this.game.events.on('agent:status:changed', () => {
      this.updateSessionBadges();
    }, this);

    // Listen for office switch to reinitialize if needed
    this.game.events.on('office:switch', (_officeId: string, _workingDir: string) => {
      console.log(`[OfficeScene] Office switched to: ${_officeId}`);
    }, this);

    // Click on NPC → open / switch conversation immediately.
    // Click on empty canvas → regain keyboard focus so player can move again.
    this.input.on('pointerdown', (
      _pointer: Phaser.Input.Pointer,
      currentlyOver: Phaser.GameObjects.GameObject[]
    ) => {
      const clickedNPC = currentlyOver.find((go): go is NPC => go instanceof NPC);
      if (clickedNPC) {
        this.startConversation(clickedNPC.config);
      } else if (this.playerInScene) {
        // Background click — give game focus back
        console.log('[OfficeScene] background click — returning focus to game');
        this.terminalOverlay.blurTerminal();
        this.playerMovementEnabled = true;
        this.player.enableMovement();
      }
    });

    // Listen for Space / Enter to enter the office
    if (this.input.keyboard) {
      const spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      const enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
      spaceKey.on('down', () => { if (!this.playerInScene) this.triggerEntrance(); });
      enterKey.on('down', () => { if (!this.playerInScene) this.triggerEntrance(); });
    }

    // Initialise InputManager state to "game" (the default mode at startup)
    this.inputManager.switchToGame('OfficeScene.create() initial state');

    // Clean up InputManager when the scene shuts down
    this.events.on('shutdown', () => {
      console.log('[OfficeScene] shutdown — destroying InputManager');
      this.inputManager.destroy();
    }, this);
  }

  private createOfficeLayout(): void {
    this.walls = this.physics.add.staticGroup();
    
    const scale = this.tileSize / 32; // Scale factor for 32px sprites
    
    // Helper to add scaled wall - create physics sprite directly in group
    const addWall = (x: number, y: number, texture: string) => {
      const sprite = this.walls.create(x, y, texture) as Phaser.Physics.Arcade.Sprite;
      sprite.setScale(scale).refreshBody();
      return sprite;
    };
    
    // Helper to add decorative sprite (no collision)
    const addDecor = (x: number, y: number, texture: string) => {
      const sprite = this.add.sprite(x, y, texture);
      sprite.setScale(scale);
      return sprite;
    };
    
    // Draw floor everywhere first (no collision)
    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        addDecor(x * this.tileSize + this.tileSize/2, y * this.tileSize + this.tileSize/2, 'floor');
      }
    }
    
    // === SKYSCRAPER WINDOWS (visual only - no collision for boundaries) ===
    // Top windows at row 0 (decorative - world bounds handle top)
    for (let x = 1; x < this.mapWidth - 1; x++) {
      const windowType = (x >= 8 && x <= 12) ? 'window_sun' : 'window';
      addDecor(x * this.tileSize + this.tileSize/2, this.tileSize/2, windowType);
    }
    
    // Left windows (decorative)
    for (let y = 1; y < this.mapHeight - 1; y++) {
      const windowType = (y % 3 === 0) ? 'window_sun' : 'window';
      addDecor(this.tileSize/2, y * this.tileSize + this.tileSize/2, windowType);
    }
    
    // Right windows (decorative)
    for (let y = 1; y < this.mapHeight - 1; y++) {
      const windowType = (y % 3 === 1) ? 'window_sun' : 'window';
      addDecor((this.mapWidth - 1) * this.tileSize + this.tileSize/2, y * this.tileSize + this.tileSize/2, windowType);
    }
    
    // Corner pieces (decorative)
    const corners = [
      { x: 0, y: 0 },
      { x: this.mapWidth - 1, y: 0 },
      { x: 0, y: this.mapHeight - 1 },
      { x: this.mapWidth - 1, y: this.mapHeight - 1 },
    ];
    corners.forEach(corner => {
      addDecor(corner.x * this.tileSize + this.tileSize/2, corner.y * this.tileSize + this.tileSize/2, 'window_corner');
    });
    
    // Bottom wall (decorative) - centre 4 tiles are grand entrance doors
    const doorCols = new Set([8, 9, 10, 11]);
    for (let x = 1; x < this.mapWidth - 1; x++) {
      if (doorCols.has(x)) continue;
      const wx = x * this.tileSize + this.tileSize / 2;
      const wy = (this.mapHeight - 1) * this.tileSize + this.tileSize / 2;
      addDecor(wx, wy, 'wall');
    }

    // Grand entrance doors + entrance rug
    this.createGrandDoors();
    this.createEntranceRug();
    
    // Add agent desks (decorative only - no collision)
    AGENTS.forEach(agent => {
      const deskX = agent.position.x * this.tileSize + this.tileSize/2;
      const deskY = (agent.position.y + 1) * this.tileSize + this.tileSize/2;
      
      // Desk - decorative only
      const desk = addDecor(deskX, deskY, 'desk');
      
      // Track desk for interaction
      this.desks.push({
        sprite: desk,
        agentId: agent.id,
        x: deskX,
        y: deskY,
      });
      
      // Laptop centered on desk surface
      addDecor(deskX, deskY, 'computer').setDepth(1);
    });
    
    // Boss desk at center bottom (large desk) - NO collision so player can walk through
    const bossDeskX = this.mapWidth * this.tileSize / 2;
    const bossDeskY = (this.mapHeight - 6) * this.tileSize + this.tileSize/2;
    
    // Create larger boss desk (3 tiles wide) - decorative only, no collision
    for (let i = -1; i <= 1; i++) {
      addDecor(bossDeskX + i * this.tileSize, bossDeskY, 'desk');
    }
    
    // Boss laptop centered on desk
    addDecor(bossDeskX, bossDeskY, 'computer').setDepth(1);
    
    // Boss chair (behind desk, where player spawns)
    addDecor(bossDeskX, bossDeskY + this.tileSize, 'chair');
    
    // Add some decorations (no collision)
    if (ENABLE_DECORATIONS) {
      // Plants in corners
      addDecor(2 * this.tileSize + this.tileSize/2, 2 * this.tileSize + this.tileSize/2, 'plant');
      addDecor((this.mapWidth - 3) * this.tileSize + this.tileSize/2, 2 * this.tileSize + this.tileSize/2, 'plant');
      
      // Water cooler on the side
      addDecor(2 * this.tileSize + this.tileSize/2, (this.mapHeight - 3) * this.tileSize + this.tileSize/2, 'cooler');
      
      // Coffee machine near water cooler
      addDecor(3 * this.tileSize + this.tileSize/2, (this.mapHeight - 3) * this.tileSize + this.tileSize/2, 'coffee');
      
      // Bookshelf on left wall
      addDecor(2 * this.tileSize + this.tileSize/2, 3 * this.tileSize + this.tileSize/2, 'bookshelf');
      addDecor(2 * this.tileSize + this.tileSize/2, 4 * this.tileSize + this.tileSize/2, 'bookshelf');
      
      // Filing cabinets near boss desk
      addDecor(6 * this.tileSize + this.tileSize/2, (this.mapHeight - 3) * this.tileSize + this.tileSize/2, 'cabinet');
      addDecor((this.mapWidth - 7) * this.tileSize + this.tileSize/2, (this.mapHeight - 3) * this.tileSize + this.tileSize/2, 'cabinet');
      
      // Whiteboard on right side
      const whiteboardSprite = this.add.sprite(
        (this.mapWidth - 3) * this.tileSize + this.tileSize/2,
        4 * this.tileSize + this.tileSize/2,
        'whiteboard'
      );
      whiteboardSprite.setScale(scale);
      
      // Wall clock near top
      addDecor(5 * this.tileSize + this.tileSize/2, 2 * this.tileSize + this.tileSize/2, 'clock');
      addDecor((this.mapWidth - 6) * this.tileSize + this.tileSize/2, 2 * this.tileSize + this.tileSize/2, 'clock');
      
      // Couch in break area (right side)
      const couchSprite = this.add.sprite(
        (this.mapWidth - 4) * this.tileSize + this.tileSize/2,
        (this.mapHeight - 4) * this.tileSize + this.tileSize/2,
        'couch'
      );
      couchSprite.setScale(scale);
      
      // Trash cans near desks
      addDecor(4 * this.tileSize + this.tileSize/2, 5 * this.tileSize + this.tileSize/2, 'trash');
      addDecor((this.mapWidth - 5) * this.tileSize + this.tileSize/2, 5 * this.tileSize + this.tileSize/2, 'trash');
      
      // Wall art/posters
      addDecor(7 * this.tileSize + this.tileSize/2, 2 * this.tileSize + this.tileSize/2, 'poster');
      addDecor((this.mapWidth - 8) * this.tileSize + this.tileSize/2, 2 * this.tileSize + this.tileSize/2, 'poster');
      
      // More plants for ambiance
      addDecor(5 * this.tileSize + this.tileSize/2, (this.mapHeight - 4) * this.tileSize + this.tileSize/2, 'plant');
      addDecor((this.mapWidth - 6) * this.tileSize + this.tileSize/2, (this.mapHeight - 4) * this.tileSize + this.tileSize/2, 'plant');
    }
    
    // (rug moved to entrance area)
    
    // Ping pong table (left of center)
    if (ENABLE_PING_PONG) {
      const pingpongX = Math.floor(this.mapWidth / 2 - 3) * this.tileSize + this.tileSize / 2;
      const pingpongY = Math.floor(this.mapHeight / 2) * this.tileSize + this.tileSize / 2;
      const pingpongSprite = addDecor(pingpongX, pingpongY, 'pingpong');
      pingpongSprite.setScale(scale);
      pingpongSprite.setDepth(5);
      
      // Track ping pong table for interaction
      this.pingPongTable = {
        sprite: pingpongSprite,
        x: pingpongX,
        y: pingpongY,
      };
    }
    
    // Volleyball court (right of center) - removed
    // McDonald's nuggets stand - removed
    // Arcade machine - removed
  }

  private createGrandDoors(): void {
    const ts = this.tileSize;
    const doorY = (this.mapHeight - 1) * ts;
    const leftX = 8 * ts;
    const centerX = 10 * ts;
    const rightX = 10 * ts;

    const g = this.add.graphics();

    // Full doorframe background
    g.fillStyle(0x1a0a00, 1);
    g.fillRect(leftX, doorY, 4 * ts, ts);

    // Left door panel (2 tiles wide)
    g.fillStyle(0x8b4513, 1);
    g.fillRect(leftX + 3, doorY + 2, 2 * ts - 6, ts - 4);
    // Upper raised panel
    g.fillStyle(0xa0622d, 1);
    g.fillRect(leftX + 10, doorY + 6, 2 * ts - 22, ts * 0.3);
    // Lower raised panel
    g.fillRect(leftX + 10, doorY + ts * 0.52, 2 * ts - 22, ts * 0.34);
    // Gold handle (inner edge)
    g.fillStyle(0xffd700, 1);
    g.fillRoundedRect(centerX - 16, doorY + ts * 0.38, 8, 8, 2);

    // Right door panel (2 tiles wide, mirrored)
    g.fillStyle(0x8b4513, 1);
    g.fillRect(rightX + 3, doorY + 2, 2 * ts - 6, ts - 4);
    g.fillStyle(0xa0622d, 1);
    g.fillRect(rightX + 12, doorY + 6, 2 * ts - 22, ts * 0.3);
    g.fillRect(rightX + 12, doorY + ts * 0.52, 2 * ts - 22, ts * 0.34);
    g.fillStyle(0xffd700, 1);
    g.fillRoundedRect(rightX + 8, doorY + ts * 0.38, 8, 8, 2);

    // Center seam between the two doors
    g.fillStyle(0x0e0600, 1);
    g.fillRect(centerX - 2, doorY, 4, ts);

    // Ornamental header bar (gold trim across top)
    g.fillStyle(0xdaa520, 1);
    g.fillRect(leftX + 6, doorY, 4 * ts - 12, 3);

    g.setDepth(0);
  }

  private createEntranceRug(): void {
    const ts = this.tileSize;
    const rugWidthTiles = 8;
    const rugX = (this.mapWidth / 2 - rugWidthTiles / 2) * ts;
    const rugY = (this.mapHeight - 2.4) * ts;
    const rugW = rugWidthTiles * ts;
    const rugH = ts * 1.4;

    const g = this.add.graphics();

    // Shadow underneath the rug
    g.fillStyle(0x000000, 0.15);
    g.fillRoundedRect(rugX + 4, rugY + 4, rugW, rugH, 8);

    // Main rug body — deep burnt orange
    g.fillStyle(0xd4600a, 1);
    g.fillRoundedRect(rugX, rugY, rugW, rugH, 8);

    // Woven texture — alternating horizontal stripes
    for (let row = 0; row < rugH - 12; row += 6) {
      const alpha = (row % 12 === 0) ? 0.08 : 0.04;
      g.fillStyle(0x000000, alpha);
      g.fillRect(rugX + 8, rugY + 6 + row, rugW - 16, 3);
    }

    // Subtle vertical fiber lines
    for (let col = 0; col < rugW - 16; col += 10) {
      g.fillStyle(0xffffff, 0.03);
      g.fillRect(rugX + 8 + col, rugY + 6, 1, rugH - 12);
    }

    // Outer decorative border — dark brown frame
    g.lineStyle(5, 0x7a2e00, 1);
    g.strokeRoundedRect(rugX + 3, rugY + 3, rugW - 6, rugH - 6, 7);

    // Inner decorative border — gold/amber trim
    g.lineStyle(2, 0xe8a030, 0.8);
    g.strokeRoundedRect(rugX + 10, rugY + 10, rugW - 20, rugH - 20, 4);

    // Fringe along top edge
    for (let fx = rugX + 12; fx < rugX + rugW - 12; fx += 8) {
      g.fillStyle(0xc45a08, 0.9);
      g.fillRect(fx, rugY - 4, 3, 6);
    }
    // Fringe along bottom edge
    for (let fx = rugX + 12; fx < rugX + rugW - 12; fx += 8) {
      g.fillStyle(0xc45a08, 0.9);
      g.fillRect(fx, rugY + rugH - 2, 3, 6);
    }

    // Corner tassels
    const tassel = (cx: number, cy: number) => {
      g.fillStyle(0xe8a030, 0.9);
      g.fillRect(cx - 2, cy, 4, 8);
      g.fillRect(cx - 5, cy, 3, 6);
      g.fillRect(cx + 3, cy, 3, 6);
    };
    tassel(rugX + 8, rugY + rugH - 1);
    tassel(rugX + rugW - 8, rugY + rugH - 1);
    tassel(rugX + 8, rugY - 7);
    tassel(rugX + rugW - 8, rugY - 7);

    g.setDepth(1);

    // "ENTER" text — bold white with subtle shadow
    const shadowText = this.add.text(rugX + rugW / 2 + 2, rugY + rugH / 2 + 2, 'ENTER', {
      fontFamily: 'monospace',
      fontSize: `${ts * 0.55}px`,
      color: '#000000',
      fontStyle: 'bold',
    });
    shadowText.setOrigin(0.5, 0.5);
    shadowText.setAlpha(0.3);
    shadowText.setDepth(2);

    const enterText = this.add.text(rugX + rugW / 2, rugY + rugH / 2, 'ENTER', {
      fontFamily: 'monospace',
      fontSize: `${ts * 0.55}px`,
      color: '#ffffff',
      fontStyle: 'bold',
    });
    enterText.setOrigin(0.5, 0.5);
    enterText.setDepth(2);
  }

  private triggerEntrance(): void {
    if (this.playerInScene) return;
    this.playerInScene = true;

    // Make player visible at the entrance (just below bottom wall)
    const entranceX = this.mapWidth * this.tileSize / 2;
    const startY = (this.mapHeight + 1) * this.tileSize;
    const targetY = (this.mapHeight - 3) * this.tileSize;
    this.player.setPosition(entranceX, startY);
    this.player.setVisible(true);

    // Tween player walking up into the office
    this.tweens.add({
      targets: this.player,
      y: targetY,
      duration: 1200,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.player.enableMovement();
        this.instructionText.setText(
          '[WASD/Arrows] Move  |  [Shift] Sprint  |  [E] Talk to agent / Exit'
        );
      },
    });
  }

  private createNPCs(): void {
    AGENTS.forEach(agentConfig => {
      const npc = new NPC(this, agentConfig, this.tileSize, this.spriteScale);
      this.npcs.push(npc);
    });
  }

  private async preStartAgentSessions(): Promise<void> {
    // Pre-start admin session specifically (Alice can edit game code)
    if (typeof window !== 'undefined' && window.copilotBridge) {
      const adminAgent = AGENTS.find(a => a.id === 'admin');
      const savedSessionId = await window.copilotBridge.getSessionId('admin');
      
      if (savedSessionId) {
        console.log(`[AgencyOffice] Resuming admin session: ${savedSessionId}`);
      } else {
        console.log('[AgencyOffice] Starting new admin session (no saved session found)');
      }
      
      await window.copilotBridge.terminalStart('admin', adminAgent?.workingDir);
      console.log('[AgencyOffice] Admin (Alice) session ready');
    }
  }

  update(): void {
    // Don't update if player hasn't entered, pong game, or terminal overlay is active
    if (!this.playerInScene || this.pongGame.getIsVisible() || !this.playerMovementEnabled) {
      return;
    }

    // Update player
    this.player.update();

    // Check for nearest NPC or desk
    this.updateNearestInteractable();

    // Check for ping pong table proximity
    this.updatePingPongProximity();

    // Check for exit door proximity
    this.updateExitDoorProximity();

    // Check for interaction (E key)
    if (Phaser.Input.Keyboard.JustDown(this.interactKey) && !this.terminalOverlay.getIsVisible()) {
      if (this.nearPingPong) {
        this.startPongGame();
      } else if (this.nearestExitDoor) {
        this.triggerExit();
      } else if (this.nearestNPC) {
        this.startConversation(this.nearestNPC.config);
      } else if (this.nearestDesk) {
        const agent = AGENTS.find(a => a.id === this.nearestDesk!.agentId);
        if (agent) {
          this.startConversation(agent);
        }
      }
    }
  }

  private updatePingPongProximity(): void {
    if (!this.pingPongTable) {
      this.nearPingPong = false;
      return;
    }

    const dist = Phaser.Math.Distance.Between(
      this.player.x, this.player.y,
      this.pingPongTable.x, this.pingPongTable.y
    );

    const interactionDistance = this.tileSize * 2;
    this.nearPingPong = dist < interactionDistance;

    if (this.nearPingPong && !this.terminalOverlay.getIsVisible()) {
      this.pingPongPrompt.setPosition(this.pingPongTable.x, this.pingPongTable.y - 40);
      this.pingPongPrompt.setVisible(true);
    } else {
      this.pingPongPrompt.setVisible(false);
    }
  }

  private startPongGame(): void {
    this.player.disableMovement();
    this.pingPongPrompt.setVisible(false);

    this.pongGame.show(() => {
      this.player.enableMovement();
    });
  }

  private updateExitDoorProximity(): void {
    const interactionDistance = this.tileSize * 2;
    let nearest: ExitDoor | null = null;
    let nearestDist = interactionDistance;

    this.exitDoors.forEach(door => {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, door.x, door.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = door;
      }
    });

    this.nearestExitDoor = nearest;

    if (nearest && !this.terminalOverlay.getIsVisible()) {
      this.exitPrompt.setPosition((nearest as ExitDoor).x, (nearest as ExitDoor).y - 40);
      this.exitPrompt.setVisible(true);
    } else {
      this.exitPrompt.setVisible(false);
    }
  }

  private triggerExit(): void {
    if (!this.playerInScene) return;
    this.playerInScene = false;
    this.player.disableMovement();
    this.exitPrompt.setVisible(false);

    const exitX = this.player.x;
    const exitY = (this.mapHeight + 2) * this.tileSize;

    this.tweens.add({
      targets: this.player,
      y: exitY,
      duration: 1000,
      ease: 'Sine.easeIn',
      onComplete: () => {
        this.player.setVisible(false);
        this.instructionText.setText('[Space / Enter] Enter the office');
      },
    });
  }

  private updateNearestInteractable(): void {
    // Scale interaction distance with tile size
    const interactionDistance = this.tileSize * 2;
    let nearestNPC: NPC | null = null;
    let nearestNPCDist = interactionDistance;
    let nearestDesk: DeskInfo | null = null;
    let nearestDeskDist = interactionDistance;
    
    // Check NPCs
    this.npcs.forEach(npc => {
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        npc.x, npc.y
      );
      
      if (dist < nearestNPCDist) {
        nearestNPCDist = dist;
        nearestNPC = npc;
      }
      
      npc.setNearPlayer(false);
    });
    
    // Check desks
    this.desks.forEach(desk => {
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        desk.x, desk.y
      );
      
      if (dist < nearestDeskDist) {
        nearestDeskDist = dist;
        nearestDesk = desk;
      }
    });
    
    // Prefer NPC if both are close, otherwise use whichever is closer
    if (nearestNPC && nearestNPCDist <= nearestDeskDist) {
      nearestNPC.setNearPlayer(true);
      this.nearestNPC = nearestNPC;
      this.nearestDesk = null;
    } else if (nearestDesk) {
      // Show indicator on the NPC associated with this desk
      const npc = this.npcs.find(n => n.config.id === nearestDesk!.agentId);
      if (npc) {
        npc.setNearPlayer(true);
      }
      this.nearestNPC = null;
      this.nearestDesk = nearestDesk;
    } else {
      this.nearestNPC = null;
      this.nearestDesk = null;
    }
  }

  private startConversation(agent: AgentConfig): void {
    if (this.playerInScene) {
      this.player.disableMovement();
    }

    // Emit to main.ts so it can open the terminal panel
    this.game.events.emit('agent:interact', agent.id);

    this.terminalOverlay.show(
      agent,
      () => {
        if (this.playerInScene) {
          this.player.enableMovement();
        }
        // Update badges when closing terminal
        this.updateSessionBadges();
      }
    );
  }

  private async updateSessionBadges(): Promise<void> {
    const officeId = officeManager.currentOfficeId;
    for (const npc of this.npcs) {
      if (officeId) {
        const status = officeManager.getAgentStatus(officeId, npc.config.id);
        npc.updateAgentStatus(status);
      } else {
        const hasSession = await this.terminalOverlay.hasSession(npc.config.id);
        npc.setHasActiveSession(hasSession);
      }
    }
  }
}
