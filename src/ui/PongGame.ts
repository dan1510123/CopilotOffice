import Phaser from 'phaser';
import { Depths } from '../config/depths';

export class PongGame {
  private scene: Phaser.Scene;
  private container!: Phaser.GameObjects.Container;
  private isVisible: boolean = false;
  private onClose: (() => void) | null = null;
  
  // Game elements
  private background!: Phaser.GameObjects.Rectangle;
  private playerPaddle!: Phaser.GameObjects.Rectangle;
  private aiPaddle!: Phaser.GameObjects.Rectangle;
  private ball!: Phaser.GameObjects.Rectangle;
  private topWall!: Phaser.GameObjects.Rectangle;
  private bottomWall!: Phaser.GameObjects.Rectangle;
  private centerLine!: Phaser.GameObjects.Rectangle;
  private net!: Phaser.GameObjects.Rectangle[];
  
  // Score
  private playerScore: number = 0;
  private aiScore: number = 0;
  private playerScoreText!: Phaser.GameObjects.Text;
  private aiScoreText!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  
  // Game state
  private ballVelocityX: number = 0;
  private ballVelocityY: number = 0;
  private gameStarted: boolean = false;
  private readonly paddleSpeed: number = 8;
  private readonly ballSpeed: number = 5;
  private readonly baseAiSpeed: number = 3; // Easy mode base speed
  private aiSpeed: number = 3; // Current AI speed (scales with score)
  
