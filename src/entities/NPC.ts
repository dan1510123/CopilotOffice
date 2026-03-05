import Phaser from 'phaser';
import { AgentConfig } from '../config/agents';

export class NPC extends Phaser.Physics.Arcade.Sprite {
  public config: AgentConfig;
  private nameLabel!: Phaser.GameObjects.Text;
  private indicator!: Phaser.GameObjects.Sprite;
  private sessionBadge!: Phaser.GameObjects.Graphics;
  private sessionText!: Phaser.GameObjects.Text;
  private isNearPlayer: boolean = false;
  private hasActiveSession: boolean = false;

  constructor(scene: Phaser.Scene, config: AgentConfig, tileSize: number, spriteScale: number = 1) {
    const x = config.position.x * tileSize + tileSize / 2;
    const y = config.position.y * tileSize + tileSize / 2;
    
    super(scene, x, y, config.sprite);
    this.config = config;
    
    scene.add.existing(this);
    scene.physics.add.existing(this, true); // Static body
    
    // Scale sprite
    this.setScale(spriteScale);
    this.setSize(28 * spriteScale, 28 * spriteScale);
    this.setOffset(2 * spriteScale, 4 * spriteScale);
    
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
    this.indicator.destroy();
    this.sessionBadge.destroy();
    this.sessionText.destroy();
    super.destroy(fromScene);
  }
}
