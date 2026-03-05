import Phaser from 'phaser';

export class Player extends Phaser.Physics.Arcade.Sprite {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private baseSpeed: number = 300;
  private sprintMultiplier: number = 2;
  private isMovementEnabled: boolean = true;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player');
    
    scene.add.existing(this);
    scene.physics.add.existing(this);
    
    this.setCollideWorldBounds(true);
    this.setSize(24, 24);
    this.setOffset(4, 8);
    
    // Set up input
    if (scene.input.keyboard) {
      this.cursors = scene.input.keyboard.createCursorKeys();
      this.wasd = {
        W: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        A: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        S: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        D: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
      this.shiftKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    }
  }

  setScale(x: number, y?: number): this {
    super.setScale(x, y);
    // Scale hitbox proportionally
    this.setSize(24 * x, 24 * x);
    this.setOffset(4 * x, 8 * x);
    return this;
  }

  enableMovement(): void {
    this.isMovementEnabled = true;
  }

  disableMovement(): void {
    this.isMovementEnabled = false;
    this.setVelocity(0, 0);
  }

  update(): void {
    if (!this.isMovementEnabled) {
      return;
    }

    const body = this.body as Phaser.Physics.Arcade.Body;
    
    // Calculate speed (sprint if shift held)
    const isSprinting = this.shiftKey?.isDown;
    const currentSpeed = isSprinting ? this.baseSpeed * this.sprintMultiplier : this.baseSpeed;

    // Accumulate velocity (opposite keys cancel out)
    let vx = 0;
    let vy = 0;

    // Horizontal movement
    if (this.cursors?.left.isDown || this.wasd?.A.isDown) {
      vx -= 1;
    }
    if (this.cursors?.right.isDown || this.wasd?.D.isDown) {
      vx += 1;
    }

    // Vertical movement
    if (this.cursors?.up.isDown || this.wasd?.W.isDown) {
      vy -= 1;
    }
    if (this.cursors?.down.isDown || this.wasd?.S.isDown) {
      vy += 1;
    }

    // Set velocity and normalize for consistent diagonal speed
    body.setVelocity(vx * currentSpeed, vy * currentSpeed);
    if (vx !== 0 && vy !== 0) {
      body.velocity.normalize().scale(currentSpeed);
    }
  }
}
