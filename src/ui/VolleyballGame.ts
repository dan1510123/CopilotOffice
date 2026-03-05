import Phaser from 'phaser';

export class VolleyballGame {
  private scene: Phaser.Scene;
  private container!: Phaser.GameObjects.Container;
  private isVisible: boolean = false;
  private onClose: (() => void) | null = null;
  
  // Game elements
  private background!: Phaser.GameObjects.Rectangle;
  private court!: Phaser.GameObjects.Rectangle;
  private net!: Phaser.GameObjects.Rectangle;
  private netPole1!: Phaser.GameObjects.Rectangle;
  private netPole2!: Phaser.GameObjects.Rectangle;
  private player!: Phaser.GameObjects.Rectangle;
  private playerHead!: Phaser.GameObjects.Arc;
  private playerArm!: Phaser.GameObjects.Rectangle;
  private ai!: Phaser.GameObjects.Rectangle;
  private aiHead!: Phaser.GameObjects.Arc;
  private aiArm!: Phaser.GameObjects.Rectangle;
  private ball!: Phaser.GameObjects.Arc;
  
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
  private playerVelocityY: number = 0;
  private aiVelocityY: number = 0;
  private gameStarted: boolean = false;
  private ballServed: boolean = false;
  private playerServe: boolean = true;
  
  // Arm swing state
  private playerArmAngle: number = 0;
  private playerSpiking: boolean = false;
  private playerSpikeTimer: number = 0;
  private aiArmAngle: number = 0;
  private aiSpiking: boolean = false;
  private aiSpikeTimer: number = 0;
  
  // Physics - floatier ball, starts slow
  private readonly gravity: number = 0.25;
  private readonly ballGravity: number = 0.12;
  private readonly jumpForce: number = -11;
  private readonly moveSpeed: number = 6;
  private readonly ballBounce: number = 0.85;
  private readonly baseHitForce: number = 4;      // Half of before
  private readonly baseSpikeForce: number = 7;    // Half of before
  private speedMultiplier: number = 1.0;          // Increases with score
  
  // Dimensions
  private gameWidth: number = 600;
  private gameHeight: number = 400;
  private playerWidth: number = 30;
  private playerHeight: number = 50;
  private ballRadius: number = 14;
  private netHeight: number = 100;
  private groundY: number = 0;
  private armLength: number = 35;
  private armWidth: number = 8;
  
  // Positions
  private playerX: number = 0;
  private playerY: number = 0;
  private aiX: number = 0;
  private aiY: number = 0;
  private ballX: number = 0;
  private ballY: number = 0;
  
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
    this.gameWidth = Math.min(700, screenWidth - 100);
    this.gameHeight = Math.min(450, screenHeight - 100);
    this.groundY = screenHeight / 2 + this.gameHeight / 2 - 30;
    
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;
    const left = centerX - this.gameWidth / 2;
    const top = centerY - this.gameHeight / 2;
    
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(200);
    this.container.setVisible(false);
    
    // Dark overlay behind game
    const overlay = this.scene.add.rectangle(screenWidth / 2, screenHeight / 2, screenWidth, screenHeight, 0x000000, 0.85);
    this.container.add(overlay);
    
    // Sky background
    this.background = this.scene.add.rectangle(centerX, centerY - 20, this.gameWidth, this.gameHeight - 40, 0x87ceeb);
    this.container.add(this.background);
    
    // Sand court
    this.court = this.scene.add.rectangle(centerX, this.groundY + 15, this.gameWidth, 30, 0xf4d03f);
    this.container.add(this.court);
    
    // Court lines
    const courtLine = this.scene.add.rectangle(centerX, this.groundY, this.gameWidth - 20, 2, 0xffffff);
    this.container.add(courtLine);
    
    // Net
    this.net = this.scene.add.rectangle(centerX, this.groundY - this.netHeight / 2, 4, this.netHeight, 0xffffff);
    this.container.add(this.net);
    
    // Net poles
    this.netPole1 = this.scene.add.rectangle(centerX, this.groundY - this.netHeight - 5, 8, 20, 0x666666);
    this.container.add(this.netPole1);
    
    // Net mesh effect
    for (let i = 0; i < 5; i++) {
      const meshLine = this.scene.add.rectangle(centerX, this.groundY - 20 - i * 18, 6, 2, 0xdddddd);
      this.container.add(meshLine);
    }
    
    // Player (left side) - body
    this.player = this.scene.add.rectangle(0, 0, this.playerWidth, this.playerHeight, 0x3498db);
    this.container.add(this.player);
    
