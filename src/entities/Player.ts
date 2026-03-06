import Phaser from 'phaser';
import {
  Direction, directionFromVelocity, getStandFrame,
  walkAnimKey, registerWalkAnimations,
} from '../sprites/DirectionalSprite';

export class Player extends Phaser.Physics.Arcade.Sprite {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private baseSpeed: number = 300;
  private sprintMultiplier: number = 2;
  private isMovementEnabled: boolean = true;
  private currentDirection: Direction = Direction.DOWN;
  private isWalking: boolean = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player', getStandFrame(Direction.DOWN));
    
    scene.add.existing(this);
    scene.physics.add.existing(this);
    
    this.setCollideWorldBounds(true);
    this.setSize(16, 18);
    this.setOffset(8, 8); // center 16x18 body in 32x34 frame: (32-16)/2=8, (34-18)/2=8

    // Register walk animations for the player spritesheet
    registerWalkAnimations(scene.anims, 'player');
    
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
    // Scale hitbox: size in world pixels, offset in FRAME coords (Phaser applies scale)
    this.setSize(16, 18);
    this.setOffset(8, 8);
    return this;
  }

  enableMovement(): void {
    this.isMovementEnabled = true;
  }

  disableMovement(): void {
    this.isMovementEnabled = false;
    this.setVelocity(0, 0);
    this.stopWalking();
  }

  private stopWalking(): void {
    if (this.isWalking) {
      this.isWalking = false;
      this.anims.stop();
      this.setFrame(getStandFrame(this.currentDirection));
    }
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

    // Update direction and walk animation
    const newDir = directionFromVelocity(vx, vy);
    if (newDir !== null) {
      const dirChanged = newDir !== this.currentDirection;
      this.currentDirection = newDir;

      if (!this.isWalking || dirChanged) {
        this.isWalking = true;
        this.anims.play(walkAnimKey('player', this.currentDirection), true);
      }
    } else {
      this.stopWalking();
    }
  }
}
