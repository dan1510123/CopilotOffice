import Phaser from 'phaser';
import { Depths } from '../config/depths';

// Focus contract (slice S1-A, baseline BL-008): mini-games stay in the `game`
// focus state. The Phaser keyboard remains enabled so the game's own keys
// (registered below via `addKey`) work alongside the gated focus model.
// Player movement is gated separately via `Player.disableMovement()` and the
// scene-level visibility check in `OfficeScene.update()`. Do NOT call
// `InputManager.suspendGameInput()` here — it would disable the mini-game's
// own keys.

interface Bullet {
  sprite: Phaser.GameObjects.Rectangle;
  active: boolean;
}

interface Enemy {
  sprite: Phaser.GameObjects.Rectangle;
  row: number;
  col: number;
  active: boolean;
  diving: boolean;
  diveVelX: number;
  diveVelY: number;
  type: 'flagship' | 'red' | 'blue' | 'basic';
}

interface EnemyBullet {
  sprite: Phaser.GameObjects.Rectangle;
  velX: number;
  velY: number;
  active: boolean;
}

interface Star {
  sprite: Phaser.GameObjects.Rectangle;
  speed: number;
}

export class GalaxianGame {
  private scene: Phaser.Scene;
  private container!: Phaser.GameObjects.Container;
  private isVisible: boolean = false;
  private onClose: (() => void) | null = null;

  // Dimensions
  private gameWidth: number = 480;
  private gameHeight: number = 520;
  private gameLeft: number = 0;
  private gameTop: number = 0;

  // Player
  private ship!: Phaser.GameObjects.Container;
  private shipX: number = 0;
  private lives: number = 3;
  private invincible: boolean = false;
  private invincibleTimer: number = 0;

  // Enemies
  private enemies: Enemy[] = [];
  private enemyDirection: number = 1;
  private enemySpeed: number = 0.3;
  private enemyMoveTimer: number = 0;
  private enemyMoveInterval: number = 50;
  private enemyShiftDown: boolean = false;

  // Bullets
  private playerBullet: Bullet | null = null;
  private enemyBullets: EnemyBullet[] = [];
  private enemyFireTimer: number = 0;
  private enemyFireInterval: number = 80;

  // Dive attack
  private diveTimer: number = 0;
  private diveInterval: number = 200;
  private maxDivers: number = 2;

  // Stars
  private stars: Star[] = [];

  // Score
  private score: number = 0;
  private highScore: number = 0;
  private wave: number = 1;
  private scoreText!: Phaser.GameObjects.Text;
  private highScoreText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private gameOverText!: Phaser.GameObjects.Text;

  // Game state
  private gameOver: boolean = false;
  private paused: boolean = false;

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private escKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;

  // Update event
  private updateEvent: (() => void) | null = null;