    // Player arm (rectangle that rotates)
    this.playerArm = this.scene.add.rectangle(0, 0, this.armLength, this.armWidth, 0xffdbac);
    this.playerArm.setOrigin(0, 0.5);  // Pivot at shoulder
    this.container.add(this.playerArm);
    
    // Player head
    this.playerHead = this.scene.add.circle(0, 0, 12, 0xffdbac);
    this.container.add(this.playerHead);
    
    // AI (right side) - body
    this.ai = this.scene.add.rectangle(0, 0, this.playerWidth, this.playerHeight, 0xe74c3c);
    this.container.add(this.ai);
    
    // AI arm
    this.aiArm = this.scene.add.rectangle(0, 0, this.armLength, this.armWidth, 0xffdbac);
    this.aiArm.setOrigin(1, 0.5);  // Pivot at shoulder (mirrored)
    this.container.add(this.aiArm);
    
    // AI head
    this.aiHead = this.scene.add.circle(0, 0, 12, 0xffdbac);
    this.container.add(this.aiHead);
    
    // Ball
    this.ball = this.scene.add.circle(0, 0, this.ballRadius, 0xffffff);
    this.ball.setStrokeStyle(3, 0xf39c12);
    this.container.add(this.ball);
    
    // Score texts
    this.playerScoreText = this.scene.add.text(centerX - 100, top + 20, '0', {
      font: 'bold 48px monospace',
      color: '#3498db',
    });
    this.playerScoreText.setOrigin(0.5, 0);
    this.container.add(this.playerScoreText);
    
    this.aiScoreText = this.scene.add.text(centerX + 100, top + 20, '0', {
      font: 'bold 48px monospace',
      color: '#e74c3c',
    });
    this.aiScoreText.setOrigin(0.5, 0);
    this.container.add(this.aiScoreText);
    
    // Title
    this.titleText = this.scene.add.text(centerX, top - 30, '🏐 VOLLEYBALL', {
      font: 'bold 28px monospace',
      color: '#ffcc00',
    });
    this.titleText.setOrigin(0.5, 0.5);
    this.container.add(this.titleText);
    
