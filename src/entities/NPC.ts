import Phaser from 'phaser';
import { AgentConfig } from '../config/agents';

export class NPC extends Phaser.Physics.Arcade.Sprite {
  public config: AgentConfig;
  private nameLabel!: Phaser.GameObjects.Text;
  private descriptionLabel!: Phaser.GameObjects.Text;
  private indicator!: Phaser.GameObjects.Sprite;
  private sessionBadge!: Phaser.GameObjects.Graphics;
  private sessionText!: Phaser.GameObjects.Text;
  private highlightGlow!: Phaser.GameObjects.Graphics;
  private highlightRing!: Phaser.GameObjects.Graphics;
  private isHighlighted: boolean = false;
  private highlightTween: Phaser.Tweens.Tween | null = null;
  private isNearPlayer: boolean = false;
  private hasActiveSession: boolean = false;
  private spriteScale: number = 1;

  constructor(scene: Phaser.Scene, config: AgentConfig, tileSize: number, spriteScale: number = 1) {
    const x = config.position.x * tileSize + tileSize / 2;
    const y = config.position.y * tileSize + tileSize / 2;
    
    super(scene, x, y, config.sprite);
    this.config = config;
    this.spriteScale = spriteScale;
    
    scene.add.existing(this);
    scene.physics.add.existing(this, true); // Static body
    
    // Scale sprite
    this.setScale(spriteScale);
    this.setSize(28 * spriteScale, 28 * spriteScale);
    this.setOffset(2 * spriteScale, 4 * spriteScale);

    // Highlight glow shown on hover (behind sprite)
    this.highlightGlow = scene.add.graphics();
    this.highlightGlow.setPosition(x, y);
    this.highlightGlow.setVisible(false);
    this.highlightGlow.setDepth(4);
    const gr = 17 * spriteScale;
    this.highlightGlow.fillStyle(0xffff88, 0.25);
    this.highlightGlow.fillCircle(0, 0, gr * 1.4);
    this.highlightGlow.lineStyle(2, 0xffdd44, 0.7);
    this.highlightGlow.strokeRoundedRect(-gr, -gr, gr * 2, gr * 2, 4 * spriteScale);

    // Highlight ring shown when this NPC's terminal is open
    this.highlightRing = scene.add.graphics();
    this.highlightRing.setPosition(x, y);
    this.highlightRing.setAlpha(0);
    this.highlightRing.setDepth(3);
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
    this.nameLabel.setDepth(10);

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
    this.descriptionLabel.setDepth(10);

    // Add session badge (shows when there's an active conversation)
    this.sessionBadge = scene.add.graphics();
    this.sessionBadge.setPosition(x + 16 * spriteScale, y - 24 * spriteScale);
    this.sessionBadge.setDepth(11);
    this.updateSessionBadge(spriteScale);
    
    // Session message count text
    this.sessionText = scene.add.text(x + 16 * spriteScale, y - 24 * spriteScale, '', {
      font: `bold ${badgeFontSize}px monospace`,
      color: '#ffffff',
    });
    this.sessionText.setOrigin(0.5, 0.5);
    this.sessionText.setVisible(false);
    this.sessionText.setDepth(12);
    
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
    if (this.hasActiveSession) {
      // Draw green circle badge
      this.sessionBadge.fillStyle(0x00cc44, 1);
      this.sessionBadge.fillCircle(0, 0, 8 * scale);
      this.sessionBadge.lineStyle(1, 0x00ff66, 1);
      this.sessionBadge.strokeCircle(0, 0, 8 * scale);
    }
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

  setHighlighted(on: boolean): void {
    if (this.isHighlighted === on) return;
    this.isHighlighted = on;

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
    this.updateSessionBadge();
    
    if (hasSession && messageCount !== undefined && messageCount > 0) {
      this.sessionText.setText(messageCount.toString());
      this.sessionText.setVisible(true);
    } else {
      this.sessionText.setVisible(false);
    }
  }

  destroy(fromScene?: boolean): void {
    this.nameLabel.destroy();
    this.descriptionLabel.destroy();
    this.indicator.destroy();
    this.highlightGlow.destroy();
    this.highlightRing.destroy();
    this.sessionBadge.destroy();
    this.sessionText.destroy();
    super.destroy(fromScene);
  }
}
