import Phaser from 'phaser';
import { Depths, ySortDepth } from '../config/depths';
import { Direction, getStandFrame } from '../sprites/DirectionalSprite';
import { MeetingPlan } from '../meeting/types';
import { InputManager } from '../input/InputManager';
import { TerminalOverlay } from '../ui/TerminalOverlay';
import { AGENTS } from '../config/agents';

export class MeetingScene extends Phaser.Scene {
  private tileSize: number = 64;
  private mapWidth: number = 16;
  private mapHeight: number = 10;
  private playerSprite!: Phaser.GameObjects.Sprite;
  private arthurSprite!: Phaser.GameObjects.Sprite;
  private meetingPlan: MeetingPlan | null = null;
  private inputManager!: InputManager;
  private terminalOverlay!: TerminalOverlay;

  constructor() {
    super({ key: 'MeetingScene' });
  }

  create(): void {
    const worldW = this.mapWidth * this.tileSize;
    const worldH = this.mapHeight * this.tileSize;

    this.physics.world.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setBounds(0, 0, worldW, worldH);

    // Dark background fill
    this.add.rectangle(worldW / 2, worldH / 2, worldW, worldH, 0x1a1a2e)
      .setDepth(Depths.BACKGROUND);

    this.createMeetingRoom();

    // Place Arthur above the table (facing down)
    const arthurX = 8 * this.tileSize;
    const arthurY = 3.5 * this.tileSize;
    this.arthurSprite = this.add.sprite(arthurX, arthurY, 'npc_architect', getStandFrame(Direction.DOWN))
      .setDepth(ySortDepth(arthurY, worldH));

    // Place Player below the table (facing up toward Arthur)
    const playerX = 8 * this.tileSize;
    const playerY = 6.5 * this.tileSize;
    this.playerSprite = this.add.sprite(playerX, playerY, 'player', getStandFrame(Direction.UP))
      .setDepth(ySortDepth(playerY, worldH));

    // Title text
    this.add.text(worldW / 2, 20, 'Meeting Room', {
      fontSize: '24px',
      fontFamily: 'monospace',
      color: '#ffffff',
    }).setOrigin(0.5, 0).setDepth(Depths.UI_OVERLAY);

    // Subtitle
    this.add.text(worldW / 2, 50, 'Planning session with Arthur', {
      fontSize: '14px',
      fontFamily: 'monospace',
      color: '#aaaaaa',
    }).setOrigin(0.5, 0).setDepth(Depths.UI_OVERLAY);

    // Create input manager for meeting scene
    this.inputManager = new InputManager(this);

    // Create terminal overlay and auto-open Arthur's terminal
    this.terminalOverlay = new TerminalOverlay(this, this.inputManager);
    
    const arthur = AGENTS.find(a => a.id === 'architect');
    if (arthur) {
      this.terminalOverlay.show(arthur, () => {
        // When terminal is closed in meeting, stay in meeting (don't exit)
        // User can still use plan approval UI or reopen
        console.log('[MeetingScene] Terminal closed');
      });
    }
  }

  private createMeetingRoom(): void {
    const worldH = this.mapHeight * this.tileSize;
    const ts = this.tileSize;
    const halfTile = ts / 2;

    // Floor tiles
    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        this.add.sprite(x * ts + halfTile, y * ts + halfTile, 'floor')
          .setDisplaySize(ts, ts)
          .setDepth(Depths.BACKGROUND);
      }
    }

    // Top wall (y=0)
    for (let x = 0; x < this.mapWidth; x++) {
      this.add.sprite(x * ts + halfTile, halfTile, 'wall')
        .setDisplaySize(ts, ts)
        .setDepth(Depths.WALLS);
    }

    // Bottom wall (y=mapHeight-1)
    for (let x = 0; x < this.mapWidth; x++) {
      this.add.sprite(x * ts + halfTile, (this.mapHeight - 1) * ts + halfTile, 'wall')
        .setDisplaySize(ts, ts)
        .setDepth(Depths.WALLS);
    }

    // Left wall (x=0)
    for (let y = 0; y < this.mapHeight; y++) {
      this.add.sprite(halfTile, y * ts + halfTile, 'wall')
        .setDisplaySize(ts, ts)
        .setDepth(Depths.WALLS);
    }

    // Right wall (x=mapWidth-1)
    for (let y = 0; y < this.mapHeight; y++) {
      this.add.sprite((this.mapWidth - 1) * ts + halfTile, y * ts + halfTile, 'wall')
        .setDisplaySize(ts, ts)
        .setDepth(Depths.WALLS);
    }

    // Double door on left wall, centered vertically (~y=4-5)
    const doorX = halfTile;
    const doorY = 4.5 * ts;
    this.add.sprite(doorX, doorY, 'meeting_double_door')
      .setDisplaySize(ts, ts * 1.5)
      .setDepth(Depths.WALLS);

    // Whiteboard on top wall, centered horizontally
    const whiteboardX = (this.mapWidth / 2) * ts;
    const whiteboardY = halfTile;
    this.add.sprite(whiteboardX, whiteboardY, 'meeting_whiteboard')
      .setDepth(Depths.WALLS);

    // Meeting table at center (tile 8, 5)
    const tableX = 8 * ts;
    const tableY = 5 * ts;
    this.add.sprite(tableX, tableY, 'meeting_table')
      .setDepth(ySortDepth(tableY, worldH));

    // Chair above table (Arthur's)
    const chairAboveY = 3.5 * ts - 20;
    this.add.sprite(tableX, chairAboveY, 'meeting_chair')
      .setDepth(ySortDepth(chairAboveY, worldH));

    // Chair below table (Player's)
    const chairBelowY = 6.5 * ts + 20;
    this.add.sprite(tableX, chairBelowY, 'meeting_chair')
      .setDepth(ySortDepth(chairBelowY, worldH));
  }

  getMeetingPlan(): MeetingPlan | null {
    return this.meetingPlan;
  }

  setMeetingPlan(plan: MeetingPlan): void {
    this.meetingPlan = plan;
  }

  getTerminalOverlay(): TerminalOverlay {
    return this.terminalOverlay;
  }

  exitMeeting(plan?: MeetingPlan): void {
    this.terminalOverlay?.hide();
    
    const doorX = this.tileSize * 1.5;
    const doorY = 4.5 * this.tileSize;
    
    // Short pause before walking
    this.time.delayedCall(500, () => {
      // Player walks to door first
      this.tweens.add({
        targets: this.playerSprite,
        x: doorX,
        y: doorY,
        duration: 800,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          this.playerSprite.setVisible(false);
        },
      });
      
      // Arthur follows slightly behind
      this.tweens.add({
        targets: this.arthurSprite,
        x: doorX,
        y: doorY,
        duration: 800,
        delay: 300,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          this.arthurSprite.setVisible(false);
          
          // Fade out after both reach the door
          this.cameras.main.fadeOut(500, 0, 0, 0);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.stop('MeetingScene');
            this.scene.wake('OfficeScene', { plan });
          });
        },
      });
    });
  }

  shutdown(): void {
    this.terminalOverlay?.hide();
    this.inputManager?.destroy();
    this.meetingPlan = null;
  }
}