    // Instructions
    this.instructionText = this.scene.add.text(centerX, this.groundY + 50, 
      '[A/D or ←/→] Move  |  [W or ↑] Jump  |  [SPACE] Spike!  |  [ESC] Exit', {
      font: '14px monospace',
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
    this.speedMultiplier = 1.0;
    this.playerScoreText.setText('0');
    this.aiScoreText.setText('0');
    this.playerServe = true;
    this.playerArmAngle = -45;
    this.aiArmAngle = -135;
    this.resetRound();
    
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

  private resetRound(): void {
    const screenWidth = this.scene.cameras.main.width;
    const centerX = screenWidth / 2;
    
    // Reset player position (left side)
    this.playerX = centerX - this.gameWidth / 4;
    this.playerY = this.groundY - this.playerHeight / 2;
    this.playerVelocityY = 0;
    this.playerArmAngle = -45;  // Arm up ready position
    this.playerSpiking = false;
    this.playerSpikeTimer = 0;
    
    // Reset AI position (right side)
    this.aiX = centerX + this.gameWidth / 4;
    this.aiY = this.groundY - this.playerHeight / 2;
    this.aiVelocityY = 0;
    this.aiArmAngle = -135;  // Mirrored ready position
    this.aiSpiking = false;
    this.aiSpikeTimer = 0;
    
    // Reset ball - position based on who serves
    if (this.playerServe) {
      this.ballX = this.playerX + 30;
      this.ballY = this.playerY - this.playerHeight / 2 - this.ballRadius - 20;
    } else {
      this.ballX = this.aiX - 30;
      this.ballY = this.aiY - this.playerHeight / 2 - this.ballRadius - 20;
    }
    this.ballVelocityX = 0;
    this.ballVelocityY = 0;
    this.ballServed = false;
    
    this.updatePositions();
    this.instructionText.setText('[A/D or ←/→] Move  |  [W or ↑] Jump  |  [SPACE] Spike!  |  [ESC] Exit');
  }

  private updatePositions(): void {
    // Update player visual position
    this.player.setPosition(this.playerX, this.playerY);
    this.playerHead.setPosition(this.playerX, this.playerY - this.playerHeight / 2 - 10);
    
    // Update player arm position and rotation
    const playerShoulderX = this.playerX + this.playerWidth / 2 - 5;
    const playerShoulderY = this.playerY - this.playerHeight / 2 + 10;
    this.playerArm.setPosition(playerShoulderX, playerShoulderY);
    this.playerArm.setRotation(this.playerArmAngle * Math.PI / 180);
    
    // Update AI visual position
    this.ai.setPosition(this.aiX, this.aiY);
    this.aiHead.setPosition(this.aiX, this.aiY - this.playerHeight / 2 - 10);
    
    // Update AI arm position and rotation
    const aiShoulderX = this.aiX - this.playerWidth / 2 + 5;
    const aiShoulderY = this.aiY - this.playerHeight / 2 + 10;
    this.aiArm.setPosition(aiShoulderX, aiShoulderY);
    this.aiArm.setRotation(this.aiArmAngle * Math.PI / 180);
    
    // Update ball visual position
    this.ball.setPosition(this.ballX, this.ballY);
  }

  private serveBall(): void {
    if (this.ballServed) return;
    
    this.ballServed = true;
    // Serve upward and toward opponent - slow floaty serve, scales with game progress
    const serveSpeed = 2 * this.speedMultiplier;
    if (this.playerServe) {
      this.ballVelocityX = serveSpeed;
      this.ballVelocityY = -4 * this.speedMultiplier;
    } else {
      this.ballVelocityX = -serveSpeed;
      this.ballVelocityY = -4 * this.speedMultiplier;
    }
    this.instructionText.setText('[A/D or ←/→] Move  |  [W or ↑] Jump  |  [SPACE] Spike!  |  [ESC] Exit');
  }

  private startSpike(): void {
    if (!this.playerSpiking) {
      this.playerSpiking = true;
      this.playerSpikeTimer = 0;
      this.playerArmAngle = -120;  // Wind up
    }
  }

  private update(): void {
    if (!this.isVisible) return;
    
    const screenWidth = this.scene.cameras.main.width;
    const centerX = screenWidth / 2;
    const leftBound = centerX - this.gameWidth / 2 + 20;
    const rightBound = centerX + this.gameWidth / 2 - 20;
    
    // Check for ESC to exit
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.hide();
      return;
    }
    
    // Check for SPACE - serve or spike
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      if (!this.ballServed) {
        this.serveBall();
      } else {
        this.startSpike();
      }
    }
    
    // Player movement
    const aKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    const dKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    const wKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    
    // Horizontal movement
    if (this.cursors.left.isDown || aKey?.isDown) {
      this.playerX -= this.moveSpeed;
    } else if (this.cursors.right.isDown || dKey?.isDown) {
      this.playerX += this.moveSpeed;
    }
    
    // Keep player on their side (left of net)
    this.playerX = Phaser.Math.Clamp(this.playerX, leftBound + this.playerWidth / 2, centerX - 20 - this.playerWidth / 2);
    
    // Player arm swing animation
    if (this.playerSpiking) {
      this.playerSpikeTimer++;
      // Swing from -120 (wind up) to 45 (follow through)
      if (this.playerSpikeTimer < 8) {
        // Quick swing down
        this.playerArmAngle = -120 + (this.playerSpikeTimer * 25);
      } else if (this.playerSpikeTimer < 20) {
        // Hold follow through briefly then return
        this.playerArmAngle = 80 - ((this.playerSpikeTimer - 8) * 10);
      } else {
        // Return to ready
        this.playerArmAngle = -45;
        this.playerSpiking = false;
      }
      
      // Check for spike hit during the swing (frames 3-7)
      if (this.playerSpikeTimer >= 3 && this.playerSpikeTimer <= 7) {
        this.checkSpikeHit(true);
      }
    }
    
    // Jump
    const onGround = this.playerY >= this.groundY - this.playerHeight / 2 - 1;
    if ((this.cursors.up.isDown || wKey?.isDown) && onGround) {
      this.playerVelocityY = this.jumpForce;
    }
    
    // Apply gravity to player
    this.playerVelocityY += this.gravity;
    this.playerY += this.playerVelocityY;
    
    // Ground collision for player
    if (this.playerY > this.groundY - this.playerHeight / 2) {
      this.playerY = this.groundY - this.playerHeight / 2;
      this.playerVelocityY = 0;
    }
    
    // AI movement (simple AI)
    if (this.ballServed) {
      // AI tries to get under the ball when it's on their side
      if (this.ballX > centerX) {
        const targetX = this.ballX + this.ballVelocityX * 10; // Predict where ball will be
        const aiDiff = targetX - this.aiX;
        
        if (Math.abs(aiDiff) > 10) {
          this.aiX += Math.sign(aiDiff) * (this.moveSpeed * 0.7);
        }
        
        // AI jumps when ball is coming down and close
        const aiOnGround = this.aiY >= this.groundY - this.playerHeight / 2 - 1;
        if (aiOnGround && this.ballY < this.aiY - 30 && this.ballVelocityY > 0 && 
            Math.abs(this.ballX - this.aiX) < 60) {
          this.aiVelocityY = this.jumpForce * 0.9;
        }
        
        // AI spikes when ball is close and in air
        if (!this.aiSpiking && this.ballY < this.aiY - 20 && 
            Math.abs(this.ballX - this.aiX) < 50 && this.ballVelocityY > -2) {
          this.aiSpiking = true;
          this.aiSpikeTimer = 0;
        }
      } else {
        // Return to center of their side
        const homeX = centerX + this.gameWidth / 4;
        const aiDiff = homeX - this.aiX;
        if (Math.abs(aiDiff) > 10) {
          this.aiX += Math.sign(aiDiff) * (this.moveSpeed * 0.5);
        }
      }
    }
    
    // AI arm swing animation
    if (this.aiSpiking) {
      this.aiSpikeTimer++;
      // Swing from -60 (wind up) to -165 (follow through) - mirrored angles
      if (this.aiSpikeTimer < 8) {
        this.aiArmAngle = -60 - (this.aiSpikeTimer * 20);
      } else if (this.aiSpikeTimer < 20) {
        this.aiArmAngle = -220 + ((this.aiSpikeTimer - 8) * 8);
      } else {
        this.aiArmAngle = -135;
        this.aiSpiking = false;
      }
      
      // Check for AI spike hit
      if (this.aiSpikeTimer >= 3 && this.aiSpikeTimer <= 7) {
        this.checkSpikeHit(false);
      }
    }
    
    // Keep AI on their side (right of net)
    this.aiX = Phaser.Math.Clamp(this.aiX, centerX + 20 + this.playerWidth / 2, rightBound - this.playerWidth / 2);
    
    // Apply gravity to AI
    this.aiVelocityY += this.gravity;
    this.aiY += this.aiVelocityY;
    
    // Ground collision for AI
    if (this.aiY > this.groundY - this.playerHeight / 2) {
      this.aiY = this.groundY - this.playerHeight / 2;
      this.aiVelocityY = 0;
    }
    
    // Ball physics (only when served)
    if (this.ballServed) {
      // Apply floaty ball gravity
      this.ballVelocityY += this.ballGravity;
      
      // Update position
      this.ballX += this.ballVelocityX;
      this.ballY += this.ballVelocityY;
      
      // Ceiling bounce
      const ceiling = this.scene.cameras.main.height / 2 - this.gameHeight / 2 + 20;
      if (this.ballY - this.ballRadius < ceiling) {
        this.ballY = ceiling + this.ballRadius;
        this.ballVelocityY *= -this.ballBounce;
      }
      
      // Side wall bounces
      if (this.ballX - this.ballRadius < leftBound) {
        this.ballX = leftBound + this.ballRadius;
        this.ballVelocityX *= -this.ballBounce;
      } else if (this.ballX + this.ballRadius > rightBound) {
        this.ballX = rightBound - this.ballRadius;
        this.ballVelocityX *= -this.ballBounce;
      }
      
      // Net collision
      const netTop = this.groundY - this.netHeight;
      if (this.ballY + this.ballRadius > netTop && this.ballY < this.groundY) {
        if (this.ballX > centerX - 10 && this.ballX < centerX + 10) {
          // Hit the net
          if (this.ballVelocityX > 0) {
            this.ballX = centerX - 10 - this.ballRadius;
          } else {
            this.ballX = centerX + 10 + this.ballRadius;
          }
          this.ballVelocityX *= -0.5;
        }
      }
      
      // Player collision (including head)
      const playerTop = this.playerY - this.playerHeight / 2 - 22; // Include head
      const playerBottom = this.playerY + this.playerHeight / 2;
      const playerLeft = this.playerX - this.playerWidth / 2;
      const playerRight = this.playerX + this.playerWidth / 2;
      
      const hitForce = this.baseHitForce * this.speedMultiplier;
      
      if (this.ballX + this.ballRadius > playerLeft && this.ballX - this.ballRadius < playerRight &&
          this.ballY + this.ballRadius > playerTop && this.ballY - this.ballRadius < playerBottom) {
        // Calculate hit angle based on where ball hits player
        const hitPointX = (this.ballX - this.playerX) / (this.playerWidth / 2);
        
        this.ballVelocityX = hitPointX * hitForce + 1 * this.speedMultiplier;
        this.ballVelocityY = -Math.abs(this.ballVelocityY) * this.ballBounce - 2.5 * this.speedMultiplier;
        
        // Push ball out of player
        this.ballY = playerTop - this.ballRadius;
      }
      
      // AI collision (including head)
      const aiTop = this.aiY - this.playerHeight / 2 - 22;
      const aiBottom = this.aiY + this.playerHeight / 2;
      const aiLeft = this.aiX - this.playerWidth / 2;
      const aiRight = this.aiX + this.playerWidth / 2;
      
      if (this.ballX + this.ballRadius > aiLeft && this.ballX - this.ballRadius < aiRight &&
          this.ballY + this.ballRadius > aiTop && this.ballY - this.ballRadius < aiBottom) {
        const hitPointX = (this.ballX - this.aiX) / (this.playerWidth / 2);
        
        this.ballVelocityX = hitPointX * hitForce - 1 * this.speedMultiplier;
        this.ballVelocityY = -Math.abs(this.ballVelocityY) * this.ballBounce - 2.5 * this.speedMultiplier;
        
        this.ballY = aiTop - this.ballRadius;
      }
      
      // Cap ball speed (scales with multiplier)
      const maxSpeed = 10 * this.speedMultiplier;
      this.ballVelocityX = Phaser.Math.Clamp(this.ballVelocityX, -maxSpeed, maxSpeed);
      this.ballVelocityY = Phaser.Math.Clamp(this.ballVelocityY, -maxSpeed, maxSpeed);
      
      // Ground collision - scoring
      if (this.ballY + this.ballRadius > this.groundY) {
        if (this.ballX < centerX) {
          // Ball landed on player's side - AI scores
          this.aiScore++;
          this.aiScoreText.setText(this.aiScore.toString());
          this.playerServe = true; // Loser serves
        } else {
          // Ball landed on AI's side - Player scores
          this.playerScore++;
          this.playerScoreText.setText(this.playerScore.toString());
          this.playerServe = false;
        }
        // Increase speed as game progresses (10% faster per point, max 2.5x)
        this.speedMultiplier = Math.min(2.5, 1.0 + (this.playerScore + this.aiScore) * 0.1);
        this.resetRound();
      }
    } else {
      // Ball follows server before serve
      if (this.playerServe) {
        this.ballX = this.playerX + 30;
        this.ballY = this.playerY - this.playerHeight / 2 - this.ballRadius - 20;
      }
    }
    
    this.updatePositions();
  }

