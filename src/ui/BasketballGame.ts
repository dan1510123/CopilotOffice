import Phaser from 'phaser';
import { Depths } from '../config/depths';

// Focus contract (slice S1-A, baseline BL-008): mini-games stay in the `game`
// focus state. The Phaser keyboard remains enabled so the game's own ESC/SPACE
// keys (registered below via `addKey`) work alongside the gated focus model.
// Player movement is gated separately via `Player.disableMovement()` and the
// scene-level visibility check in `OfficeScene.update()`. Do NOT call
// `InputManager.suspendGameInput()` here — it would disable the mini-game's
// own keys.

export class BasketballGame {
  private scene: Phaser.Scene;
  private container!: Phaser.GameObjects.Container;
  private isVisible: boolean = false;
  private onClose: (() => void) | null = null;

  // Game elements
  private background!: Phaser.GameObjects.Rectangle;
  private hoop!: Phaser.GameObjects.Rectangle;
  private hoopRimLeft!: Phaser.GameObjects.Rectangle;
  private hoopRimRight!: Phaser.GameObjects.Rectangle;
  private backboard!: Phaser.GameObjects.Rectangle;
  private ball!: Phaser.GameObjects.Arc;
  private powerBar!: Phaser.GameObjects.Rectangle;
  private powerFill!: Phaser.GameObjects.Rectangle;
  private aimLine!: Phaser.GameObjects.Line;

  // Score
  private score: number = 0;
  private attempts: number = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private attemptsText!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private streakText!: Phaser.GameObjects.Text;

  // Game state
  private phase: 'aiming' | 'charging' | 'flying' | 'scored' | 'missed' = 'aiming';
  private aimAngle: number = -Math.PI / 4; // Start at 45 degrees up
  private aimDirection: number = 1;
  private power: number = 0;
  private powerDirection: number = 1;
  private ballVelX: number = 0;
  private ballVelY: number = 0;
  private ballStartX: number = 0;
  private ballStartY: number = 0;
  private streak: number = 0;
  private bestStreak: number = 0;

  // Dimensions
  private gameWidth: number = 600;
  private gameHeight: number = 450;

  // Physics
  private readonly gravity: number = 0.25;
  private readonly maxPower: number = 14;
  private readonly aimSpeed: number = 0.02;
  private readonly powerSpeed: number = 0.15;

  // Input
  private escKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;

  // Update event
  private updateEvent: (() => void) | null = null;

  // Net lines for visual effect
  private netLines: Phaser.GameObjects.Line[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.create();
  }

