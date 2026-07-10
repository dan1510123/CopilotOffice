import Phaser from 'phaser';
import { AgentConfig } from '../config/agents';
import { AgentStatus } from '../office/officeManager';
import { Depths, ySortDepth } from '../config/depths';
import {
  STATUS_PRESENTATION,
  resolveStatusKey,
  type StatusKey,
} from '../config/agentStatusPresentation';
import {
  Direction, getStandFrame, registerWalkAnimations,
  walkAnimKey, directionFromVelocity,
} from '../sprites/DirectionalSprite';

export class NPC extends Phaser.Physics.Arcade.Sprite {
  public config: AgentConfig;
  private nameLabel!: Phaser.GameObjects.Text;
  private descriptionLabel!: Phaser.GameObjects.Text;
  private indicator!: Phaser.GameObjects.Sprite;
  private sessionBadge!: Phaser.GameObjects.Graphics;
  private sessionText!: Phaser.GameObjects.Text;
  private highlightGlow!: Phaser.GameObjects.Graphics;
  private highlightRing!: Phaser.GameObjects.Graphics;
  private _isHighlighted: boolean = false;

  get isHighlighted(): boolean { return this._isHighlighted; }
  private highlightTween: Phaser.Tweens.Tween | null = null;
  private badgePulseTween: Phaser.Tweens.Tween | null = null;
  private stallRing!: Phaser.GameObjects.Graphics;
  private stallTween: Phaser.Tweens.Tween | null = null;
  private isStalled: boolean = false;
  private isNearPlayer: boolean = false;
  private hasActiveSession: boolean = false;
  private currentBadgeState: string = 'slacking';
  private badgeHidden: boolean = false;
  private spriteScale: number = 1;

  constructor(scene: Phaser.Scene, config: AgentConfig, tileSize: number, spriteScale: number = 1) {
    const x = config.position.x * tileSize + tileSize / 2;
    const y = config.position.y * tileSize + tileSize / 2;
    
    super(scene, x, y, config.sprite, getStandFrame(Direction.DOWN));
    this.config = config;
    this.spriteScale = spriteScale;
    
    scene.add.existing(this);
    scene.physics.add.existing(this, false); // Dynamic body (immovable)
    (this.body as Phaser.Physics.Arcade.Body).setImmovable(true);
    (this.body as Phaser.Physics.Arcade.Body).moves = false;

    // Register walk animations for this NPC's spritesheet
    registerWalkAnimations(scene.anims, config.sprite);
    
    // Scale sprite — body size in world pixels, offset in FRAME coords (Phaser applies scale)
    this.setScale(spriteScale);
    this.setSize(8, 8);
    this.setOffset(12, 13); // center 8px body in 32x34 frame: (32-8)/2=12, (34-8)/2=13
    this.setDepth(ySortDepth(y, scene.physics.world.bounds.bottom));

    // Highlight glow shown on hover (behind sprite)
    this.highlightGlow = scene.add.graphics();
    this.highlightGlow.setPosition(x, y);
    this.highlightGlow.setVisible(false);
    this.highlightGlow.setDepth(Depths.NPC_EFFECTS);
    const gr = 17 * spriteScale;
    this.highlightGlow.fillStyle(0xffff88, 0.25);
    this.highlightGlow.fillCircle(0, 0, gr * 1.4);
    this.highlightGlow.lineStyle(2, 0xffdd44, 0.7);
    this.highlightGlow.strokeRoundedRect(-gr, -gr, gr * 2, gr * 2, 4 * spriteScale);

    // Highlight ring shown when this NPC's terminal is open
    this.highlightRing = scene.add.graphics();
    this.highlightRing.setPosition(x, y);
    this.highlightRing.setAlpha(0);
    this.highlightRing.setDepth(Depths.NPC_EFFECTS);
    this._drawHighlightRing(0x6677ff, spriteScale);

    // Make clickable and hoverable
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => {
      this.setTint(0xffdd88);
      this.highlightGlow.setVisible(true);
    });
    this.on('pointerout', () => {
      this.clearTint();
      this.highlightGlow.setVisible(false);
    });
    
