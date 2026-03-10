import Phaser from 'phaser';
import { Depths, ySortDepth } from '../config/depths';
import { Direction, getStandFrame } from '../sprites/DirectionalSprite';
import { MeetingPlan } from '../meeting/types';
import { InputManager } from '../input/InputManager';
import { TerminalOverlay } from '../ui/TerminalOverlay';
import { PlanApprovalOverlay } from '../meeting/planApproval';
import { parsePlanFromOutput } from '../meeting/planParser';
import { officeManager } from '../office/officeManager';
import { AGENTS } from '../config/agents';

export class MeetingScene extends Phaser.Scene {
  private tileSize: number = 64;
  private mapWidth: number = 6;
  private mapHeight: number = 5;
  private playerSprite!: Phaser.GameObjects.Sprite;
  private arthurSprite!: Phaser.GameObjects.Sprite;
  private meetingPlan: MeetingPlan | null = null;
  private inputManager!: InputManager;
  private terminalOverlay!: TerminalOverlay;
  private planApproval!: PlanApprovalOverlay;
  private terminalOutputBuffer: string = '';
  private terminalDataCleanup: (() => void) | null = null;
  private leaveMeetingCleanup: (() => void) | null = null;
  private isExiting: boolean = false;

  constructor() {
    super({ key: 'MeetingScene' });
  }

  create(): void {
    const worldW = this.mapWidth * this.tileSize;
    const worldH = this.mapHeight * this.tileSize;

    this.isExiting = false;
    this.terminalOutputBuffer = '';

    this.physics.world.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setBounds(0, 0, worldW, worldH);

    // Zoom camera 3x for cozy meeting room
    this.cameras.main.setZoom(3);
    this.cameras.main.centerOn(worldW / 2, worldH / 2);

    // Dark background fill
    this.add.rectangle(worldW / 2, worldH / 2, worldW, worldH, 0x1a1a2e)
      .setDepth(Depths.BACKGROUND);

    this.createMeetingRoom();

    // Center of the room for table/characters
    const centerX = (this.mapWidth / 2) * this.tileSize;

    // Place Arthur above the table (facing down)
    const arthurY = 1.2 * this.tileSize;
    this.arthurSprite = this.add.sprite(centerX, arthurY, 'npc_architect', getStandFrame(Direction.DOWN))
      .setDepth(ySortDepth(arthurY, worldH));

    // Place Player below the table (facing up toward Arthur)
    const playerY = 3.3 * this.tileSize;
    this.playerSprite = this.add.sprite(centerX, playerY, 'player', getStandFrame(Direction.UP))
      .setDepth(ySortDepth(playerY, worldH));

    // Title text (scaled down for zoom)
    this.add.text(worldW / 2, 4, 'Meeting Room', {
      fontSize: '8px',
      fontFamily: 'monospace',
      color: '#ffffff',
    }).setOrigin(0.5, 0).setDepth(Depths.UI_OVERLAY);

    // Ctrl+Enter to leave meeting (works even when terminal is focused)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter' && !this.isExiting) {
        e.preventDefault();
        this.exitMeeting();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    this.leaveMeetingCleanup = () => document.removeEventListener('keydown', onKeyDown, true);

    // DOM "Leave Meeting" button (visible above the game panel)
    this.createLeaveButton();

    // DOM "Start Fleet V-Team" button
    this.createFleetButton();

    // Create input manager for meeting scene
    this.inputManager = new InputManager(this);

    // Create plan approval overlay
    this.planApproval = new PlanApprovalOverlay();

    // Create terminal overlay and auto-open Arthur's terminal
    this.terminalOverlay = new TerminalOverlay(this, this.inputManager, () => officeManager.currentOfficeId || 'office-0');

    const arthur = AGENTS.find(a => a.id === 'architect');
    if (arthur) {
      this.terminalOverlay.show(arthur, () => {
        console.log('[MeetingScene] Terminal closed');
      });
    }

    // Listen for terminal output to detect plans
    this.setupPlanDetection();
  }

  private leaveButton: HTMLButtonElement | null = null;
  private fleetButton: HTMLButtonElement | null = null;
  private fleetDialog: HTMLDivElement | null = null;

  private createLeaveButton(): void {
    this.leaveButton = document.createElement('button');
    this.leaveButton.textContent = '🚪 Leave Meeting (Ctrl+Enter)';
    Object.assign(this.leaveButton.style, {
      position: 'fixed',
      bottom: '70px',
      left: '16px',
      padding: '8px 16px',
      background: '#333',
      color: '#ccc',
      border: '1px solid #555',
      borderRadius: '6px',
      fontFamily: 'monospace',
      fontSize: '12px',
      cursor: 'pointer',
      zIndex: '10001',
    });
    this.leaveButton.addEventListener('mouseenter', () => {
      if (this.leaveButton) this.leaveButton.style.background = '#555';
    });
    this.leaveButton.addEventListener('mouseleave', () => {
      if (this.leaveButton) this.leaveButton.style.background = '#333';
    });
    this.leaveButton.addEventListener('click', () => {
      if (!this.isExiting) this.exitMeeting();
    });
    document.body.appendChild(this.leaveButton);
  }