  // Dimensions
  private gameWidth: number = 600;
  private gameHeight: number = 400;
  private paddleWidth: number = 10;
  private paddleHeight: number = 80;
  private ballSize: number = 12;
  
  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private escKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  
  // Update event
  private updateEvent: (() => void) | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.create();
  }

  private create(): void {
    const screenWidth = this.scene.cameras.main.width;
    const screenHeight = this.scene.cameras.main.height;
    
    // Scale game to fit screen
    this.gameWidth = Math.min(600, screenWidth - 100);
    this.gameHeight = Math.min(400, screenHeight - 100);
    this.paddleHeight = this.gameHeight / 5;
    
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;
    const left = centerX - this.gameWidth / 2;
    const top = centerY - this.gameHeight / 2;
    
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(Depths.MINI_GAMES);
    this.container.setVisible(false);
    
    // Dark overlay behind game
    const overlay = this.scene.add.rectangle(screenWidth / 2, screenHeight / 2, screenWidth, screenHeight, 0x000000, 0.8);
    this.container.add(overlay);
    
    // Game background (table)
    this.background = this.scene.add.rectangle(centerX, centerY, this.gameWidth, this.gameHeight, 0x1560bd);
    this.background.setStrokeStyle(4, 0xffffff);
    this.container.add(this.background);
    
    // Center line (dashed effect)
    this.net = [];
    const dashHeight = 15;
    const dashGap = 10;
    for (let y = top + dashGap; y < top + this.gameHeight - dashGap; y += dashHeight + dashGap) {
      const dash = this.scene.add.rectangle(centerX, y + dashHeight / 2, 4, dashHeight, 0xffffff, 0.5);
      this.net.push(dash);
      this.container.add(dash);
    }
    
    // Walls (top and bottom)
    this.topWall = this.scene.add.rectangle(centerX, top, this.gameWidth, 4, 0xffffff);
    this.bottomWall = this.scene.add.rectangle(centerX, top + this.gameHeight, this.gameWidth, 4, 0xffffff);
    this.container.add(this.topWall);
    this.container.add(this.bottomWall);
    
    // Player paddle (left side)
    this.playerPaddle = this.scene.add.rectangle(
      left + 30,
      centerY,
      this.paddleWidth,
      this.paddleHeight,
      0x00ff00
    );
    this.container.add(this.playerPaddle);
    
    // AI paddle (right side)
    this.aiPaddle = this.scene.add.rectangle(
      left + this.gameWidth - 30,
      centerY,
      this.paddleWidth,
      this.paddleHeight,
      0xff4444
    );
    this.container.add(this.aiPaddle);
    
    // Ball
    this.ball = this.scene.add.rectangle(centerX, centerY, this.ballSize, this.ballSize, 0xffffff);
    this.container.add(this.ball);
    
    // Score texts
    this.playerScoreText = this.scene.add.text(centerX - 80, top + 30, '0', {
      font: 'bold 48px monospace',
      color: '#ffffff',
    });
    this.playerScoreText.setOrigin(0.5, 0);
    this.container.add(this.playerScoreText);
    
    this.aiScoreText = this.scene.add.text(centerX + 80, top + 30, '0', {
      font: 'bold 48px monospace',
      color: '#ffffff',
    });
    this.aiScoreText.setOrigin(0.5, 0);
    this.container.add(this.aiScoreText);
    
    // Title
    this.titleText = this.scene.add.text(centerX, top - 40, '🏓 PING PONG', {
      font: 'bold 28px monospace',
      color: '#ffcc00',
    });
    this.titleText.setOrigin(0.5, 0.5);
    this.container.add(this.titleText);
    
    // Instructions
    this.instructionText = this.scene.add.text(centerX, top + this.gameHeight + 30, 
      '[W/S or ↑/↓] Move  |  [SPACE] Start  |  [ESC] Exit', {
      font: '16px monospace',
      color: '#aaaaaa',
    });
    this.instructionText.setOrigin(0.5, 0);
    this.container.add(this.instructionText);
    
    // Set up input
    if (this.scene.input.keyboard) {
      this.cursors = this.scene.input.keyboard.createCursorKeys();
      this.escKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
      this.spaceKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    }
  }

  show(onClose: () => void): void {
    this.onClose = onClose;
    this.isVisible = true;
    this.container.setVisible(true);
    
    // Reset game
    this.playerScore = 0;
    this.aiScore = 0;
    this.aiSpeed = this.baseAiSpeed; // Reset AI speed
    this.playerScoreText.setText('0');
    this.aiScoreText.setText('0');
    this.resetBall();
    this.gameStarted = false;
    
    // Reset paddle positions
    const screenHeight = this.scene.cameras.main.height;
    this.playerPaddle.y = screenHeight / 2;
    this.aiPaddle.y = screenHeight / 2;
    
    // Start update loop
    this.updateEvent = () => this.update();
    this.scene.events.on('update', this.updateEvent);
  }

  hide(): void {
    this.isVisible = false;
    this.container.setVisible(false);
    
    // Stop update loop
    if (this.updateEvent) {
      this.scene.events.off('update', this.updateEvent);
      this.updateEvent = null;
    }
    
    if (this.onClose) {
      this.onClose();
      this.onClose = null;
    }
  }

  private resetBall(): void {
    const screenWidth = this.scene.cameras.main.width;
    const screenHeight = this.scene.cameras.main.height;
    
    this.ball.x = screenWidth / 2;
    this.ball.y = screenHeight / 2;
    this.ballVelocityX = 0;
    this.ballVelocityY = 0;
    this.gameStarted = false;
    this.instructionText.setText('[W/S or ↑/↓] Move  |  [SPACE] Start  |  [ESC] Exit');
  }

  private launchBall(): void {
    // Random direction
    const direction = Math.random() > 0.5 ? 1 : -1;
    const angle = (Math.random() - 0.5) * Math.PI / 3; // -30 to +30 degrees
    
    this.ballVelocityX = this.ballSpeed * direction * Math.cos(angle);
    this.ballVelocityY = this.ballSpeed * Math.sin(angle);
    this.gameStarted = true;
    this.instructionText.setText('[W/S or ↑/↓] Move  |  [ESC] Exit');
  }

  private update(): void {
    if (!this.isVisible) return;
    
    const screenWidth = this.scene.cameras.main.width;
    const screenHeight = this.scene.cameras.main.height;
    const centerY = screenHeight / 2;
    const top = centerY - this.gameHeight / 2;
    const bottom = centerY + this.gameHeight / 2;
    
    // Check for ESC to exit
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.hide();
      return;
    }
    
    // Check for SPACE to start
    if (!this.gameStarted && Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.launchBall();
    }
    
    // Player paddle movement
    const wKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    const sKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    
    if (this.cursors.up.isDown || wKey?.isDown) {
      this.playerPaddle.y -= this.paddleSpeed;
    } else if (this.cursors.down.isDown || sKey?.isDown) {
      this.playerPaddle.y += this.paddleSpeed;
    }
    
    // Clamp player paddle to bounds
    const halfPaddle = this.paddleHeight / 2;
    this.playerPaddle.y = Phaser.Math.Clamp(this.playerPaddle.y, top + halfPaddle + 4, bottom - halfPaddle - 4);
    
    // AI paddle movement (easy mode - follows ball slowly with some delay)
    if (this.gameStarted) {
      const aiTarget = this.ball.y;
      const aiDiff = aiTarget - this.aiPaddle.y;
      
      // Add some "mistake" for easy mode - AI doesn't react perfectly
      if (Math.abs(aiDiff) > 20) {
        this.aiPaddle.y += Math.sign(aiDiff) * this.aiSpeed;
      }
    }
    this.aiPaddle.y = Phaser.Math.Clamp(this.aiPaddle.y, top + halfPaddle + 4, bottom - halfPaddle - 4);
    
    // Ball movement
    if (this.gameStarted) {
      this.ball.x += this.ballVelocityX;
      this.ball.y += this.ballVelocityY;
      
      // Ball collision with top/bottom walls
      if (this.ball.y - this.ballSize / 2 <= top + 4) {
        this.ball.y = top + 4 + this.ballSize / 2;
        this.ballVelocityY *= -1;
      } else if (this.ball.y + this.ballSize / 2 >= bottom - 4) {
        this.ball.y = bottom - 4 - this.ballSize / 2;
        this.ballVelocityY *= -1;
      }
      
      // Ball collision with paddles
      const ballLeft = this.ball.x - this.ballSize / 2;
      const ballRight = this.ball.x + this.ballSize / 2;
      const ballTop = this.ball.y - this.ballSize / 2;
      const ballBottom = this.ball.y + this.ballSize / 2;
      
      // Player paddle collision
      const playerLeft = this.playerPaddle.x - this.paddleWidth / 2;
      const playerRight = this.playerPaddle.x + this.paddleWidth / 2;
      const playerTop = this.playerPaddle.y - this.paddleHeight / 2;
      const playerBottom = this.playerPaddle.y + this.paddleHeight / 2;
      
      if (ballLeft <= playerRight && ballRight >= playerLeft &&
          ballBottom >= playerTop && ballTop <= playerBottom &&
          this.ballVelocityX < 0) {
        this.ball.x = playerRight + this.ballSize / 2;
        this.ballVelocityX *= -1.1; // Speed up slightly
        // Add angle based on where ball hits paddle
        const hitPos = (this.ball.y - this.playerPaddle.y) / (this.paddleHeight / 2);
        this.ballVelocityY += hitPos * 2;
      }
      
      // AI paddle collision
      const aiLeft = this.aiPaddle.x - this.paddleWidth / 2;
      const aiRight = this.aiPaddle.x + this.paddleWidth / 2;
      const aiTop = this.aiPaddle.y - this.paddleHeight / 2;
      const aiBottom = this.aiPaddle.y + this.paddleHeight / 2;
      
      if (ballRight >= aiLeft && ballLeft <= aiRight &&
          ballBottom >= aiTop && ballTop <= aiBottom &&
          this.ballVelocityX > 0) {
        this.ball.x = aiLeft - this.ballSize / 2;
        this.ballVelocityX *= -1.1;
        const hitPos = (this.ball.y - this.aiPaddle.y) / (this.paddleHeight / 2);
        this.ballVelocityY += hitPos * 2;
      }
      
      // Cap ball speed
      const maxSpeed = 12;
      this.ballVelocityX = Phaser.Math.Clamp(this.ballVelocityX, -maxSpeed, maxSpeed);
      this.ballVelocityY = Phaser.Math.Clamp(this.ballVelocityY, -maxSpeed, maxSpeed);
      
      // Score detection
      const gameLeft = screenWidth / 2 - this.gameWidth / 2;
      const gameRight = screenWidth / 2 + this.gameWidth / 2;
      
      if (this.ball.x < gameLeft) {
        // AI scores
        this.aiScore++;
        this.aiScoreText.setText(this.aiScore.toString());
        // AI gets faster with each point (1.05x multiplier)
        this.aiSpeed *= 1.05;
        this.resetBall();
      } else if (this.ball.x > gameRight) {
        // Player scores
        this.playerScore++;
        this.playerScoreText.setText(this.playerScore.toString());
        // AI gets faster with each point (1.05x multiplier)
        this.aiSpeed *= 1.05;
        this.resetBall();
      }
    }
  }

  getIsVisible(): boolean {
    return this.isVisible;
  }
}