  private create(): void {
    const screenWidth = this.scene.cameras.main.width;
    const screenHeight = this.scene.cameras.main.height;

    this.gameWidth = Math.min(600, screenWidth - 80);
    this.gameHeight = Math.min(450, screenHeight - 80);

    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;
    const left = centerX - this.gameWidth / 2;
    const top = centerY - this.gameHeight / 2;
    const right = left + this.gameWidth;
    const bottom = top + this.gameHeight;

    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(Depths.MINI_GAMES);
    this.container.setVisible(false);

    // Dark overlay
    const overlay = this.scene.add.rectangle(screenWidth / 2, screenHeight / 2, screenWidth, screenHeight, 0x000000, 0.85);
    this.container.add(overlay);

    // Court background
    this.background = this.scene.add.rectangle(centerX, centerY, this.gameWidth, this.gameHeight, 0x1a0a00);
    this.background.setStrokeStyle(3, 0xff6600);
    this.container.add(this.background);

    // Court floor
    const floor = this.scene.add.rectangle(centerX, bottom - 30, this.gameWidth - 4, 60, 0x8B4513);
    this.container.add(floor);
    const courtLine = this.scene.add.rectangle(centerX, bottom - 60, this.gameWidth - 40, 2, 0xffffff, 0.3);
    this.container.add(courtLine);

    // Backboard
    const hoopX = right - 100;
    const hoopY = top + 140;
    this.backboard = this.scene.add.rectangle(hoopX + 20, hoopY - 20, 8, 60, 0xffffff);
    this.backboard.setStrokeStyle(2, 0xcccccc);
    this.container.add(this.backboard);

    // Hoop rim (two small rectangles to form the opening)
    this.hoopRimLeft = this.scene.add.rectangle(hoopX - 15, hoopY + 10, 4, 4, 0xff4400);
    this.hoopRimRight = this.scene.add.rectangle(hoopX + 15, hoopY + 10, 4, 4, 0xff4400);
    this.container.add(this.hoopRimLeft);
    this.container.add(this.hoopRimRight);

    // Hoop rim connector
    this.hoop = this.scene.add.rectangle(hoopX, hoopY + 10, 34, 3, 0xff4400);
    this.container.add(this.hoop);

    // Net (dangling lines)
    this.netLines = [];
    for (let i = 0; i < 5; i++) {
      const nx = hoopX - 12 + i * 6;
      const netLine = this.scene.add.line(0, 0, nx, hoopY + 12, nx + (i - 2) * 2, hoopY + 40, 0xffffff, 0.5);
      netLine.setOrigin(0, 0);
      this.netLines.push(netLine);
      this.container.add(netLine);
    }

    // Ball starting position
    this.ballStartX = left + 80;
    this.ballStartY = bottom - 70;

    // Ball
    this.ball = this.scene.add.circle(this.ballStartX, this.ballStartY, 12, 0xff8c00);
    this.ball.setStrokeStyle(2, 0x8B4513);
    this.container.add(this.ball);

    // Aim line
    this.aimLine = this.scene.add.line(0, 0, 0, 0, 0, 0, 0xffff00, 0.7);
    this.aimLine.setOrigin(0, 0);
    this.aimLine.setLineWidth(2);
    this.container.add(this.aimLine);

    // Power bar background
    const barX = left + 20;
    const barY = bottom - 20;
    this.powerBar = this.scene.add.rectangle(barX + 60, barY, 120, 14, 0x333333);
    this.powerBar.setStrokeStyle(1, 0x666666);
    this.container.add(this.powerBar);

    // Power bar fill
    this.powerFill = this.scene.add.rectangle(barX + 1, barY, 0, 10, 0x00ff00);
    this.powerFill.setOrigin(0, 0.5);
    this.container.add(this.powerFill);

    // Score text
    this.scoreText = this.scene.add.text(centerX - 80, top + 15, 'Score: 0', {
      font: 'bold 24px monospace',
      color: '#ffffff',
    });
    this.scoreText.setOrigin(0.5, 0);
    this.container.add(this.scoreText);

    // Attempts text
    this.attemptsText = this.scene.add.text(centerX + 80, top + 15, 'Shots: 0', {
      font: 'bold 24px monospace',
      color: '#aaaaaa',
    });
    this.attemptsText.setOrigin(0.5, 0);
    this.container.add(this.attemptsText);

    // Streak text
    this.streakText = this.scene.add.text(centerX, top + 45, '', {
      font: 'bold 18px monospace',
      color: '#ffcc00',
    });
    this.streakText.setOrigin(0.5, 0);
    this.container.add(this.streakText);

    // Title
    this.titleText = this.scene.add.text(centerX, top - 35, '🏀 BASKETBALL', {
      font: 'bold 28px monospace',
      color: '#ff8c00',
    });
    this.titleText.setOrigin(0.5, 0.5);
    this.container.add(this.titleText);

    // Instructions
    this.instructionText = this.scene.add.text(centerX, bottom + 25,
      '[SPACE] Aim → Charge → Shoot  |  [ESC] Exit', {
      font: '14px monospace',
      color: '#aaaaaa',
    });
    this.instructionText.setOrigin(0.5, 0);
    this.container.add(this.instructionText);

    // Input
    if (this.scene.input.keyboard) {
      this.escKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
      this.spaceKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    }
  }

  show(onClose: () => void): void {
    this.onClose = onClose;
    this.isVisible = true;
    this.container.setVisible(true);

    // Reset game
    this.score = 0;
    this.attempts = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.scoreText.setText('Score: 0');
    this.attemptsText.setText('Shots: 0');
    this.streakText.setText('');
    this.resetShot();

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

    if (this.onClose) {
      this.onClose();
      this.onClose = null;
    }
  }

  private resetShot(): void {
    this.ball.x = this.ballStartX;
    this.ball.y = this.ballStartY;
    this.ballVelX = 0;
    this.ballVelY = 0;
    this.phase = 'aiming';
    this.aimAngle = -Math.PI / 4;
    this.power = 0;
    this.powerFill.width = 0;
    this.aimLine.setVisible(true);
    this.powerBar.setVisible(true);
    this.powerFill.setVisible(true);
    this.instructionText.setText('[SPACE] Aim → Charge → Shoot  |  [ESC] Exit');
  }

  private update(): void {
    if (!this.isVisible) return;

    // ESC to exit
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.hide();
      return;
    }

    const screenWidth = this.scene.cameras.main.width;
    const screenHeight = this.scene.cameras.main.height;
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;
    const left = centerX - this.gameWidth / 2;
    const top = centerY - this.gameHeight / 2;
    const right = left + this.gameWidth;
    const bottom = top + this.gameHeight;

    const hoopX = right - 100;
    const hoopY = top + 140;

    switch (this.phase) {
      case 'aiming': {
        // Oscillate aim angle between -10° and -80°
        this.aimAngle += this.aimSpeed * this.aimDirection;
        if (this.aimAngle < -Math.PI * 0.44) this.aimDirection = 1;
        if (this.aimAngle > -Math.PI * 0.06) this.aimDirection = -1;

        // Draw aim line
        const lineLen = 60;
        const endX = this.ball.x + Math.cos(this.aimAngle) * lineLen;
        const endY = this.ball.y + Math.sin(this.aimAngle) * lineLen;
        this.aimLine.setTo(this.ball.x, this.ball.y, endX, endY);

        if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
          this.phase = 'charging';
          this.power = 0;
          this.powerDirection = 1;
          this.instructionText.setText('[SPACE] Shoot!  |  [ESC] Exit');
        }
        break;
      }