    // Font sizes scale with tile size
    const nameFontSize = Math.max(12, Math.floor(tileSize / 4));
    const badgeFontSize = Math.max(10, Math.floor(tileSize / 6));
    
    // Add name label ABOVE NPC - support multi-line with \n
    const displayName = config.name.replace(' (', '\n(');
    this.nameLabel = scene.add.text(x, y - 28 * spriteScale, displayName, {
      font: `bold ${nameFontSize}px monospace`,
      color: '#ffffff',
      backgroundColor: '#000000cc',
      padding: { x: 6, y: 3 },
      align: 'center',
    });
    this.nameLabel.setOrigin(0.5, 1);
    this.nameLabel.setDepth(Depths.NPC_LABELS);

    // Add description label below the name, above the sprite
    const descFontSize = Math.max(10, Math.floor(tileSize / 5.5));
    this.descriptionLabel = scene.add.text(x, y - 28 * spriteScale, config.description, {
      font: `italic ${descFontSize}px monospace`,
      color: '#aaddff',
      backgroundColor: '#000000cc',
      padding: { x: 5, y: 2 },
      align: 'center',
    });
    this.descriptionLabel.setOrigin(0.5, 0);
    this.descriptionLabel.setDepth(Depths.NPC_LABELS);

    // Add session badge (shows when there's an active conversation)
    this.sessionBadge = scene.add.graphics();
    this.sessionBadge.setPosition(x + 16 * spriteScale, y - 24 * spriteScale);
    this.sessionBadge.setDepth(Depths.BADGES);
    this.updateSessionBadge(spriteScale);
    
    // Session status icon text
    this.sessionText = scene.add.text(x + 16 * spriteScale, y - 24 * spriteScale, STATUS_PRESENTATION.slacking.icon, {
      font: `bold ${badgeFontSize * 4}px monospace`,
      color: '#ffffff',
    });
    this.sessionText.setOrigin(0.5, 0.5);
    this.sessionText.setVisible(true);
    this.sessionText.setDepth(Depths.BADGES + 1);

    // Stall ring (FR-013): amber ring around the badge, shown only when the
    // agent has been idle-in-state past the stall threshold. Distinct from the
    // error state (red, no ring) and from the normal in-progress pulse — it
    // pulses on its own slower cadence to read as "stuck / needs attention".
    this.stallRing = scene.add.graphics();
    this.stallRing.setPosition(x + 16 * spriteScale, y - 24 * spriteScale);
    this.stallRing.setDepth(Depths.BADGES + 2);
    this.stallRing.setVisible(false);
    this.stallRing.lineStyle(2.5, 0xffb020, 0.95);
    this.stallRing.strokeCircle(0, 0, 20 * spriteScale);
    
    // Add interaction indicator (hidden by default) - above the name
    this.indicator = scene.add.sprite(x, y - 48 * spriteScale, 'indicator');
    this.indicator.setScale(0.6 * spriteScale);
    this.indicator.setVisible(false);
    
