import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { NPC } from '../entities/NPC';
import { TerminalOverlay } from '../ui/TerminalOverlay';
import { PongGame } from '../ui/PongGame';
import { VolleyballGame } from '../ui/VolleyballGame';
import { ArcadeGame } from '../ui/ArcadeGame';
import { AGENTS, AgentConfig } from '../config/agents';

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

// Feature flags
const ENABLE_PING_PONG = true;
const ENABLE_VOLLEYBALL = false;
const ENABLE_DECORATIONS = true;
const ENABLE_MCDONALDS = false;
const ENABLE_ARCADE = true;

export class OfficeScene extends Phaser.Scene {
  private player!: Player;
  private npcs: NPC[] = [];
  private desks: DeskInfo[] = [];
  private terminalOverlay!: TerminalOverlay;
  private pongGame!: PongGame;
  private volleyballGame!: VolleyballGame;
  private arcadeGame!: ArcadeGame;
  private pingPongTable: GameTable | null = null;
  private volleyballCourt: GameTable | null = null;
  private mcdonaldsStand: GameTable | null = null;
  private arcadeMachine: GameTable | null = null;
  private nearPingPong: boolean = false;
  private nearVolleyball: boolean = false;
  private nearMcdonalds: boolean = false;
  private nearArcade: boolean = false;
  private pingPongPrompt!: Phaser.GameObjects.Text;
  private volleyballPrompt!: Phaser.GameObjects.Text;
  private mcdonaldsPrompt!: Phaser.GameObjects.Text;
  private arcadePrompt!: Phaser.GameObjects.Text;
  private tileSize: number = 64; // Bigger tiles!
  private mapWidth: number = 27; // Added 2 tiles to right
  private mapHeight: number = 16;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private nearestNPC: NPC | null = null;
  private nearestDesk: DeskInfo | null = null;
  private titleText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private spriteScale: number = 1;

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
    
    // Create player at the boss desk area
    this.player = new Player(
      this,
      this.mapWidth * this.tileSize / 2,
      (this.mapHeight - 3) * this.tileSize
    );
    this.player.setScale(this.spriteScale);
    this.player.setDepth(50); // Player always in front
    
    // Create NPCs
    this.createNPCs();
    
    // Create terminal overlay (replaces dialog box)
    this.terminalOverlay = new TerminalOverlay(this);
    
    // Create pong game overlay
    this.pongGame = new PongGame(this);
    
    // Create volleyball game overlay
    this.volleyballGame = new VolleyballGame(this);
    
    // Create arcade game overlay
    this.arcadeGame = new ArcadeGame(this);
    
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
    
    // Create volleyball prompt (hidden by default)
    this.volleyballPrompt = this.add.text(0, 0, '[E] Play Volleyball', {
      font: 'bold 14px monospace',
      color: '#ffcc00',
      backgroundColor: '#000000',
      padding: { x: 8, y: 4 },
    });
    this.volleyballPrompt.setOrigin(0.5, 1);
    this.volleyballPrompt.setDepth(100);
    this.volleyballPrompt.setVisible(false);
    
    // Create McDonald's nuggets prompt (hidden by default)
    this.mcdonaldsPrompt = this.add.text(0, 0, '🍟 [E] Buy McNuggets', {
      font: 'bold 14px monospace',
      color: '#ffc72c',
      backgroundColor: '#da291c',
      padding: { x: 8, y: 4 },
    });
    this.mcdonaldsPrompt.setOrigin(0.5, 1);
    this.mcdonaldsPrompt.setDepth(100);
    this.mcdonaldsPrompt.setVisible(false);
    
