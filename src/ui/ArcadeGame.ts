import Phaser from 'phaser';

export class ArcadeGame {
  private scene: Phaser.Scene;
  private container!: Phaser.GameObjects.Container;
  private isVisible: boolean = false;
  private onClose: (() => void) | null = null;
  
  // Game elements
  private gameCanvas!: Phaser.GameObjects.Graphics;
  private screenBg!: Phaser.GameObjects.Rectangle;
  
  // Ship
  private ship = {
    x: 0,
    y: 0,
    angle: -Math.PI / 2,
    thrust: { x: 0, y: 0 },
    radius: 10,
    invincible: false,
    invincibleTime: 0,
  };
  
  // Game state
  private bullets: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
  private asteroids: { 
    x: number; y: number; vx: number; vy: number; 
    radius: number; size: string; angle: number; rotSpeed: number;
    vertices: { angle: number; dist: number }[];
  }[] = [];
  private particles: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number }[] = [];
  
  private score: number = 0;
  private lives: number = 3;
  private level: number = 1;
  private gameRunning: boolean = false;
  private gameStarted: boolean = false;
  
  // UI elements
  private titleText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private startText!: Phaser.GameObjects.Text;
  private gameOverText!: Phaser.GameObjects.Text;
  
  // Dimensions
  private gameWidth: number = 400;
  private gameHeight: number = 300;
  private gameLeft: number = 0;
  private gameTop: number = 0;
  
  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private escKey!: Phaser.Input.Keyboard.Key;
  private enterKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  
  // Update event
  private updateEvent: (() => void) | null = null;
  
  // Constants
  private readonly BULLET_SPEED = 6;
  private readonly BULLET_LIFE = 50;
  private readonly SHIP_ROTATION_SPEED = 0.08;
  private readonly SHIP_THRUST = 0.12;
  private readonly FRICTION = 0.99;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.create();
  }

  private create(): void {
    const screenWidth = this.scene.cameras.main.width;
    const screenHeight = this.scene.cameras.main.height;
    
    // Scale game to fit screen
    this.gameWidth = Math.min(400, screenWidth - 100);
    this.gameHeight = Math.min(300, screenHeight - 150);
    
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;
    this.gameLeft = centerX - this.gameWidth / 2;
    this.gameTop = centerY - this.gameHeight / 2;
    
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(200);
    this.container.setVisible(false);
    
    // Dark overlay behind game
    const overlay = this.scene.add.rectangle(screenWidth / 2, screenHeight / 2, screenWidth, screenHeight, 0x000000, 0.85);
    this.container.add(overlay);
    
    // Arcade cabinet frame (outer)
    const cabinetOuter = this.scene.add.rectangle(centerX, centerY, this.gameWidth + 60, this.gameHeight + 140, 0x2d2d2d);
    cabinetOuter.setStrokeStyle(4, 0x444444);
    this.container.add(cabinetOuter);
    
    // Arcade cabinet top (red marquee)
    const marquee = this.scene.add.rectangle(centerX, this.gameTop - 45, this.gameWidth + 40, 40, 0xcc2222);
    marquee.setStrokeStyle(2, 0xff4444);
    this.container.add(marquee);
    
    // Glowing lights on marquee
    const light1 = this.scene.add.circle(this.gameLeft - 5, this.gameTop - 45, 6, 0xffff00);
    const light2 = this.scene.add.circle(this.gameLeft + this.gameWidth + 5, this.gameTop - 45, 6, 0xff00ff);
    this.container.add(light1);
    this.container.add(light2);
    
    // Screen bezel
    const bezel = this.scene.add.rectangle(centerX, centerY - 10, this.gameWidth + 20, this.gameHeight + 20, 0x111111);
    bezel.setStrokeStyle(3, 0x333333);
    this.container.add(bezel);
    
    // Game screen background
    this.screenBg = this.scene.add.rectangle(centerX, centerY - 10, this.gameWidth, this.gameHeight, 0x000000);
    this.screenBg.setStrokeStyle(2, 0x00ffff, 0.3);
    this.container.add(this.screenBg);
    
    // Graphics for game rendering
    this.gameCanvas = this.scene.add.graphics();
    this.container.add(this.gameCanvas);
    
    // CRT scanline effect
    const scanlines = this.scene.add.graphics();
    scanlines.lineStyle(1, 0x000000, 0.15);
    for (let y = this.gameTop - 10; y < this.gameTop + this.gameHeight - 10; y += 3) {
      scanlines.lineBetween(this.gameLeft, y, this.gameLeft + this.gameWidth, y);
    }
    this.container.add(scanlines);
    
    // Control panel
    const controlPanel = this.scene.add.rectangle(centerX, this.gameTop + this.gameHeight + 35, this.gameWidth + 40, 50, 0x3d3d3d);
    controlPanel.setStrokeStyle(2, 0x555555);
    this.container.add(controlPanel);
    
    // Joystick decoration
    const joystickBase = this.scene.add.circle(this.gameLeft + 40, this.gameTop + this.gameHeight + 35, 20, 0x222222);
    const joystickStick = this.scene.add.circle(this.gameLeft + 40, this.gameTop + this.gameHeight + 32, 10, 0xcc3333);
    this.container.add(joystickBase);
    this.container.add(joystickStick);
    
    // Fire button decoration
    const fireBtn = this.scene.add.circle(this.gameLeft + this.gameWidth - 40, this.gameTop + this.gameHeight + 35, 15, 0xcc2222);
    fireBtn.setStrokeStyle(2, 0xff4444);
    this.container.add(fireBtn);
    
    // Title on marquee
    this.titleText = this.scene.add.text(centerX, this.gameTop - 47, '🚀 ASTEROIDS', {
      font: 'bold 22px monospace',
      color: '#ffffff',
    });
    this.titleText.setOrigin(0.5, 0.5);
    this.titleText.setShadow(0, 0, '#ffff00', 8, true, true);
    this.container.add(this.titleText);
    
    // Score display
    this.scoreText = this.scene.add.text(this.gameLeft + 10, this.gameTop - 5, 'SCORE: 0', {
      font: 'bold 12px monospace',
      color: '#00ff00',
    });
    this.scoreText.setShadow(0, 0, '#00ff00', 3, true, true);
    this.container.add(this.scoreText);
    
    // Lives display
    this.livesText = this.scene.add.text(centerX, this.gameTop - 5, 'LIVES: 3', {
      font: 'bold 12px monospace',
      color: '#00ff00',
    });
    this.livesText.setOrigin(0.5, 0);
    this.livesText.setShadow(0, 0, '#00ff00', 3, true, true);
    this.container.add(this.livesText);
    
    // Level display
    this.levelText = this.scene.add.text(this.gameLeft + this.gameWidth - 10, this.gameTop - 5, 'LEVEL: 1', {
      font: 'bold 12px monospace',
      color: '#00ff00',
    });
    this.levelText.setOrigin(1, 0);
    this.levelText.setShadow(0, 0, '#00ff00', 3, true, true);
    this.container.add(this.levelText);
    
    // Start text
    this.startText = this.scene.add.text(centerX, centerY - 10, 'PRESS ENTER TO START', {
      font: 'bold 16px monospace',
      color: '#00ffff',
    });
    this.startText.setOrigin(0.5, 0.5);
    this.startText.setShadow(0, 0, '#00ffff', 5, true, true);
    this.container.add(this.startText);
    
    // Game over text (hidden initially)
    this.gameOverText = this.scene.add.text(centerX, centerY - 30, 'GAME OVER', {
      font: 'bold 24px monospace',
      color: '#ff0000',
    });
    this.gameOverText.setOrigin(0.5, 0.5);
    this.gameOverText.setShadow(0, 0, '#ff0000', 8, true, true);
    this.gameOverText.setVisible(false);
    this.container.add(this.gameOverText);
    
    // Instructions
    this.instructionText = this.scene.add.text(centerX, this.gameTop + this.gameHeight + 75, 
      '[←→] Rotate  [↑] Thrust  [SPACE] Fire  [ESC] Exit', {
      font: '11px monospace',
      color: '#888888',
    });
    this.instructionText.setOrigin(0.5, 0);
    this.container.add(this.instructionText);
    
    // Set up input
    if (this.scene.input.keyboard) {
      this.cursors = this.scene.input.keyboard.createCursorKeys();
      this.escKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
      this.enterKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
      this.spaceKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    }
  }

  show(onClose: () => void): void {
    this.onClose = onClose;
    this.isVisible = true;
    this.container.setVisible(true);
    
    // Reset game state
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.gameRunning = false;
    this.gameStarted = false;
    this.bullets = [];
    this.asteroids = [];
    this.particles = [];
    
    this.updateUI();
    this.startText.setVisible(true);
    this.gameOverText.setVisible(false);
    
    // Reset ship
    this.resetShip();
    
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

  private resetShip(): void {
    const centerX = this.scene.cameras.main.width / 2;
    const centerY = this.scene.cameras.main.height / 2 - 10;
    
    this.ship.x = centerX;
    this.ship.y = centerY;
    this.ship.angle = -Math.PI / 2;
    this.ship.thrust = { x: 0, y: 0 };
    this.ship.invincible = true;
    this.ship.invincibleTime = Date.now() + 2000;
  }

  private startGame(): void {
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.bullets = [];
    this.asteroids = [];
    this.particles = [];
    
    this.resetShip();
    this.ship.invincible = false;
    this.createAsteroids(4);
    
    this.gameRunning = true;
    this.gameStarted = true;
    this.startText.setVisible(false);
    this.gameOverText.setVisible(false);
    this.updateUI();
  }

  private createAsteroids(count: number): void {
    const centerX = this.scene.cameras.main.width / 2;
    const centerY = this.scene.cameras.main.height / 2 - 10;
    
    for (let i = 0; i < count; i++) {
      let x: number, y: number;
      do {
        x = this.gameLeft + Math.random() * this.gameWidth;
        y = this.gameTop - 10 + Math.random() * this.gameHeight;
      } while (this.distance(x, y, centerX, centerY) < 80);
      
      this.asteroids.push(this.createAsteroid(x, y, 'large'));
    }
  }

  private createAsteroid(x: number, y: number, size: string): typeof this.asteroids[0] {
    const radius = size === 'large' ? 25 : size === 'medium' ? 15 : 8;
    const speed = 1 + this.level * 0.2;
    
    const vertices: { angle: number; dist: number }[] = [];
    const numVerts = 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numVerts; i++) {
      vertices.push({
        angle: (i / numVerts) * Math.PI * 2,
        dist: radius * (0.7 + Math.random() * 0.5),
      });
    }
    
    return {
      x, y, size, radius, vertices,
      vx: (Math.random() - 0.5) * speed * 2,
      vy: (Math.random() - 0.5) * speed * 2,
      angle: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.03,
    };
  }

  private distance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  }

  private shoot(): void {
    if (this.bullets.length < 5) {
      this.bullets.push({
        x: this.ship.x + Math.cos(this.ship.angle) * this.ship.radius,
        y: this.ship.y + Math.sin(this.ship.angle) * this.ship.radius,
        vx: Math.cos(this.ship.angle) * this.BULLET_SPEED + this.ship.thrust.x,
        vy: Math.sin(this.ship.angle) * this.BULLET_SPEED + this.ship.thrust.y,
        life: this.BULLET_LIFE,
      });
    }
  }

  private createExplosion(x: number, y: number): void {
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 2 + 1;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 25,
        maxLife: 25,
        size: Math.random() * 3 + 1,
      });
    }
  }

  private wrapPosition(obj: { x: number; y: number }, radius: number = 0): void {
    if (obj.x < this.gameLeft - radius) obj.x = this.gameLeft + this.gameWidth + radius;
    if (obj.x > this.gameLeft + this.gameWidth + radius) obj.x = this.gameLeft - radius;
    if (obj.y < this.gameTop - 10 - radius) obj.y = this.gameTop - 10 + this.gameHeight + radius;
    if (obj.y > this.gameTop - 10 + this.gameHeight + radius) obj.y = this.gameTop - 10 - radius;
  }

  private updateUI(): void {
    this.scoreText.setText(`SCORE: ${this.score}`);
    this.livesText.setText(`LIVES: ${this.lives}`);
    this.levelText.setText(`LEVEL: ${this.level}`);
  }

  private gameOver(): void {
    this.gameRunning = false;
    this.gameOverText.setVisible(true);
    this.startText.setText('PRESS ENTER TO RETRY');
    this.startText.setVisible(true);
  }

  private update(): void {
    if (!this.isVisible) return;
    
    // Check for ESC to exit
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.hide();
      return;
    }
    
    // Check for ENTER to start/restart
    if (!this.gameRunning && Phaser.Input.Keyboard.JustDown(this.enterKey)) {
      this.startGame();
      return;
    }
    
    if (!this.gameRunning) {
      this.render();
      return;
    }
    
    // Ship controls
    if (this.cursors.left.isDown) {
      this.ship.angle -= this.SHIP_ROTATION_SPEED;
    }
    if (this.cursors.right.isDown) {
      this.ship.angle += this.SHIP_ROTATION_SPEED;
    }
    if (this.cursors.up.isDown) {
      this.ship.thrust.x += Math.cos(this.ship.angle) * this.SHIP_THRUST;
      this.ship.thrust.y += Math.sin(this.ship.angle) * this.SHIP_THRUST;
    }
    
    // Shoot
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.shoot();
    }
    
    // Apply friction
    this.ship.thrust.x *= this.FRICTION;
    this.ship.thrust.y *= this.FRICTION;
    
    // Move ship
    this.ship.x += this.ship.thrust.x;
    this.ship.y += this.ship.thrust.y;
    this.wrapPosition(this.ship);
    
    // Update invincibility
    if (this.ship.invincible && Date.now() > this.ship.invincibleTime) {
      this.ship.invincible = false;
    }
    
    // Update bullets
    this.bullets = this.bullets.filter(b => {
      b.x += b.vx;
      b.y += b.vy;
      b.life--;
      this.wrapPosition(b);
      return b.life > 0;
    });
    
    // Update asteroids
    this.asteroids.forEach(a => {
      a.x += a.vx;
      a.y += a.vy;
      a.angle += a.rotSpeed;
      this.wrapPosition(a, a.radius);
    });
    
    // Update particles
    this.particles = this.particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      return p.life > 0;
    });
    
    // Collision: bullets vs asteroids
    for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
      const bullet = this.bullets[bi];
      for (let ai = this.asteroids.length - 1; ai >= 0; ai--) {
        const asteroid = this.asteroids[ai];
        if (this.distance(bullet.x, bullet.y, asteroid.x, asteroid.y) < asteroid.radius) {
          // Hit!
          this.createExplosion(asteroid.x, asteroid.y);
          this.bullets.splice(bi, 1);
          
          // Score
          if (asteroid.size === 'large') this.score += 20;
          else if (asteroid.size === 'medium') this.score += 50;
          else this.score += 100;
          
          // Split asteroid
          if (asteroid.size === 'large') {
            this.asteroids.push(this.createAsteroid(asteroid.x, asteroid.y, 'medium'));
            this.asteroids.push(this.createAsteroid(asteroid.x, asteroid.y, 'medium'));
          } else if (asteroid.size === 'medium') {
            this.asteroids.push(this.createAsteroid(asteroid.x, asteroid.y, 'small'));
            this.asteroids.push(this.createAsteroid(asteroid.x, asteroid.y, 'small'));
          }
          
          this.asteroids.splice(ai, 1);
          this.updateUI();
          break;
        }
      }
    }
    
    // Collision: ship vs asteroids
    if (!this.ship.invincible) {
      for (const asteroid of this.asteroids) {
        if (this.distance(this.ship.x, this.ship.y, asteroid.x, asteroid.y) < asteroid.radius + this.ship.radius - 5) {
          this.createExplosion(this.ship.x, this.ship.y);
          this.lives--;
          this.updateUI();
          
          if (this.lives <= 0) {
            this.gameOver();
          } else {
            this.resetShip();
          }
          break;
        }
      }
    }
    
    // Level complete
    if (this.asteroids.length === 0 && this.gameRunning) {
      this.level++;
      this.createAsteroids(3 + this.level);
      this.updateUI();
    }
    
    this.render();
  }

  private render(): void {
    this.gameCanvas.clear();
    
    // Draw particles
    this.particles.forEach(p => {
      const alpha = p.life / p.maxLife;
      this.gameCanvas.fillStyle(0xffcc66, alpha);
      this.gameCanvas.fillCircle(p.x, p.y, p.size);
    });
    
    // Draw asteroids
    this.gameCanvas.lineStyle(2, 0x888888);
    this.asteroids.forEach(a => {
      this.gameCanvas.beginPath();
      a.vertices.forEach((v, i) => {
        const x = a.x + Math.cos(v.angle + a.angle) * v.dist;
        const y = a.y + Math.sin(v.angle + a.angle) * v.dist;
        if (i === 0) this.gameCanvas.moveTo(x, y);
        else this.gameCanvas.lineTo(x, y);
      });
      this.gameCanvas.closePath();
      this.gameCanvas.strokePath();
    });
    
    // Draw bullets
    this.gameCanvas.fillStyle(0xffff00);
    this.bullets.forEach(b => {
      this.gameCanvas.fillCircle(b.x, b.y, 2);
    });
    
    // Draw ship
    if (!this.ship.invincible || Math.floor(Date.now() / 100) % 2 === 0) {
      this.gameCanvas.lineStyle(2, 0x00ffff);
      
      const cos = Math.cos(this.ship.angle);
      const sin = Math.sin(this.ship.angle);
      const r = this.ship.radius;
      
      // Ship triangle
      const nose = { x: this.ship.x + cos * r, y: this.ship.y + sin * r };
      const left = { 
        x: this.ship.x + Math.cos(this.ship.angle + 2.5) * r * 0.8, 
        y: this.ship.y + Math.sin(this.ship.angle + 2.5) * r * 0.8 
      };
      const right = { 
        x: this.ship.x + Math.cos(this.ship.angle - 2.5) * r * 0.8, 
        y: this.ship.y + Math.sin(this.ship.angle - 2.5) * r * 0.8 
      };
      const back = {
        x: this.ship.x - cos * r * 0.4,
        y: this.ship.y - sin * r * 0.4,
      };
      
      this.gameCanvas.beginPath();
      this.gameCanvas.moveTo(nose.x, nose.y);
      this.gameCanvas.lineTo(left.x, left.y);
      this.gameCanvas.lineTo(back.x, back.y);
      this.gameCanvas.lineTo(right.x, right.y);
      this.gameCanvas.closePath();
      this.gameCanvas.strokePath();
      
      // Thrust flame
      if (this.cursors.up.isDown && this.gameRunning) {
        this.gameCanvas.lineStyle(2, 0xff8800);
        const flameLen = r * (0.6 + Math.random() * 0.4);
        this.gameCanvas.beginPath();
        this.gameCanvas.moveTo(left.x, left.y);
        this.gameCanvas.lineTo(this.ship.x - cos * flameLen, this.ship.y - sin * flameLen);
        this.gameCanvas.lineTo(right.x, right.y);
        this.gameCanvas.strokePath();
      }
    }
  }

  getIsVisible(): boolean {
    return this.isVisible;
  }
}