    // Pulsing animation for indicator
    scene.tweens.add({
      targets: this.indicator,
      y: y - 36 * spriteScale,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private updateSessionBadge(scale: number = 1): void {
    this.sessionBadge.clear();
    const stateKey = this.currentBadgeState as StatusKey;
    const pres = STATUS_PRESENTATION[stateKey] ?? STATUS_PRESENTATION.slacking;
    const isSlacking = stateKey === 'slacking';

    this.sessionBadge.fillStyle(pres.colorNum, isSlacking ? 0.7 : 1);
    this.sessionBadge.fillCircle(0, 0, 16 * scale);
    this.sessionBadge.lineStyle(2, pres.strokeNum, isSlacking ? 0.5 : 1);
    this.sessionBadge.strokeCircle(0, 0, 16 * scale);
  }

  private _drawHighlightRing(color: number, scale: number): void {
    this.highlightRing.clear();
    // Outer glow
    this.highlightRing.lineStyle(6, color, 0.3);
    this.highlightRing.strokeCircle(0, 0, 26 * scale);
    // Inner ring
    this.highlightRing.lineStyle(2, color, 1.0);
    this.highlightRing.strokeCircle(0, 0, 22 * scale);
    // Filled centre tint
    this.highlightRing.fillStyle(color, 0.12);
    this.highlightRing.fillCircle(0, 0, 22 * scale);
  }

  /** Change the NPC's facing direction (for future movement support). */
  setDirection(direction: Direction): void {
    this.setFrame(getStandFrame(direction));
  }

  /** Visual bump feedback when player collides with this NPC */
  bump(): void {
    if (this.scene.tweens.isTweening(this)) return;
    this.scene.tweens.add({
      targets: this,
      scaleX: this.spriteScale * 1.08,
      scaleY: this.spriteScale * 0.94,
      duration: 80,
      yoyo: true,
      ease: 'Sine.easeOut',
    });
  }

  setHighlighted(on: boolean): void {
    if (this._isHighlighted === on) return;
    this._isHighlighted = on;

    if (this.highlightTween) {
      this.highlightTween.stop();
      this.highlightTween = null;
    }

    if (on) {
      this._drawHighlightRing(0x6677ff, this.spriteScale);
      this.highlightRing.setAlpha(1);
      this.highlightTween = this.scene.tweens.add({
        targets: this.highlightRing,
        alpha: { from: 0.55, to: 1 },
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else {
      this.scene.tweens.add({
        targets: this.highlightRing,
        alpha: 0,
        duration: 200,
        ease: 'Sine.easeOut',
      });
    }
  }

  setNearPlayer(near: boolean): void {
    if (this.isNearPlayer !== near) {
      this.isNearPlayer = near;
      this.indicator.setVisible(near);
    }
  }

  getNearPlayer(): boolean {
    return this.isNearPlayer;
  }

  setHasActiveSession(hasSession: boolean, messageCount?: number): void {
    this.hasActiveSession = hasSession;
    if (!hasSession) {
      this.setStalled(false);
      this.updateBadgeForState('slacking');
      this.sessionText.setText(STATUS_PRESENTATION.slacking.icon);
      if (!this.badgeHidden) {
        this.sessionText.setVisible(true);
      }
      return;
    }
    
    if (hasSession && messageCount!== undefined && messageCount > 0) {
      this.sessionText.setText(messageCount.toString());
      if (!this.badgeHidden) {
        this.sessionText.setVisible(true);
      }
    } else {
      this.sessionText.setVisible(false);
    }
  }

  /** Toggle visibility of the status badge (circle + text). */
  setBadgeVisible(visible: boolean): void {
    this.badgeHidden = !visible;
    this.sessionBadge.setVisible(visible);
    this.sessionText.setVisible(visible);
    this.stallRing.setVisible(visible && this.isStalled);
  }

  /** Toggle visibility of name and description labels. */
  setLabelsVisible(visible: boolean): void {
    this.nameLabel.setVisible(visible);
    this.descriptionLabel.setVisible(visible);
  }

  /** Update the NPC badge to reflect the agent's full status */
  updateAgentStatus(status: AgentStatus | undefined): void {
    if (!status || status.state === 'slacking') {
      this.hasActiveSession = false;
      this.setStalled(false);
      this.updateBadgeForState('slacking');
      this.sessionText.setText(STATUS_PRESENTATION.slacking.icon);
      if (!this.badgeHidden) {
        this.sessionText.setVisible(true);
      }
      return;
    }

    this.hasActiveSession = true;
    const stateKey = resolveStatusKey(status);
    this.updateBadgeForState(stateKey);

    // Show canonical status icon in badge (shared across all surfaces)
    this.sessionText.setText(STATUS_PRESENTATION[stateKey].icon || '');
    if (!this.badgeHidden) {
      this.sessionText.setVisible(stateKey !== 'slacking');
    }
  }

  /**
   * FR-013: toggle the ~60s stall treatment. Shows an amber ring on a slower,
   * "laboring" pulse cadence (distinct from the normal in-progress pulse and
   * from the error state). Clearing it restores the badge to normal. Idempotent.
   */
  setStalled(on: boolean): void {
    if (this.isStalled === on) return;
    this.isStalled = on;

    if (this.stallTween) {
      this.stallTween.stop();
      this.stallTween = null;
    }

    if (on) {
      this.stallRing.setScale(1);
      this.stallRing.setAlpha(1);
      this.stallRing.setVisible(!this.badgeHidden);
      this.stallTween = this.scene.tweens.add({
        targets: this.stallRing,
        scaleX: { from: 0.85, to: 1.18 },
        scaleY: { from: 0.85, to: 1.18 },
        alpha: { from: 0.55, to: 1 },
        duration: 1100,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else {
      this.stallRing.setScale(1);
      this.stallRing.setVisible(false);
    }
  }

  /** True while the stall treatment is active (test/inspection aid). */
  get stalled(): boolean { return this.isStalled; }

  private updateBadgeForState(stateKey: string): void {
    if (this.currentBadgeState === stateKey) return;
    this.currentBadgeState = stateKey;

    // Stop existing pulse tween and reset scale BEFORE redrawing
    if (this.badgePulseTween) {
      this.badgePulseTween.stop();
      this.badgePulseTween = null;
    }
    this.sessionBadge.setScale(1);

    this.updateSessionBadge(this.spriteScale);

    const pres = STATUS_PRESENTATION[stateKey as StatusKey];
    if (pres?.badgeAnimation === 'pulse') {
      this.badgePulseTween = this.scene.tweens.add({
        targets: this.sessionBadge,
        scaleX: { from: 0.925, to: 1.075 },
        scaleY: { from: 0.925, to: 1.075 },
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  /** Tween-based scripted walk to a target position. Returns a Promise that resolves on arrival. */
  async walkTo(targetX: number, targetY: number, speed: number = 100): Promise<void> {
    return new Promise<void>((resolve) => {
      const dx = targetX - this.x;
      const dy = targetY - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 1) {
        resolve();
        return;
      }

      const duration = (distance / speed) * 1000;
      const direction = directionFromVelocity(dx, dy) ?? Direction.DOWN;

      // Play walk animation for the movement direction
      const animKey = walkAnimKey(this.config.sprite, direction);
      this.play(animKey, true);

      this.scene.tweens.add({
        targets: this,
        x: targetX,
        y: targetY,
        duration,
        ease: 'Linear',
        onUpdate: () => {
          // Update y-sort depth as NPC moves
          this.setDepth(ySortDepth(this.y, this.scene.physics.world.bounds.bottom));
          // Update attached labels/badges positions
          this.updateAttachedPositions();
        },
        onComplete: () => {
          this.stop(); // Stop walk animation
          this.setFrame(getStandFrame(direction));
          this.setDepth(ySortDepth(this.y, this.scene.physics.world.bounds.bottom));
          this.updateAttachedPositions();
          resolve();
        },
      });
    });
  }

  /** Walk through a series of waypoints sequentially. Each segment uses walkTo(). */
  async walkPath(waypoints: { x: number; y: number }[], speed: number = 100): Promise<void> {
    for (const wp of waypoints) {
      await this.walkTo(wp.x, wp.y, speed);
    }
  }

  /** Update positions of name label, description, badge, indicator relative to NPC. */
  public syncLabelPositions(): void {
    this.updateAttachedPositions();
  }

  private updateAttachedPositions(): void {
    const x = this.x;
    const y = this.y;
    const s = this.spriteScale;

    this.nameLabel.setPosition(x, y - 28 * s);
    this.descriptionLabel.setPosition(x, y - 28 * s);
    this.sessionBadge.setPosition(x + 16 * s, y - 24 * s);
    this.sessionText.setPosition(x + 16 * s, y - 24 * s);
    this.stallRing.setPosition(x + 16 * s, y - 24 * s);
    this.indicator.setPosition(x, this.indicator.y); // keep y from tween
    this.highlightGlow.setPosition(x, y);
    this.highlightRing.setPosition(x, y);
  }

  destroy(fromScene?: boolean): void {
    this.nameLabel.destroy();
    this.descriptionLabel.destroy();
    this.indicator.destroy();
    this.highlightGlow.destroy();
    this.highlightRing.destroy();
    this.sessionBadge.destroy();
    this.sessionText.destroy();
    this.stallRing.destroy();
    super.destroy(fromScene);
  }
}