  // Constants
  private readonly SHIP_SPEED = 4;
  private readonly BULLET_SPEED = 7;
  private readonly ENEMY_COLS = 10;
  private readonly ENEMY_ROWS = 5;
  private readonly ENEMY_SIZE = 20;
  private readonly ENEMY_SPACING_X = 36;
  private readonly ENEMY_SPACING_Y = 30;
  private readonly SHIP_WIDTH = 24;
  private readonly SHIP_HEIGHT = 16;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.create();
  }

  private create(): void {
    const screenWidth = this.scene.cameras.main.width;
    const screenHeight = this.scene.cameras.main.height;

    this.gameWidth = Math.min(480, screenWidth - 80);
    this.gameHeight = Math.min(520, screenHeight - 80);

    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;
    this.gameLeft = centerX - this.gameWidth / 2;
    this.gameTop = centerY - this.gameHeight / 2;

    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(Depths.MINI_GAMES);
    this.container.setVisible(false);

    // Dark overlay
    const overlay = this.scene.add.rectangle(
      screenWidth / 2, screenHeight / 2,
      screenWidth, screenHeight, 0x000000, 0.9
    );
    this.container.add(overlay);

    // Game background (space)
    const bg = this.scene.add.rectangle(
      centerX, centerY,
      this.gameWidth, this.gameHeight, 0x000011
    );
    bg.setStrokeStyle(2, 0x3344aa);
    this.container.add(bg);

    // Starfield
    this.createStarfield();

    // Title
    this.titleText = this.scene.add.text(centerX, this.gameTop - 35, '👾 GALAXIAN', {
      font: 'bold 28px monospace',
      color: '#00ffff',
    });
    this.titleText.setOrigin(0.5, 0.5);
    this.container.add(this.titleText);

    // Score display
    this.scoreText = this.scene.add.text(this.gameLeft + 10, this.gameTop + 8, 'SCORE: 0', {
      font: 'bold 14px monospace',
      color: '#ffffff',
    });
    this.container.add(this.scoreText);

    this.highScoreText = this.scene.add.text(
      this.gameLeft + this.gameWidth - 10, this.gameTop + 8, 'HI: 0', {
        font: 'bold 14px monospace',
        color: '#ffcc00',
      }
    );
    this.highScoreText.setOrigin(1, 0);
    this.container.add(this.highScoreText);

    // Lives
    this.livesText = this.scene.add.text(this.gameLeft + 10, this.gameTop + this.gameHeight - 22, '♥♥♥', {
      font: 'bold 16px monospace',
      color: '#ff4444',
    });
    this.container.add(this.livesText);

    // Wave indicator
    this.waveText = this.scene.add.text(
      this.gameLeft + this.gameWidth - 10, this.gameTop + this.gameHeight - 22, 'WAVE 1', {
        font: 'bold 14px monospace',
        color: '#44ff44',
      }
    );
    this.waveText.setOrigin(1, 0);
    this.container.add(this.waveText);

    // Instructions
    this.instructionText = this.scene.add.text(
      centerX, this.gameTop + this.gameHeight + 25,
      '[← →] Move  |  [SPACE] Fire  |  [ESC] Exit', {
        font: '14px monospace',
        color: '#aaaaaa',
      }
    );
    this.instructionText.setOrigin(0.5, 0);
    this.container.add(this.instructionText);

    // Game over text (hidden)
    this.gameOverText = this.scene.add.text(centerX, centerY, '', {
      font: 'bold 32px monospace',
      color: '#ff4444',
    });
    this.gameOverText.setOrigin(0.5, 0.5);
    this.container.add(this.gameOverText);

    // Create player ship
    this.ship = this.createShip(centerX, this.gameTop + this.gameHeight - 50);
    this.shipX = centerX;

    // Input
    if (this.scene.input.keyboard) {
      this.cursors = this.scene.input.keyboard.createCursorKeys();
      this.escKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
      this.spaceKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    }
  }

  private createShip(x: number, y: number): Phaser.GameObjects.Container {
    const shipContainer = this.scene.add.container(x, y);

    // Ship body - classic triangular fighter
    const body = this.scene.add.rectangle(0, 0, 20, 12, 0x00ccff);
    const nose = this.scene.add.triangle(0, -10, -4, 0, 4, 0, 0, -8, 0x00ffff);
    const wingL = this.scene.add.triangle(-12, 4, 0, -4, 0, 4, -6, 4, 0x0088cc);
    const wingR = this.scene.add.triangle(12, 4, 0, -4, 0, 4, 6, 4, 0x0088cc);
    const engine = this.scene.add.rectangle(0, 8, 8, 4, 0xff8800);

    shipContainer.add([body, nose, wingL, wingR, engine]);
    this.container.add(shipContainer);
    return shipContainer;
  }

  private createStarfield(): void {
    for (let i = 0; i < 50; i++) {
      const x = this.gameLeft + Math.random() * this.gameWidth;
      const y = this.gameTop + Math.random() * this.gameHeight;
      const size = Math.random() < 0.3 ? 2 : 1;
      const brightness = Math.random() * 0.5 + 0.3;
      const star = this.scene.add.rectangle(x, y, size, size, 0xffffff, brightness);
      this.container.add(star);
      this.stars.push({ sprite: star, speed: 0.3 + Math.random() * 0.7 });
    }
  }

  private spawnEnemies(): void {
    // Clear old enemies
    for (const e of this.enemies) {
      e.sprite.destroy();
    }
    this.enemies = [];

    const gridWidth = this.ENEMY_COLS * this.ENEMY_SPACING_X;
    const startX = this.gameLeft + (this.gameWidth - gridWidth) / 2 + this.ENEMY_SPACING_X / 2;
    const startY = this.gameTop + 50;

    const rowTypes: Enemy['type'][] = ['flagship', 'red', 'red', 'blue', 'basic'];

    for (let row = 0; row < this.ENEMY_ROWS; row++) {
      for (let col = 0; col < this.ENEMY_COLS; col++) {
        const x = startX + col * this.ENEMY_SPACING_X;
        const y = startY + row * this.ENEMY_SPACING_Y;
        const type = rowTypes[row];

        const color = type === 'flagship' ? 0xffff00
          : type === 'red' ? 0xff4444
          : type === 'blue' ? 0x6666ff
          : 0x44ffcc;

        const sprite = this.scene.add.rectangle(x, y, this.ENEMY_SIZE, this.ENEMY_SIZE * 0.7, color);
        sprite.setStrokeStyle(1, 0xffffff, 0.3);
        this.container.add(sprite);

        // Add pixel-art "wings" using small rectangles
        const wingL = this.scene.add.rectangle(x - 10, y + 3, 4, 6, color, 0.7);
        const wingR = this.scene.add.rectangle(x + 10, y + 3, 4, 6, color, 0.7);
        this.container.add(wingL);
        this.container.add(wingR);

        // Eyes
        const eyeL = this.scene.add.rectangle(x - 4, y - 2, 3, 3, 0x000000);
        const eyeR = this.scene.add.rectangle(x + 4, y - 2, 3, 3, 0x000000);
        this.container.add(eyeL);
        this.container.add(eyeR);

        this.enemies.push({
          sprite,
          row,
          col,
          active: true,
          diving: false,
          diveVelX: 0,
          diveVelY: 0,
          type,
        });
      }
    }
  }

  show(onClose: () => void): void {
    this.onClose = onClose;
    this.isVisible = true;
    this.container.setVisible(true);

    // Reset game state
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.gameOver = false;
    this.paused = false;
    this.invincible = false;
    this.invincibleTimer = 0;
    this.enemyDirection = 1;
    this.enemySpeed = 0.3;
    this.enemyMoveTimer = 0;
    this.enemyFireTimer = 0;
    this.diveTimer = 0;
    this.enemyFireInterval = 80;
    this.diveInterval = 200;
    this.maxDivers = 2;

    this.scoreText.setText('SCORE: 0');
    this.highScoreText.setText(`HI: ${this.highScore}`);
    this.livesText.setText('♥'.repeat(this.lives));
    this.waveText.setText('WAVE 1');
    this.gameOverText.setText('');
    this.instructionText.setText('[← →] Move  |  [SPACE] Fire  |  [ESC] Exit');

    // Reset ship position
    const centerX = this.scene.cameras.main.width / 2;
    this.shipX = centerX;
    this.ship.x = centerX;
    this.ship.y = this.gameTop + this.gameHeight - 50;
    this.ship.setVisible(true);
    this.ship.setAlpha(1);

    // Clear bullets
    if (this.playerBullet?.sprite) {
      this.playerBullet.sprite.destroy();
    }
    this.playerBullet = null;
    for (const b of this.enemyBullets) {
      b.sprite.destroy();
    }
    this.enemyBullets = [];

    this.spawnEnemies();

    // Start update loop
    this.updateEvent = () => this.update();
    this.scene.events.on('update', this.updateEvent);
  }

  hide(): void {
    this.isVisible = false;
    this.container.setVisible(false);

    if (this.updateEvent) {
      this.scene.events.off('update', this.updateEvent);
      this.updateEvent = null;
    }

    // Clean up bullets
    if (this.playerBullet?.sprite) {
      this.playerBullet.sprite.destroy();
      this.playerBullet = null;
    }
    for (const b of this.enemyBullets) {
      b.sprite.destroy();
    }
    this.enemyBullets = [];

    // Clean up enemies
    for (const e of this.enemies) {
      e.sprite.destroy();
    }
    this.enemies = [];

    if (this.onClose) {
      this.onClose();
      this.onClose = null;
    }
  }

  private update(): void {
    if (!this.isVisible) return;

    // ESC to exit
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.hide();
      return;
    }

    // Scroll starfield
    for (const star of this.stars) {
      star.sprite.y += star.speed;
      if (star.sprite.y > this.gameTop + this.gameHeight) {
        star.sprite.y = this.gameTop;
        star.sprite.x = this.gameLeft + Math.random() * this.gameWidth;
      }
    }

    if (this.gameOver) {
      if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
        this.show(this.onClose!);
      }
      return;
    }

    this.updatePlayer();
    this.updatePlayerBullet();
    this.updateEnemies();
    this.updateEnemyBullets();
    this.updateDiveAttacks();
    this.checkCollisions();
    this.checkWaveComplete();

    if (this.invincible) {
      this.invincibleTimer--;
      this.ship.setAlpha(Math.sin(this.invincibleTimer * 0.3) > 0 ? 1 : 0.3);
      if (this.invincibleTimer <= 0) {
        this.invincible = false;
        this.ship.setAlpha(1);
      }
    }
  }

  private updatePlayer(): void {
    const aKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    const dKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    if (this.cursors.left.isDown || aKey?.isDown) {
      this.shipX -= this.SHIP_SPEED;
    } else if (this.cursors.right.isDown || dKey?.isDown) {
      this.shipX += this.SHIP_SPEED;
    }

    // Clamp to game bounds
    const halfW = this.SHIP_WIDTH / 2;
    this.shipX = Phaser.Math.Clamp(this.shipX, this.gameLeft + halfW + 4, this.gameLeft + this.gameWidth - halfW - 4);
    this.ship.x = this.shipX;

    // Fire
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey) && !this.playerBullet) {
      const bullet = this.scene.add.rectangle(this.shipX, this.ship.y - 14, 3, 10, 0x00ffff);
      this.container.add(bullet);
      this.playerBullet = { sprite: bullet, active: true };
    }
  }

  private updatePlayerBullet(): void {
    if (!this.playerBullet) return;
    this.playerBullet.sprite.y -= this.BULLET_SPEED;

    if (this.playerBullet.sprite.y < this.gameTop) {
      this.playerBullet.sprite.destroy();
      this.playerBullet = null;
    }
  }

  private updateEnemies(): void {
    this.enemyMoveTimer++;
    if (this.enemyMoveTimer < this.enemyMoveInterval) return;
    this.enemyMoveTimer = 0;

    const activeEnemies = this.enemies.filter(e => e.active && !e.diving);
    if (activeEnemies.length === 0) return;

    // Check bounds
    let minX = Infinity, maxX = -Infinity;
    for (const e of activeEnemies) {
      if (e.sprite.x < minX) minX = e.sprite.x;
      if (e.sprite.x > maxX) maxX = e.sprite.x;
    }

    const rightEdge = this.gameLeft + this.gameWidth - 20;
    const leftEdge = this.gameLeft + 20;

    if (this.enemyShiftDown) {
      for (const e of activeEnemies) {
        e.sprite.y += 8;
      }
      this.enemyShiftDown = false;
      // Speed up slightly as formation descends
      this.enemyMoveInterval = Math.max(8, this.enemyMoveInterval - 2);
    } else {
      const dx = this.enemySpeed * this.enemyDirection * 12;
      for (const e of activeEnemies) {
        e.sprite.x += dx;
      }

      if (maxX + this.enemyDirection * 12 > rightEdge || minX + this.enemyDirection * 12 < leftEdge) {
        this.enemyDirection *= -1;
        this.enemyShiftDown = true;
      }
    }

    // Speed up as fewer enemies remain
    const totalActive = this.enemies.filter(e => e.active).length;
    if (totalActive <= 5) {
      this.enemyMoveInterval = Math.max(5, 15);
    } else if (totalActive <= 15) {
      this.enemyMoveInterval = Math.max(10, 25);
    }

    // Enemy firing
    this.enemyFireTimer++;
    if (this.enemyFireTimer >= this.enemyFireInterval) {
      this.enemyFireTimer = 0;
      this.fireEnemyBullet();
    }
  }

  private fireEnemyBullet(): void {
    const activeEnemies = this.enemies.filter(e => e.active && !e.diving);
    if (activeEnemies.length === 0) return;

    // Pick random enemy from bottom rows first
    const bottomEnemies = this.getBottomRowEnemies();
    const shooter = bottomEnemies.length > 0
      ? bottomEnemies[Math.floor(Math.random() * bottomEnemies.length)]
      : activeEnemies[Math.floor(Math.random() * activeEnemies.length)];

    const bullet = this.scene.add.rectangle(
      shooter.sprite.x, shooter.sprite.y + 8,
      3, 8, 0xff4444
    );
    this.container.add(bullet);

    // Slight aim toward player
    const dx = this.shipX - shooter.sprite.x;
    const aimFactor = 0.3;
    this.enemyBullets.push({
      sprite: bullet,
      velX: dx * aimFactor * 0.02,
      velY: 3 + this.wave * 0.3,
      active: true,
    });
  }

  private getBottomRowEnemies(): Enemy[] {
    const columnBottoms = new Map<number, Enemy>();
    for (const e of this.enemies) {
      if (!e.active || e.diving) continue;
      const existing = columnBottoms.get(e.col);
      if (!existing || e.row > existing.row) {
        columnBottoms.set(e.col, e);
      }
    }
    return Array.from(columnBottoms.values());
  }

  private updateEnemyBullets(): void {
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i];
      b.sprite.x += b.velX;
      b.sprite.y += b.velY;

      if (b.sprite.y > this.gameTop + this.gameHeight + 10 ||
          b.sprite.x < this.gameLeft - 10 ||
          b.sprite.x > this.gameLeft + this.gameWidth + 10) {
        b.sprite.destroy();
        this.enemyBullets.splice(i, 1);
      }
    }
  }

  private updateDiveAttacks(): void {
    this.diveTimer++;
    if (this.diveTimer < this.diveInterval) return;
    this.diveTimer = 0;

    const currentDivers = this.enemies.filter(e => e.active && e.diving).length;
    if (currentDivers >= this.maxDivers) return;

    const candidates = this.enemies.filter(e => e.active && !e.diving);
    if (candidates.length === 0) return;

    // Prefer flagships and reds for diving
    const priority = candidates.filter(e => e.type === 'flagship' || e.type === 'red');
    const pool = priority.length > 0 ? priority : candidates;
    const diver = pool[Math.floor(Math.random() * pool.length)];

    diver.diving = true;
    const dx = this.shipX - diver.sprite.x;
    diver.diveVelX = dx * 0.008 + (Math.random() - 0.5) * 1.5;
    diver.diveVelY = 2.5 + this.wave * 0.2;

    // Fire while diving
    const bullet = this.scene.add.rectangle(
      diver.sprite.x, diver.sprite.y + 8,
      3, 8, 0xffaa00
    );
    this.container.add(bullet);
    this.enemyBullets.push({
      sprite: bullet,
      velX: diver.diveVelX * 0.5,
      velY: diver.diveVelY + 1,
      active: true,
    });
  }

  private checkCollisions(): void {
    // Player bullet vs enemies
    if (this.playerBullet) {
      const bx = this.playerBullet.sprite.x;
      const by = this.playerBullet.sprite.y;

      for (const e of this.enemies) {
        if (!e.active) continue;
        const ex = e.sprite.x;
        const ey = e.sprite.y;
        const hw = this.ENEMY_SIZE / 2;
        const hh = this.ENEMY_SIZE * 0.35;

        if (bx > ex - hw && bx < ex + hw && by > ey - hh && by < ey + hh) {
          // Hit!
          e.active = false;
          e.sprite.setVisible(false);

          // Score based on type
          const points = e.type === 'flagship' ? 60
            : e.type === 'red' ? 40
            : e.type === 'blue' ? 20
            : 10;
          const diveBonus = e.diving ? points : 0;
          this.score += points + diveBonus;
          this.scoreText.setText(`SCORE: ${this.score}`);
          if (this.score > this.highScore) {
            this.highScore = this.score;
            this.highScoreText.setText(`HI: ${this.highScore}`);
          }

          // Explosion effect
          this.spawnExplosion(ex, ey, e.type === 'flagship' ? 0xffff00 : 0xff8800);

          this.playerBullet.sprite.destroy();
          this.playerBullet = null;
          break;
        }
      }
    }

    // Enemy bullets vs player
    if (!this.invincible) {
      for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
        const b = this.enemyBullets[i];
        if (this.hitTestShip(b.sprite.x, b.sprite.y)) {
          b.sprite.destroy();
          this.enemyBullets.splice(i, 1);
          this.playerHit();
          break;
        }
      }
    }

    // Diving enemies vs player
    if (!this.invincible) {
      for (const e of this.enemies) {
        if (!e.active || !e.diving) continue;
        if (this.hitTestShip(e.sprite.x, e.sprite.y)) {
          e.active = false;
          e.sprite.setVisible(false);
          this.spawnExplosion(e.sprite.x, e.sprite.y, 0xff4444);
          this.playerHit();
          break;
        }
      }
    }

    // Update diving enemies position
    for (const e of this.enemies) {
      if (!e.active || !e.diving) continue;
      e.sprite.x += e.diveVelX;
      e.sprite.y += e.diveVelY;

      // Wrap or deactivate when off-screen
      if (e.sprite.y > this.gameTop + this.gameHeight + 20) {
        e.active = false;
        e.sprite.setVisible(false);
      }
    }
  }

  private hitTestShip(x: number, y: number): boolean {
    const dx = Math.abs(x - this.shipX);
    const dy = Math.abs(y - this.ship.y);
    return dx < this.SHIP_WIDTH / 2 + 4 && dy < this.SHIP_HEIGHT / 2 + 4;
  }

  private playerHit(): void {
    this.lives--;
    this.livesText.setText('♥'.repeat(Math.max(0, this.lives)));

    this.spawnExplosion(this.shipX, this.ship.y, 0x00ccff);

    if (this.lives <= 0) {
      this.ship.setVisible(false);
      this.gameOver = true;
      this.gameOverText.setText('GAME OVER\n\n[SPACE] Retry');
      this.gameOverText.setAlign('center');
      this.instructionText.setText('[SPACE] Restart  |  [ESC] Exit');
    } else {
      // Brief invincibility
      this.invincible = true;
      this.invincibleTimer = 120;
      // Reset ship position
      this.shipX = this.scene.cameras.main.width / 2;
      this.ship.x = this.shipX;
    }
  }

  private spawnExplosion(x: number, y: number, color: number): void {
    const particles: Phaser.GameObjects.Rectangle[] = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const p = this.scene.add.rectangle(x, y, 4, 4, color);
      this.container.add(p);
      particles.push(p);

      this.scene.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * 25,
        y: y + Math.sin(angle) * 25,
        alpha: 0,
        scaleX: 0,
        scaleY: 0,
        duration: 300,
        ease: 'Power2',
        onComplete: () => p.destroy(),
      });
    }
  }

  private checkWaveComplete(): void {
    const remaining = this.enemies.filter(e => e.active).length;
    if (remaining > 0) return;

    this.wave++;
    this.waveText.setText(`WAVE ${this.wave}`);

    // Scale difficulty
    this.enemySpeed = 0.3 + this.wave * 0.05;
    this.enemyMoveInterval = Math.max(15, 50 - this.wave * 3);
    this.enemyFireInterval = Math.max(30, 80 - this.wave * 5);
    this.diveInterval = Math.max(80, 200 - this.wave * 15);
    this.maxDivers = Math.min(5, 2 + Math.floor(this.wave / 2));

    // Clear remaining bullets
    for (const b of this.enemyBullets) {
      b.sprite.destroy();
    }
    this.enemyBullets = [];

    if (this.playerBullet?.sprite) {
      this.playerBullet.sprite.destroy();
      this.playerBullet = null;
    }

    // Flash wave text
    this.scene.tweens.add({
      targets: this.waveText,
      alpha: { from: 0, to: 1 },
      duration: 200,
      repeat: 3,
      yoyo: true,
    });

    this.spawnEnemies();
  }

  getIsVisible(): boolean {
    return this.isVisible;
  }
}