  private createFleetButton(): void {
    this.fleetButton = document.createElement('button');
    this.fleetButton.textContent = '🚀 Start Fleet V-Team';
    Object.assign(this.fleetButton.style, {
      position: 'fixed',
      bottom: '70px',
      left: '260px',
      padding: '8px 16px',
      background: '#1a3a5c',
      color: '#4fc3f7',
      border: '1px solid #4488cc',
      borderRadius: '6px',
      fontFamily: 'monospace',
      fontSize: '12px',
      cursor: 'pointer',
      zIndex: '10001',
    });
    this.fleetButton.addEventListener('mouseenter', () => {
      if (this.fleetButton) this.fleetButton.style.background = '#254a6e';
    });
    this.fleetButton.addEventListener('mouseleave', () => {
      if (this.fleetButton) this.fleetButton.style.background = '#1a3a5c';
    });
    this.fleetButton.addEventListener('click', () => {
      this.showFleetDeployDialog();
    });
    document.body.appendChild(this.fleetButton);
  }

  private showFleetDeployDialog(): void {
    if (this.fleetDialog) return;

    const overlay = document.createElement('div');
    this.fleetDialog = overlay;
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      background: 'rgba(0, 0, 0, 0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '20000',
    });

    const dialog = document.createElement('div');
    Object.assign(dialog.style, {
      background: '#1a1a2a',
      border: '2px solid #4488cc',
      borderRadius: '12px',
      padding: '24px',
      width: '420px',
      maxWidth: '90vw',
      fontFamily: 'monospace',
      color: '#ccc',
    });

    dialog.innerHTML = `
      <h3 style="margin: 0 0 16px 0; color: #4fc3f7; font-size: 16px;">🚀 Deploy Fleet V-Team</h3>
      <label style="display: block; margin-bottom: 4px; font-size: 12px; color: #888;">Office Name</label>
      <input id="fleet-office-name" type="text" value="Fleet V-Team"
        style="width: 100%; padding: 8px; margin-bottom: 12px; background: #252538; color: #ccc;
               border: 1px solid #555; border-radius: 4px; font-family: monospace; font-size: 13px;
               box-sizing: border-box;" />
      <label style="display: block; margin-bottom: 4px; font-size: 12px; color: #888;">Fleet Prompt</label>
      <textarea id="fleet-prompt" rows="5" placeholder="Describe the mission for the fleet..."
        style="width: 100%; padding: 8px; margin-bottom: 16px; background: #252538; color: #ccc;
               border: 1px solid #555; border-radius: 4px; font-family: monospace; font-size: 13px;
               resize: vertical; box-sizing: border-box;"></textarea>
      <div style="display: flex; justify-content: flex-end; gap: 10px;">
        <button id="fleet-cancel" style="padding: 8px 16px; background: #333; color: #ccc;
                border: 1px solid #555; border-radius: 6px; font-family: monospace; cursor: pointer;">Cancel</button>
        <button id="fleet-deploy" style="padding: 8px 20px; background: #1a5c3a; color: #4fc3f7;
                border: 1px solid #4488cc; border-radius: 6px; font-family: monospace; font-size: 13px;
                font-weight: bold; cursor: pointer;">🚀 DEPLOY FLEET</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const nameInput = dialog.querySelector('#fleet-office-name') as HTMLInputElement;
    const promptInput = dialog.querySelector('#fleet-prompt') as HTMLTextAreaElement;
    const cancelBtn = dialog.querySelector('#fleet-cancel') as HTMLButtonElement;
    const deployBtn = dialog.querySelector('#fleet-deploy') as HTMLButtonElement;

    const closeDialog = () => {
      overlay.remove();
      this.fleetDialog = null;
    };

    cancelBtn.addEventListener('click', closeDialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });

    deployBtn.addEventListener('click', () => {
      const officeName = nameInput.value.trim() || 'Fleet V-Team';
      const prompt = promptInput.value.trim();
      if (!prompt) {
        promptInput.style.border = '1px solid #cc4444';
        promptInput.focus();
        return;
      }
      closeDialog();
      // Emit deploy event with the source office ID so main.ts can write to existing terminal
      const sourceOfficeId = officeManager.currentOfficeId || 'office-0';
      this.game.events.emit('fleet:deploy-requested', { officeName, prompt, sourceOfficeId });
      // Leave the meeting room
      this.exitMeeting();
    });

    promptInput.focus();
  }

  private setupPlanDetection(): void {
    if (typeof window === 'undefined' || !window.copilotBridge) return;

    const handler = (_agentId: string, data: string) => {
      if (_agentId !== 'architect') return;
      this.terminalOutputBuffer += data;

      // Debounced check for plan in output
      this.time.delayedCall(500, () => {
        if (this.isExiting) return;
        const plan = parsePlanFromOutput(this.terminalOutputBuffer);
        if (plan && !this.meetingPlan) {
          this.meetingPlan = plan;
          console.log('[MeetingScene] Plan detected:', plan.plan);
          this.showPlanApproval(plan);
        }
      });
    };

    window.copilotBridge.onTerminalData(handler);
    this.terminalDataCleanup = () => {
      window.copilotBridge?.removeTerminalListeners?.();
    };
  }

  private showPlanApproval(plan: MeetingPlan): void {
    this.planApproval.show(plan, {
      onApprove: (approvedPlan) => {
        console.log('[MeetingScene] Plan approved');
        this.exitMeeting(approvedPlan);
      },
      onRevise: (feedback) => {
        console.log('[MeetingScene] Revision requested:', feedback);
        // Send feedback to Arthur's terminal
        if (window.copilotBridge) {
          window.copilotBridge.terminalWrite(officeManager.currentOfficeId || 'office-0', 'architect', feedback + '\r');
        }
        // Reset plan detection for the revised output
        this.meetingPlan = null;
        this.terminalOutputBuffer = '';
      },
      onCancel: () => {
        console.log('[MeetingScene] Plan cancelled');
        this.meetingPlan = null;
      },
    });
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

    // Bottom wall
    for (let x = 0; x < this.mapWidth; x++) {
      this.add.sprite(x * ts + halfTile, (this.mapHeight - 1) * ts + halfTile, 'wall')
        .setDisplaySize(ts, ts)
        .setDepth(Depths.WALLS);
    }

    // Left wall
    for (let y = 0; y < this.mapHeight; y++) {
      this.add.sprite(halfTile, y * ts + halfTile, 'wall')
        .setDisplaySize(ts, ts)
        .setDepth(Depths.WALLS);
    }

    // Right wall
    for (let y = 0; y < this.mapHeight; y++) {
      this.add.sprite((this.mapWidth - 1) * ts + halfTile, y * ts + halfTile, 'wall')
        .setDisplaySize(ts, ts)
        .setDepth(Depths.WALLS);
    }

    // Double door on left wall, centered vertically
    const doorX = halfTile;
    const doorY = 2.5 * ts;
    this.add.sprite(doorX, doorY, 'meeting_double_door')
      .setDisplaySize(ts, ts * 1.5)
      .setDepth(Depths.WALLS);

    // Whiteboard on top wall, centered
    const whiteboardX = (this.mapWidth / 2) * ts;
    const whiteboardY = halfTile;
    this.add.sprite(whiteboardX, whiteboardY, 'meeting_whiteboard')
      .setDisplaySize(ts * 2, ts * 0.8)
      .setDepth(Depths.WALLS);

    // Meeting table at center
    const centerX = (this.mapWidth / 2) * ts;
    const tableY = 2.25 * ts;
    this.add.sprite(centerX, tableY, 'meeting_table')
      .setDisplaySize(ts * 2.5, ts * 1.2)
      .setDepth(ySortDepth(tableY, worldH));

    // Chair above table (Arthur's)
    const chairAboveY = 1.2 * ts - 10;
    this.add.sprite(centerX, chairAboveY, 'meeting_chair')
      .setDepth(ySortDepth(chairAboveY, worldH));

    // Chair below table (Player's)
    const chairBelowY = 3.3 * ts + 10;
    this.add.sprite(centerX, chairBelowY, 'meeting_chair')
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
    if (this.isExiting) return;
    this.isExiting = true;

    this.planApproval?.hide();
    this.terminalOverlay?.hide();
    this.leaveButton?.remove();
    this.leaveButton = null;
    this.fleetButton?.remove();
    this.fleetButton = null;
    this.fleetDialog?.remove();
    this.fleetDialog = null;

    const doorX = this.tileSize * 0.8;
    const doorY = 2.5 * this.tileSize;

    // Short pause before walking
    this.time.delayedCall(300, () => {
      // Player walks to door first
      this.tweens.add({
        targets: this.playerSprite,
        x: doorX,
        y: doorY,
        duration: 600,
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
        duration: 600,
        delay: 200,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          this.arthurSprite.setVisible(false);

          this.cameras.main.fadeOut(400, 0, 0, 0);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.stop('MeetingScene');
            this.scene.wake('OfficeScene', { plan });
          });
        },
      });
    });
  }

  shutdown(): void {
    this.terminalDataCleanup?.();
    this.terminalDataCleanup = null;
    this.leaveMeetingCleanup?.();
    this.leaveMeetingCleanup = null;
    this.leaveButton?.remove();
    this.leaveButton = null;
    this.fleetButton?.remove();
    this.fleetButton = null;
    this.fleetDialog?.remove();
    this.fleetDialog = null;
    this.planApproval?.hide();
    this.terminalOverlay?.hide();
    this.inputManager?.destroy();
    this.meetingPlan = null;
    this.terminalOutputBuffer = '';
    this.isExiting = false;
  }
}