    // Create arcade prompt (hidden by default)
    this.arcadePrompt = this.add.text(0, 0, '🕹️ [E] Play Asteroids', {
      font: 'bold 14px monospace',
      color: '#00ffff',
      backgroundColor: '#1a1a1a',
      padding: { x: 8, y: 4 },
    });
    this.arcadePrompt.setOrigin(0.5, 1);
    this.arcadePrompt.setDepth(100);
    this.arcadePrompt.setVisible(false);
    
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
    this.titleText = this.add.text(screenWidth / 2, 10, '🏢 COPILOT OFFICE', {
      font: `bold ${titleFontSize}px monospace`,
      color: '#ffffff',
    });
    this.titleText.setOrigin(0.5, 0);
    this.titleText.setScrollFactor(0);
    this.titleText.setDepth(100);
    
    // Add instructions
    this.instructionText = this.add.text(screenWidth / 2, screenHeight - 20, 
      '[WASD/Arrows] Move  |  [Shift] Sprint  |  [E] Talk to agent', {
      font: `${instructionFontSize}px monospace`,
      color: '#888888',
    });
    this.instructionText.setOrigin(0.5, 1);
    this.instructionText.setScrollFactor(0);
    this.instructionText.setDepth(100);

    // Camera setup - no follow needed since room fits
    this.cameras.main.setBounds(0, 0, this.mapWidth * this.tileSize, this.mapHeight * this.tileSize);
    this.cameras.main.centerOn(this.mapWidth * this.tileSize / 2, this.mapHeight * this.tileSize / 2);
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
      const windowType = (x >= 10 && x <= 14) ? 'window_sun' : 'window';
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
    
    // Bottom wall (decorative)
    for (let x = 1; x < this.mapWidth - 1; x++) {
      addDecor(x * this.tileSize + this.tileSize/2, (this.mapHeight - 1) * this.tileSize + this.tileSize/2, 'wall');
    }
    
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
      