      case 'charging': {
        // Oscillate power bar
        this.power += this.powerSpeed * this.powerDirection;
        if (this.power >= 1) {
          this.power = 1;
          this.powerDirection = -1;
        }
        if (this.power <= 0) {
          this.power = 0;
          this.powerDirection = 1;
        }

        // Update power bar fill
        this.powerFill.width = this.power * 118;
        // Color: green → yellow → red
        if (this.power < 0.5) {
          this.powerFill.fillColor = Phaser.Display.Color.GetColor(
            Math.floor(this.power * 2 * 255), 255, 0
          );
        } else {
          this.powerFill.fillColor = Phaser.Display.Color.GetColor(
            255, Math.floor((1 - this.power) * 2 * 255), 0
          );
        }

        // Keep aim line visible
        const lineLen = 60;
        const endX = this.ball.x + Math.cos(this.aimAngle) * lineLen;
        const endY = this.ball.y + Math.sin(this.aimAngle) * lineLen;
        this.aimLine.setTo(this.ball.x, this.ball.y, endX, endY);

        if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
          // Launch!
          const launchPower = this.power * this.maxPower;
          this.ballVelX = Math.cos(this.aimAngle) * launchPower;
          this.ballVelY = Math.sin(this.aimAngle) * launchPower;
          this.phase = 'flying';
          this.attempts++;
          this.attemptsText.setText(`Shots: ${this.attempts}`);
          this.aimLine.setVisible(false);
          this.powerBar.setVisible(false);
          this.powerFill.setVisible(false);
          this.instructionText.setText('');
        }
        break;
      }

      case 'flying': {
        // Apply gravity
        this.ballVelY += this.gravity;
        this.ball.x += this.ballVelX;
        this.ball.y += this.ballVelY;

        // Check if ball goes through hoop (simple detection)
        const ballCX = this.ball.x;
        const ballCY = this.ball.y;
        const rimY = hoopY + 10;
        const rimLeftX = hoopX - 15;
        const rimRightX = hoopX + 15;

        // Score: ball center passes through rim area while moving downward
        if (ballCY > rimY - 8 && ballCY < rimY + 12 &&
            ballCX > rimLeftX + 2 && ballCX < rimRightX - 2 &&
            this.ballVelY > 0) {
          this.score++;
          this.streak++;
          if (this.streak > this.bestStreak) this.bestStreak = this.streak;
          this.scoreText.setText(`Score: ${this.score}`);
          if (this.streak >= 2) {
            this.streakText.setText(`🔥 ${this.streak} in a row!`);
          }
          this.phase = 'scored';
          // Let ball continue falling for visual effect
          this.scene.time.delayedCall(800, () => {
            if (this.isVisible) this.resetShot();
          });
          break;
        }

        // Backboard bounce
        if (ballCX + 12 > hoopX + 16 && ballCX - 12 < hoopX + 24 &&
            ballCY > hoopY - 50 && ballCY < hoopY + 10 &&
            this.ballVelX > 0) {
          this.ballVelX *= -0.6;
          this.ball.x = hoopX + 16 - 12;
        }

        // Rim bounce (left rim)
        if (Math.abs(ballCX - rimLeftX) < 10 && Math.abs(ballCY - rimY) < 10) {
          this.ballVelX *= -0.5;
          this.ballVelY *= -0.5;
          this.ball.x += this.ballVelX * 2;
        }

        // Rim bounce (right rim)
        if (Math.abs(ballCX - rimRightX) < 10 && Math.abs(ballCY - rimY) < 10) {
          this.ballVelX *= -0.5;
          this.ballVelY *= -0.5;
          this.ball.x += this.ballVelX * 2;
        }

        // Out of bounds check
        if (this.ball.y > bottom + 20 || this.ball.x > right + 20 || this.ball.x < left - 20) {
          this.phase = 'missed';
          this.streak = 0;
          this.streakText.setText('');
          this.scene.time.delayedCall(500, () => {
            if (this.isVisible) this.resetShot();
          });
        }
        break;
      }

      case 'scored': {
        // Ball continues falling with gravity for visual effect
        this.ballVelY += this.gravity;
        this.ball.y += this.ballVelY;
        this.ball.x += this.ballVelX * 0.3;
        break;
      }

      case 'missed': {
        // Ball continues falling
        this.ballVelY += this.gravity;
        this.ball.y += this.ballVelY;
        break;
      }
    }
  }

  getIsVisible(): boolean {
    return this.isVisible;
  }
}