  private checkSpikeHit(isPlayer: boolean): void {
    // Calculate arm end position for hit detection
    let armX: number, armY: number, armEndX: number, armEndY: number;
    let angle: number;
    
    if (isPlayer) {
      armX = this.playerX + this.playerWidth / 2 - 5;
      armY = this.playerY - this.playerHeight / 2 + 10;
      angle = this.playerArmAngle * Math.PI / 180;
      armEndX = armX + Math.cos(angle) * this.armLength;
      armEndY = armY + Math.sin(angle) * this.armLength;
    } else {
      armX = this.aiX - this.playerWidth / 2 + 5;
      armY = this.aiY - this.playerHeight / 2 + 10;
      angle = this.aiArmAngle * Math.PI / 180;
      armEndX = armX + Math.cos(angle) * this.armLength;
      armEndY = armY + Math.sin(angle) * this.armLength;
    }
    
    // Check if ball is near the arm end (hand position)
    const hitRadius = 30;
    const dist = Math.sqrt((this.ballX - armEndX) ** 2 + (this.ballY - armEndY) ** 2);
    
    if (dist < hitRadius + this.ballRadius) {
      // Spike hit! Send ball fast toward opponent (scales with game progress)
      const spikeForce = this.baseSpikeForce * this.speedMultiplier;
      if (isPlayer) {
        this.ballVelocityX = spikeForce;
        this.ballVelocityY = 3 * this.speedMultiplier;  // Downward angle
      } else {
        this.ballVelocityX = -spikeForce;
        this.ballVelocityY = 3 * this.speedMultiplier;
      }
      
      // Push ball away from arm
      this.ballX = armEndX + (isPlayer ? 20 : -20);
    }
  }

  getIsVisible(): boolean {
    return this.isVisible;
  }
}