      // Computer on desk
      addDecor(deskX, deskY - 16 * scale, 'computer').setDepth(1);
    });
    
    // Boss desk at center bottom (large desk) - NO collision so player can walk through
    const bossDeskX = this.mapWidth * this.tileSize / 2;
    const bossDeskY = (this.mapHeight - 4) * this.tileSize + this.tileSize/2;
    
    // Create larger boss desk (3 tiles wide) - decorative only, no collision
    for (let i = -1; i <= 1; i++) {
      addDecor(bossDeskX + i * this.tileSize, bossDeskY, 'desk');
    }
    
    // Boss computer
    addDecor(bossDeskX, bossDeskY - 16 * scale, 'computer').setDepth(1);
    
    // Boss chair (behind desk, where player spawns)
    addDecor(bossDeskX, bossDeskY + this.tileSize, 'chair');
    
    // "YOU" label - scale font with screen
    const labelFontSize = Math.max(12, Math.floor(this.tileSize / 4));
    this.add.text(bossDeskX, bossDeskY + this.tileSize + this.tileSize/2, 'YOU', {
      font: `bold ${labelFontSize}px monospace`,
      color: '#ffcc00',
    }).setOrigin(0.5, 0);
    
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
      addDecor(2 * this.tileSize + this.tileSize/2, 4 * this.tileSize + this.tileSize/2, 'bookshelf');
      addDecor(2 * this.tileSize + this.tileSize/2, 5 * this.tileSize + this.tileSize/2, 'bookshelf');
      
      // Filing cabinets near boss desk
      addDecor(8 * this.tileSize + this.tileSize/2, (this.mapHeight - 3) * this.tileSize + this.tileSize/2, 'cabinet');
      addDecor((this.mapWidth - 9) * this.tileSize + this.tileSize/2, (this.mapHeight - 3) * this.tileSize + this.tileSize/2, 'cabinet');
      
      // Whiteboard on right side
      const whiteboardSprite = this.add.sprite(
        (this.mapWidth - 3) * this.tileSize + this.tileSize/2,
        4 * this.tileSize + this.tileSize/2,
        'whiteboard'
      );
      whiteboardSprite.setScale(scale);
      
      // Wall clock near top
      addDecor(6 * this.tileSize + this.tileSize/2, 2 * this.tileSize + this.tileSize/2, 'clock');
      addDecor((this.mapWidth - 7) * this.tileSize + this.tileSize/2, 2 * this.tileSize + this.tileSize/2, 'clock');
      
      // Couch in break area (right side)
      const couchSprite = this.add.sprite(
        (this.mapWidth - 4) * this.tileSize + this.tileSize/2,
        (this.mapHeight - 4) * this.tileSize + this.tileSize/2,
        'couch'
      );
      couchSprite.setScale(scale);
      
      // Trash cans near desks
      addDecor(4 * this.tileSize + this.tileSize/2, 6 * this.tileSize + this.tileSize/2, 'trash');
      addDecor((this.mapWidth - 5) * this.tileSize + this.tileSize/2, 6 * this.tileSize + this.tileSize/2, 'trash');
      
      // Wall art/posters
      addDecor(10 * this.tileSize + this.tileSize/2, 2 * this.tileSize + this.tileSize/2, 'poster');
      addDecor((this.mapWidth - 11) * this.tileSize + this.tileSize/2, 2 * this.tileSize + this.tileSize/2, 'poster');
      
      // More plants for ambiance
      addDecor(5 * this.tileSize + this.tileSize/2, (this.mapHeight - 5) * this.tileSize + this.tileSize/2, 'plant');
      addDecor((this.mapWidth - 6) * this.tileSize + this.tileSize/2, (this.mapHeight - 5) * this.tileSize + this.tileSize/2, 'plant');
    }
    
    // Add a carpet/rug in the middle area
    this.createCarpet(this.mapWidth / 2, this.mapHeight / 2 + 1, 8, 4);
    
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
    
    // Volleyball court (right of center)
    if (ENABLE_VOLLEYBALL) {
      const volleyballX = Math.floor(this.mapWidth / 2 + 3) * this.tileSize + this.tileSize / 2;
      const volleyballY = Math.floor(this.mapHeight / 2) * this.tileSize + this.tileSize / 2;
      const volleyballSprite = addDecor(volleyballX, volleyballY, 'volleyball');
      volleyballSprite.setScale(scale);
      volleyballSprite.setDepth(5);
      
      // Track volleyball court for interaction
      this.volleyballCourt = {
        sprite: volleyballSprite,
        x: volleyballX,
        y: volleyballY,
      };
    }
    
    // McDonald's nuggets stand (right side of building)
    if (ENABLE_MCDONALDS) {
      const mcdonaldsX = (this.mapWidth - 4) * this.tileSize + this.tileSize / 2;
      const mcdonaldsY = Math.floor(this.mapHeight / 2 + 2) * this.tileSize + this.tileSize / 2;
      const mcdonaldsSprite = addDecor(mcdonaldsX, mcdonaldsY, 'mcdonalds');
      mcdonaldsSprite.setScale(scale);
      mcdonaldsSprite.setDepth(5);
      
      // Track McDonald's stand for interaction
      this.mcdonaldsStand = {
        sprite: mcdonaldsSprite,
        x: mcdonaldsX,
        y: mcdonaldsY,
      };
    }
    
    // Arcade machine (right of center, near the break area)
    if (ENABLE_ARCADE) {
      const arcadeX = Math.floor(this.mapWidth / 2 + 3) * this.tileSize + this.tileSize / 2;
      const arcadeY = Math.floor(this.mapHeight / 2) * this.tileSize + this.tileSize / 2;
      const arcadeSprite = addDecor(arcadeX, arcadeY, 'arcade');
      arcadeSprite.setScale(scale);
      arcadeSprite.setDepth(5);
      
      // Track arcade machine for interaction
      this.arcadeMachine = {
        sprite: arcadeSprite,
        x: arcadeX,
        y: arcadeY,
      };
    }
  }

  private createCarpet(centerX: number, centerY: number, width: number, height: number): void {
    const carpetGraphics = this.add.graphics();
    carpetGraphics.fillStyle(0x4a3728, 0.6);
    carpetGraphics.fillRect(
      (centerX - width / 2) * this.tileSize,
      (centerY - height / 2) * this.tileSize,
      width * this.tileSize,
      height * this.tileSize
    );
    carpetGraphics.lineStyle(2, 0x6a4738, 0.8);
    carpetGraphics.strokeRect(
      (centerX - width / 2) * this.tileSize + 4,
      (centerY - height / 2) * this.tileSize + 4,
      width * this.tileSize - 8,
      height * this.tileSize - 8
    );
    carpetGraphics.setDepth(-1);
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
        console.log(`[CopilotOffice] Resuming admin session: ${savedSessionId}`);
      } else {
        console.log('[CopilotOffice] Starting new admin session (no saved session found)');
      }
      
      await window.copilotBridge.terminalStart('admin', adminAgent?.workingDir);
      console.log('[CopilotOffice] Admin (Alice) session ready');
    }
  }

  update(): void {
    // Don't update if any mini-game is active
    if (this.pongGame.getIsVisible() || this.volleyballGame.getIsVisible() || this.arcadeGame.getIsVisible()) {
      return;
    }
    
    // Update player
    this.player.update();
    
    // Check for nearest NPC or desk
    this.updateNearestInteractable();
    
    // Check for ping pong table proximity
    this.updatePingPongProximity();
    
    // Check for volleyball court proximity
    this.updateVolleyballProximity();
    
    // Check for McDonald's proximity
    this.updateMcdonaldsProximity();
    
    // Check for arcade machine proximity
    this.updateArcadeProximity();
    
    // Check for interaction (E key)
    if (Phaser.Input.Keyboard.JustDown(this.interactKey) && !this.terminalOverlay.getIsVisible()) {
      if (this.nearMcdonalds) {
        // Buy nuggets!
        this.buyNuggets();
      } else if (this.nearArcade) {
        // Start arcade game
        this.startArcadeGame();
      } else if (this.nearPingPong) {
        // Start pong game
        this.startPongGame();
      } else if (this.nearVolleyball) {
        // Start volleyball game
        this.startVolleyballGame();
      } else if (this.nearestNPC) {
        this.startConversation(this.nearestNPC.config);
      } else if (this.nearestDesk) {
        // Find the agent for this desk
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
    
    // Show/hide prompt
    if (this.nearPingPong && !this.terminalOverlay.getIsVisible() && !this.nearVolleyball) {
      this.pingPongPrompt.setPosition(this.pingPongTable.x, this.pingPongTable.y - 40);
      this.pingPongPrompt.setVisible(true);
    } else {
      this.pingPongPrompt.setVisible(false);
    }
  }

  private updateVolleyballProximity(): void {
    if (!this.volleyballCourt) {
      this.nearVolleyball = false;
      return;
    }
    
    const dist = Phaser.Math.Distance.Between(
      this.player.x, this.player.y,
      this.volleyballCourt.x, this.volleyballCourt.y
    );
    
    const interactionDistance = this.tileSize * 2;
    this.nearVolleyball = dist < interactionDistance;
    
    // Show/hide prompt (volleyball takes priority if player is closer to it)
    if (this.nearVolleyball && !this.terminalOverlay.getIsVisible()) {
      // Check if volleyball is closer than ping pong
      const pingPongDist = this.pingPongTable ? 
        Phaser.Math.Distance.Between(this.player.x, this.player.y, this.pingPongTable.x, this.pingPongTable.y) : 
        Infinity;
      
      if (dist <= pingPongDist) {
        this.volleyballPrompt.setPosition(this.volleyballCourt.x, this.volleyballCourt.y - 40);
        this.volleyballPrompt.setVisible(true);
        this.pingPongPrompt.setVisible(false);
      }
    } else {
      this.volleyballPrompt.setVisible(false);
    }
  }

  private updateMcdonaldsProximity(): void {
    if (!this.mcdonaldsStand) {
      this.nearMcdonalds = false;
      return;
    }
    
    const dist = Phaser.Math.Distance.Between(
      this.player.x, this.player.y,
      this.mcdonaldsStand.x, this.mcdonaldsStand.y
    );
    
    const interactionDistance = this.tileSize * 2;
    this.nearMcdonalds = dist < interactionDistance;
    
    // Show/hide prompt
    if (this.nearMcdonalds && !this.terminalOverlay.getIsVisible()) {
      this.mcdonaldsPrompt.setPosition(this.mcdonaldsStand.x, this.mcdonaldsStand.y - 40);
      this.mcdonaldsPrompt.setVisible(true);
    } else {
      this.mcdonaldsPrompt.setVisible(false);
    }
  }

  private buyNuggets(): void {
    this.mcdonaldsPrompt.setVisible(false);
    
    // Show a fun nugget purchase message
    const messages = [
      "🍗 You got a 10-piece McNuggets! Yum!",
      "🍟 Enjoy your crispy nuggets with BBQ sauce!",
      "🍗 Ba da ba ba ba... I'm lovin' it!",
      "🍟 20-piece? You're hungry! Here you go!",
      "🍗 Spicy nuggets? Bold choice! Enjoy!",
    ];
    const message = messages[Math.floor(Math.random() * messages.length)];
    
    // Create floating text
    const floatingText = this.add.text(
      this.mcdonaldsStand!.x, 
      this.mcdonaldsStand!.y - 60,
      message,
      {
        font: 'bold 16px monospace',
        color: '#ffc72c',
        backgroundColor: '#da291c',
        padding: { x: 10, y: 6 },
      }
    );
    floatingText.setOrigin(0.5, 1);
    floatingText.setDepth(200);
    
    // Animate and destroy
    this.tweens.add({
      targets: floatingText,
      y: floatingText.y - 50,
      alpha: 0,
      duration: 2000,
      ease: 'Power2',
      onComplete: () => floatingText.destroy(),
    });
  }

  private startPongGame(): void {
    this.player.disableMovement();
    this.pingPongPrompt.setVisible(false);
    
    this.pongGame.show(() => {
      this.player.enableMovement();
    });
  }

  private startVolleyballGame(): void {
    this.player.disableMovement();
    this.volleyballPrompt.setVisible(false);
    
    this.volleyballGame.show(() => {
      this.player.enableMovement();
    });
  }

  private updateArcadeProximity(): void {
    if (!this.arcadeMachine) {
      this.nearArcade = false;
      return;
    }
    
    const dist = Phaser.Math.Distance.Between(
      this.player.x, this.player.y,
      this.arcadeMachine.x, this.arcadeMachine.y
    );
    
    const interactionDistance = this.tileSize * 2;
    this.nearArcade = dist < interactionDistance;
    
    // Show/hide prompt (arcade takes priority if closer than ping pong)
    if (this.nearArcade && !this.terminalOverlay.getIsVisible()) {
      const pingPongDist = this.pingPongTable ? 
        Phaser.Math.Distance.Between(this.player.x, this.player.y, this.pingPongTable.x, this.pingPongTable.y) : 
        Infinity;
      
      if (dist <= pingPongDist) {
        this.arcadePrompt.setPosition(this.arcadeMachine.x, this.arcadeMachine.y - 40);
        this.arcadePrompt.setVisible(true);
        this.pingPongPrompt.setVisible(false);
      }
    } else {
      this.arcadePrompt.setVisible(false);
    }
  }

  private startArcadeGame(): void {
    this.player.disableMovement();
    this.arcadePrompt.setVisible(false);
    
    this.arcadeGame.show(() => {
      this.player.enableMovement();
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
    this.player.disableMovement();
    
    this.terminalOverlay.show(
      agent,
      () => {
        this.player.enableMovement();
        // Update badges when closing terminal
        this.updateSessionBadges();
      }
    );
  }

  private async updateSessionBadges(): Promise<void> {
    for (const npc of this.npcs) {
      const hasSession = await this.terminalOverlay.hasSession(npc.config.id);
      npc.setHasActiveSession(hasSession);
    }
  }
}
