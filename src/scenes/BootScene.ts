import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Create loading bar
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    
    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x222222, 0.8);
    progressBox.fillRect(width / 2 - 160, height / 2 - 25, 320, 50);

    const loadingText = this.add.text(width / 2, height / 2 - 50, 'Loading...', {
      font: '20px monospace',
      color: '#ffffff',
    });
    loadingText.setOrigin(0.5, 0.5);

    this.load.on('progress', (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0x00ff88, 1);
      progressBar.fillRect(width / 2 - 150, height / 2 - 15, 300 * value, 30);
    });

    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
    });

    // Generate placeholder sprites programmatically
    this.generatePlaceholderSprites();
  }

  private generatePlaceholderSprites(): void {
    // ===== PLAYER SPRITE (Office Boss in suit) =====
    const playerGraphics = this.make.graphics({ x: 0, y: 0 });
    // Hair (dark)
    playerGraphics.fillStyle(0x2a1a0a, 1);
    playerGraphics.fillRect(10, 2, 12, 6);
    // Face/head (skin tone)
    playerGraphics.fillStyle(0xffdbac, 1);
    playerGraphics.fillRect(10, 6, 12, 10);
    // Eyes
    playerGraphics.fillStyle(0x000000, 1);
    playerGraphics.fillRect(12, 9, 2, 2);
    playerGraphics.fillRect(18, 9, 2, 2);
    // Smile
    playerGraphics.fillRect(14, 13, 4, 1);
    // Suit jacket (navy blue)
    playerGraphics.fillStyle(0x1a2a4a, 1);
    playerGraphics.fillRect(6, 16, 20, 12);
    // White shirt/collar
    playerGraphics.fillStyle(0xffffff, 1);
    playerGraphics.fillRect(13, 16, 6, 4);
    // Red tie
    playerGraphics.fillStyle(0xcc2222, 1);
    playerGraphics.fillRect(15, 18, 2, 8);
    // Hands (skin)
    playerGraphics.fillStyle(0xffdbac, 1);
    playerGraphics.fillRect(4, 24, 4, 4);
    playerGraphics.fillRect(24, 24, 4, 4);
    // Pants (dark)
    playerGraphics.fillStyle(0x1a1a2a, 1);
    playerGraphics.fillRect(10, 28, 5, 4);
    playerGraphics.fillRect(17, 28, 5, 4);
    // Shoes
    playerGraphics.fillStyle(0x111111, 1);
    playerGraphics.fillRect(9, 31, 6, 2);
    playerGraphics.fillRect(17, 31, 6, 2);
    playerGraphics.generateTexture('player', 32, 34);
    playerGraphics.destroy();

    // ===== AGENT SPRITES (8-bit heroes) =====
    
    // Azure - Cloud Wizard (blue robes, staff)
    this.createHeroSprite('npc_azure', {
      skinColor: 0xffdbac,
      hairColor: 0x4488ff,
      hairStyle: 'spiky',
      bodyColor: 0x0078d4,
      bodyStyle: 'robe',
      accessory: 'staff',
      accessoryColor: 0x88ccff,
    });

    // Validator - Knight with shield (green armor)
    this.createHeroSprite('npc_validator', {
      skinColor: 0xffdbac,
      hairColor: 0x2a1a0a,
      hairStyle: 'helmet',
      helmetColor: 0x00aa44,
      bodyColor: 0x008833,
      bodyStyle: 'armor',
      accessory: 'shield',
      accessoryColor: 0x00ff66,
    });

    // Deployer - Rocket pilot (orange suit, goggles)
    this.createHeroSprite('npc_deployer', {
      skinColor: 0xffdbac,
      hairColor: 0x5a3a1a,
      hairStyle: 'goggles',
      bodyColor: 0xff6600,
      bodyStyle: 'pilot',
      accessory: 'rocket',
      accessoryColor: 0xffaa00,
    });

    // Doctor - Medic (red cross, white coat)
    this.createHeroSprite('npc_doctor', {
      skinColor: 0x8b6914,
      hairColor: 0x1a1a1a,
      hairStyle: 'short',
      bodyColor: 0xffffff,
      bodyStyle: 'coat',
      accessory: 'stethoscope',
      accessoryColor: 0xff4444,
    });

    // Scout - Ranger (purple cloak, binoculars)
    this.createHeroSprite('npc_scout', {
      skinColor: 0xffdbac,
      hairColor: 0x8844aa,
      hairStyle: 'long',
      bodyColor: 0x6622aa,
      bodyStyle: 'cloak',
      accessory: 'binoculars',
      accessoryColor: 0xaa66ff,
    });

    // Accountant - Treasure keeper (gold accents, coins)
    this.createHeroSprite('npc_accountant', {
      skinColor: 0xc68642,
      hairColor: 0x1a1a1a,
      hairStyle: 'bun',
      bodyColor: 0x2a4a2a,
      bodyStyle: 'vest',
      accessory: 'coins',
      accessoryColor: 0xffcc00,
    });

    // Office Admin - Meta wizard (magenta/pink, recursive symbol)
    this.createHeroSprite('npc_admin', {
      skinColor: 0xffdbac,
      hairColor: 0xff44ff,
      hairStyle: 'spiky',
      bodyColor: 0x8800aa,
      bodyStyle: 'robe',
      accessory: 'meta',
      accessoryColor: 0xff88ff,
    });

    // Gene - Generalist (casual blue coat, holding a book)
    this.createHeroSprite('npc_generalist', {
      skinColor: 0xffdbac,
      hairColor: 0x224488,
      hairStyle: 'short',
      bodyColor: 0x4488cc,
      bodyStyle: 'coat',
      accessory: 'book',
      accessoryColor: 0x88bbee,
    });

    // Arthur - The Architect (dark cloak, blueprint scroll)
    this.createHeroSprite('npc_architect', {
      skinColor: 0xd4a574,
      hairColor: 0x1a1a1a,
      hairStyle: 'long',
      bodyColor: 0x1a1a2e,
      bodyStyle: 'cloak',
      accessory: 'blueprint',
      accessoryColor: 0x8888ff,
    });

    // ===== FURNITURE SPRITES =====
    
    // Desk tile - top-down view (walnut surface with wood grain)
    const deskGraphics = this.make.graphics({ x: 0, y: 0 });
    // Drop shadow (bottom-right gives depth)
    deskGraphics.fillStyle(0x1e0e04, 1);
    deskGraphics.fillRect(3, 3, 29, 29);
    // Desk surface
    deskGraphics.fillStyle(0x7a4520, 1);
    deskGraphics.fillRect(1, 1, 28, 28);
    // Surface highlight (lighter center)
    deskGraphics.fillStyle(0x8c5228, 1);
    deskGraphics.fillRect(2, 2, 25, 25);
    // Wood grain lines (horizontal)
    deskGraphics.fillStyle(0x5e3312, 1);
    deskGraphics.fillRect(3, 6,  22, 1);
    deskGraphics.fillRect(3, 11, 24, 1);
    deskGraphics.fillRect(3, 16, 20, 1);
    deskGraphics.fillRect(3, 21, 23, 1);
    deskGraphics.fillRect(3, 25, 18, 1);
    // Top-left edge highlight
    deskGraphics.fillStyle(0xaa6a38, 1);
    deskGraphics.fillRect(1, 1, 1, 27);
    deskGraphics.fillRect(1, 1, 27, 1);
    // Bottom-right inner shadow
    deskGraphics.fillStyle(0x5a2e0e, 1);
    deskGraphics.fillRect(26, 2, 1, 26);
    deskGraphics.fillRect(2, 26, 25, 1);
    deskGraphics.generateTexture('desk', 32, 32);
    deskGraphics.destroy();

    // Floor tile - hardwood panels, 3 staggered rows per tile
    const floorGraphics = this.make.graphics({ x: 0, y: 0 });
    const plankH = 10;
    const gapH = 1;
    const plankBase = 0xD4975A;      // light honey/maple
    const plankGrain = 0xBE8244;     // subtle grain (close to base)
    const plankHighlight = 0xE0A86A; // top-edge highlight
    const gapColor = 0xC07840;       // very close to plank, just a hint darker
    // Fill entire tile as background so sprite seams don't bleed black
    floorGraphics.fillStyle(plankBase, 1);
    floorGraphics.fillRect(0, 0, 32, 32);
    const plankRows = [
      { y: 0,                    offset: 0  },
      { y: plankH + gapH,        offset: 16 },
      { y: (plankH + gapH) * 2,  offset: 8  },
    ];
    for (const row of plankRows) {
      floorGraphics.fillStyle(plankBase, 1);
      floorGraphics.fillRect(0, row.y, 32, plankH);
      // Subtle top highlight
      floorGraphics.fillStyle(plankHighlight, 1);
      floorGraphics.fillRect(0, row.y, 32, 1);
      // Grain lines (same positions every row for consistency)
      floorGraphics.fillStyle(plankGrain, 1);
      floorGraphics.fillRect(0, row.y + 4, 32, 1);
      floorGraphics.fillRect(0, row.y + 7, 32, 1);
      // Vertical end seam (staggered)
      if (row.offset > 0 && row.offset < 32) {
        floorGraphics.fillStyle(gapColor, 1);
        floorGraphics.fillRect(row.offset, row.y, 1, plankH);
      }
    }
    // Horizontal gaps between planks
    floorGraphics.fillStyle(gapColor, 1);
    floorGraphics.fillRect(0, plankH, 32, gapH);
    floorGraphics.fillRect(0, (plankH + gapH) * 2, 32, gapH);
    floorGraphics.generateTexture('floor', 32, 32);
    floorGraphics.destroy();

    // Wall tile (bright office wall with baseboard)
    const wallGraphics = this.make.graphics({ x: 0, y: 0 });
    wallGraphics.fillStyle(0xc8d4e0, 1);  // Light gray-blue wall
    wallGraphics.fillRect(0, 0, 32, 32);
    wallGraphics.fillStyle(0xdce4ec, 1);  // Even lighter inner
    wallGraphics.fillRect(2, 2, 28, 26);
    // Baseboard
    wallGraphics.fillStyle(0x5a4030, 1);
    wallGraphics.fillRect(0, 28, 32, 4);
    wallGraphics.generateTexture('wall', 32, 32);
    wallGraphics.destroy();

    // Door tile (entrance doors in bottom wall)
    const doorGraphics = this.make.graphics({ x: 0, y: 0 });
    // Outer door frame (dark wood)
    doorGraphics.fillStyle(0x2a1a0a, 1);
    doorGraphics.fillRect(0, 0, 32, 32);
    // Door panel (warm wood)
    doorGraphics.fillStyle(0xc4833c, 1);
    doorGraphics.fillRect(3, 2, 26, 30);
    // Upper glass panel
    doorGraphics.fillStyle(0x88ccee, 1);
    doorGraphics.fillRect(5, 4, 22, 11);
    // Glass shine highlight
    doorGraphics.fillStyle(0xaaddff, 1);
    doorGraphics.fillRect(6, 5, 7, 4);
    // Lower wood raised panel
    doorGraphics.fillStyle(0xb07030, 1);
    doorGraphics.fillRect(5, 17, 22, 13);
    // Divider between glass and panel
    doorGraphics.fillStyle(0x2a1a0a, 1);
    doorGraphics.fillRect(5, 15, 22, 2);
    // Center seam (double door split)
    doorGraphics.fillRect(15, 0, 2, 32);
    // Door handles (gold)
    doorGraphics.fillStyle(0xe0c060, 1);
    doorGraphics.fillRect(10, 13, 5, 2);
    doorGraphics.fillRect(17, 13, 5, 2);
    doorGraphics.generateTexture('door', 32, 32);
    doorGraphics.destroy();

    // Welcome mat tile
    const matGraphics = this.make.graphics({ x: 0, y: 0 });
    // Mat body (deep burgundy)
    matGraphics.fillStyle(0x7a1515, 1);
    matGraphics.fillRect(0, 5, 32, 22);
    // Gold border
    matGraphics.fillStyle(0xcc9900, 1);
    matGraphics.fillRect(0, 5, 32, 3);
    matGraphics.fillRect(0, 24, 32, 3);
    matGraphics.fillRect(0, 8, 3, 16);
    matGraphics.fillRect(29, 8, 3, 16);
    // Inner field (slightly lighter red)
    matGraphics.fillStyle(0xaa2222, 1);
    matGraphics.fillRect(3, 8, 26, 16);
    // Centre diamond motif in gold
    matGraphics.fillStyle(0xcc9900, 1);
    matGraphics.fillRect(15, 11, 2, 10);  // vertical stem
    matGraphics.fillRect(11, 15, 10, 2);  // horizontal stem
    matGraphics.fillRect(14, 10, 4, 2);   // top cap
    matGraphics.fillRect(14, 20, 4, 2);   // bottom cap
    matGraphics.fillRect(10, 14, 2, 4);   // left cap
    matGraphics.fillRect(20, 14, 2, 4);   // right cap
    matGraphics.generateTexture('welcome_mat', 32, 32);
    matGraphics.destroy();

    // Chair (office chair)
    const chairGraphics = this.make.graphics({ x: 0, y: 0 });
    // Seat
    chairGraphics.fillStyle(0x2a2a2a, 1);
    chairGraphics.fillRect(6, 14, 20, 10);
    // Back
    chairGraphics.fillStyle(0x3a3a3a, 1);
    chairGraphics.fillRect(8, 4, 16, 12);
    // Cushion
    chairGraphics.fillStyle(0x1a1a3a, 1);
    chairGraphics.fillRect(10, 6, 12, 8);
    // Legs/wheels
    chairGraphics.fillStyle(0x444444, 1);
    chairGraphics.fillRect(14, 24, 4, 6);
    chairGraphics.fillRect(8, 28, 6, 4);
    chairGraphics.fillRect(18, 28, 6, 4);
    chairGraphics.generateTexture('chair', 32, 32);
    chairGraphics.destroy();

    // Laptop - top-down view (open, looking straight down)
    const computerGraphics = this.make.graphics({ x: 0, y: 0 });
    // Outer aluminum body
    computerGraphics.fillStyle(0x999999, 1);
    computerGraphics.fillRect(4, 2, 24, 28);
    // Screen portion (top ~40% — screen face tilted up, visible from above)
    computerGraphics.fillStyle(0x0d1b2a, 1);
    computerGraphics.fillRect(5, 3, 22, 11);
    // Screen content glow
    computerGraphics.fillStyle(0x1a3a5c, 1);
    computerGraphics.fillRect(6, 4, 20, 9);
    // Code lines on screen
    computerGraphics.fillStyle(0x44ff88, 1);
    computerGraphics.fillRect(8,  5, 9, 1);
    computerGraphics.fillRect(8,  7, 14, 1);
    computerGraphics.fillRect(8,  9, 6,  1);
    computerGraphics.fillRect(8, 11, 11, 1);
    // Hinge (line between screen and keyboard)
    computerGraphics.fillStyle(0x555555, 1);
    computerGraphics.fillRect(5, 14, 22, 2);
    // Keyboard deck (bottom ~60%)
    computerGraphics.fillStyle(0x1a1a1a, 1);
    computerGraphics.fillRect(5, 16, 22, 13);
    // Key rows (3 rows of key impressions)
    computerGraphics.fillStyle(0x383838, 1);
    for (let k = 0; k < 10; k++) computerGraphics.fillRect(5 + k * 2, 17, 1, 2);
    for (let k = 0; k < 10; k++) computerGraphics.fillRect(5 + k * 2, 21, 1, 2);
    for (let k = 0; k <  8; k++) computerGraphics.fillRect(6 + k * 2, 25, 1, 2);
    // Trackpad
    computerGraphics.fillStyle(0x2a2a2a, 1);
    computerGraphics.fillRect(11, 27, 10, 1);
    computerGraphics.generateTexture('computer', 32, 32);
    computerGraphics.destroy();

    // Interaction indicator (speech bubble with !)
    const indicatorGraphics = this.make.graphics({ x: 0, y: 0 });
    // Bubble
    indicatorGraphics.fillStyle(0xffff44, 1);
    indicatorGraphics.fillRoundedRect(4, 0, 24, 20, 4);
    // Pointer
    indicatorGraphics.fillTriangle(14, 20, 18, 20, 16, 26);
    // E key
    indicatorGraphics.fillStyle(0x000000, 1);
    indicatorGraphics.fillRect(11, 5, 10, 2);
    indicatorGraphics.fillRect(11, 5, 2, 10);
    indicatorGraphics.fillRect(11, 9, 8, 2);
    indicatorGraphics.fillRect(11, 13, 10, 2);
    indicatorGraphics.generateTexture('indicator', 32, 28);
    indicatorGraphics.destroy();

    // Plant (potted plant)
    const plantGraphics = this.make.graphics({ x: 0, y: 0 });
    // Pot
    plantGraphics.fillStyle(0x8b4513, 1);
    plantGraphics.fillRect(10, 20, 12, 12);
    plantGraphics.fillStyle(0x654321, 1);
    plantGraphics.fillRect(8, 18, 16, 4);
    // Soil
    plantGraphics.fillStyle(0x3d2817, 1);
    plantGraphics.fillRect(11, 19, 10, 3);
    // Leaves
    plantGraphics.fillStyle(0x228b22, 1);
    plantGraphics.fillCircle(16, 12, 8);
    plantGraphics.fillCircle(12, 8, 6);
    plantGraphics.fillCircle(20, 8, 6);
    plantGraphics.fillStyle(0x32cd32, 1);
    plantGraphics.fillCircle(16, 10, 5);
    plantGraphics.generateTexture('plant', 32, 32);
    plantGraphics.destroy();

    // Water cooler
    const coolerGraphics = this.make.graphics({ x: 0, y: 0 });
    // Water jug
    coolerGraphics.fillStyle(0x88ccff, 1);
    computerGraphics.fillStyle(0x66aadd, 1);
    coolerGraphics.fillRect(10, 0, 12, 14);
    coolerGraphics.fillStyle(0xaaddff, 1);
    coolerGraphics.fillRect(12, 2, 8, 10);
    // Dispenser body
    coolerGraphics.fillStyle(0xeeeeee, 1);
    coolerGraphics.fillRect(8, 14, 16, 18);
    coolerGraphics.fillStyle(0xcccccc, 1);
    coolerGraphics.fillRect(10, 16, 12, 14);
    // Tap
    coolerGraphics.fillStyle(0x4444ff, 1);
    coolerGraphics.fillRect(14, 22, 4, 3);
    coolerGraphics.generateTexture('cooler', 32, 32);
    coolerGraphics.destroy();

    // Ping pong table with two players (64x64)
    const pingpongGraphics = this.make.graphics({ x: 0, y: 0 });
    
    // Left player (red shirt)
    // Head
    pingpongGraphics.fillStyle(0xffdbac, 1);
    pingpongGraphics.fillRect(6, 16, 8, 8);
    // Hair
    pingpongGraphics.fillStyle(0x3a2a1a, 1);
    pingpongGraphics.fillRect(6, 14, 8, 4);
    // Eyes
    pingpongGraphics.fillStyle(0x000000, 1);
    pingpongGraphics.fillRect(8, 19, 2, 2);
    pingpongGraphics.fillRect(12, 19, 2, 2);
    // Body (red shirt)
    pingpongGraphics.fillStyle(0xcc3333, 1);
    pingpongGraphics.fillRect(4, 24, 12, 14);
    // Arm holding paddle (extended right)
    pingpongGraphics.fillStyle(0xffdbac, 1);
    pingpongGraphics.fillRect(14, 26, 8, 4);
    // Paddle
    pingpongGraphics.fillStyle(0x8b0000, 1);
    pingpongGraphics.fillRect(20, 24, 6, 8);
    pingpongGraphics.fillStyle(0x5c3317, 1);
    pingpongGraphics.fillRect(22, 32, 2, 4);
    // Legs
    pingpongGraphics.fillStyle(0x2a2a4a, 1);
    pingpongGraphics.fillRect(5, 38, 4, 10);
    pingpongGraphics.fillRect(11, 38, 4, 10);
    // Shoes
    pingpongGraphics.fillStyle(0xffffff, 1);
    pingpongGraphics.fillRect(4, 46, 6, 4);
    pingpongGraphics.fillRect(10, 46, 6, 4);
    
    // Right player (blue shirt)
    // Head
    pingpongGraphics.fillStyle(0xffdbac, 1);
    pingpongGraphics.fillRect(50, 16, 8, 8);
    // Hair
    pingpongGraphics.fillStyle(0x1a1a2a, 1);
    pingpongGraphics.fillRect(50, 14, 8, 4);
    // Eyes
    pingpongGraphics.fillStyle(0x000000, 1);
    pingpongGraphics.fillRect(52, 19, 2, 2);
    pingpongGraphics.fillRect(54, 19, 2, 2);
    // Body (blue shirt)
    pingpongGraphics.fillStyle(0x3366cc, 1);
    pingpongGraphics.fillRect(48, 24, 12, 14);
    // Arm holding paddle (extended left)
    pingpongGraphics.fillStyle(0xffdbac, 1);
    pingpongGraphics.fillRect(42, 26, 8, 4);
    // Paddle
    pingpongGraphics.fillStyle(0x000000, 1);
    pingpongGraphics.fillRect(38, 24, 6, 8);
    pingpongGraphics.fillStyle(0x5c3317, 1);
    pingpongGraphics.fillRect(40, 32, 2, 4);
    // Legs
    pingpongGraphics.fillStyle(0x2a2a4a, 1);
    pingpongGraphics.fillRect(49, 38, 4, 10);
    pingpongGraphics.fillRect(55, 38, 4, 10);
    // Shoes
    pingpongGraphics.fillStyle(0xffffff, 1);
    pingpongGraphics.fillRect(48, 46, 6, 4);
    pingpongGraphics.fillRect(54, 46, 6, 4);
    
    // Table (between players)
    // Legs
    pingpongGraphics.fillStyle(0x555555, 1);
    pingpongGraphics.fillRect(26, 42, 3, 12);
    pingpongGraphics.fillRect(35, 42, 3, 12);
    // Table surface (blue)
    pingpongGraphics.fillStyle(0x1560bd, 1);
    pingpongGraphics.fillRect(24, 34, 16, 10);
    // White lines
    pingpongGraphics.fillStyle(0xffffff, 1);
    pingpongGraphics.fillRect(24, 34, 16, 1);
    pingpongGraphics.fillRect(24, 43, 16, 1);
    pingpongGraphics.fillRect(24, 34, 1, 10);
    pingpongGraphics.fillRect(39, 34, 1, 10);
    pingpongGraphics.fillRect(31, 34, 2, 10);
    // Net
    pingpongGraphics.fillStyle(0xeeeeee, 1);
    pingpongGraphics.fillRect(30, 30, 4, 5);
    pingpongGraphics.fillStyle(0xaaaaaa, 1);
    pingpongGraphics.fillRect(31, 31, 2, 3);
    
    // Ball (in mid-air)
    pingpongGraphics.fillStyle(0xffffff, 1);
    pingpongGraphics.fillCircle(32, 26, 2);
    pingpongGraphics.fillStyle(0xff6600, 1);
    pingpongGraphics.fillCircle(32, 26, 1);
    
    pingpongGraphics.generateTexture('pingpong', 64, 54);
    pingpongGraphics.destroy();

    // Window tile (bright daytime skyscraper view)
    const windowGraphics = this.make.graphics({ x: 0, y: 0 });
    // Bright sky gradient
    windowGraphics.fillStyle(0x99ddff, 1);  // Bright sky blue
    windowGraphics.fillRect(0, 0, 32, 32);
    windowGraphics.fillStyle(0x88ccee, 1);
    windowGraphics.fillRect(0, 12, 32, 20);
    // Distant buildings silhouette (lighter for daytime)
    windowGraphics.fillStyle(0x7090a0, 1);
    windowGraphics.fillRect(2, 16, 6, 16);
    windowGraphics.fillRect(10, 20, 4, 12);
    windowGraphics.fillRect(16, 14, 5, 18);
    windowGraphics.fillRect(23, 18, 7, 14);
    // Building windows (reflections)
    windowGraphics.fillStyle(0xffffff, 0.6);
    windowGraphics.fillRect(3, 18, 2, 2);
    windowGraphics.fillRect(3, 22, 2, 2);
    windowGraphics.fillRect(5, 20, 2, 2);
    windowGraphics.fillRect(17, 16, 2, 2);
    windowGraphics.fillRect(17, 20, 2, 2);
    windowGraphics.fillRect(19, 18, 2, 2);
    windowGraphics.fillRect(24, 20, 2, 2);
    windowGraphics.fillRect(26, 22, 2, 2);
    // Window frame (lighter)
    windowGraphics.fillStyle(0x6a7a8a, 1);
    windowGraphics.fillRect(0, 0, 2, 32);
    windowGraphics.fillRect(30, 0, 2, 32);
    windowGraphics.fillRect(0, 0, 32, 2);
    windowGraphics.fillRect(0, 30, 32, 2);
    // Center divider
    windowGraphics.fillRect(15, 0, 2, 32);
    windowGraphics.generateTexture('window', 32, 32);
    windowGraphics.destroy();

    // Window with sun/clouds variant (bright sunny day)
    const windowSunGraphics = this.make.graphics({ x: 0, y: 0 });
    // Bright sky
    windowSunGraphics.fillStyle(0xaaeeff, 1);
    windowSunGraphics.fillRect(0, 0, 32, 32);
    // Sun (bright and glowing)
    windowSunGraphics.fillStyle(0xffee66, 0.4);
    windowSunGraphics.fillCircle(24, 8, 12);
    windowSunGraphics.fillStyle(0xffee88, 0.6);
    windowSunGraphics.fillCircle(24, 8, 8);
    windowSunGraphics.fillStyle(0xffff44, 1);
    windowSunGraphics.fillCircle(24, 8, 5);
    // Fluffy clouds
    windowSunGraphics.fillStyle(0xffffff, 1);
    windowSunGraphics.fillCircle(8, 12, 5);
    windowSunGraphics.fillCircle(12, 10, 4);
    windowSunGraphics.fillCircle(14, 13, 3);
    windowSunGraphics.fillCircle(5, 14, 3);
    // Distant buildings
    windowSunGraphics.fillStyle(0x8098a8, 1);
    windowSunGraphics.fillRect(4, 22, 5, 10);
    windowSunGraphics.fillRect(11, 18, 4, 14);
    windowSunGraphics.fillRect(20, 24, 6, 8);
    // Window frame
    windowSunGraphics.fillStyle(0x6a7a8a, 1);
    windowSunGraphics.fillRect(0, 0, 2, 32);
    windowSunGraphics.fillRect(30, 0, 2, 32);
    windowSunGraphics.fillRect(0, 0, 32, 2);
    windowSunGraphics.fillRect(0, 30, 32, 2);
    windowSunGraphics.fillRect(15, 0, 2, 32);
    windowSunGraphics.generateTexture('window_sun', 32, 32);
    windowSunGraphics.destroy();

    // Corner window piece (brighter)
    const windowCornerGraphics = this.make.graphics({ x: 0, y: 0 });
    windowCornerGraphics.fillStyle(0x7a8a9a, 1);
    windowCornerGraphics.fillRect(0, 0, 32, 32);
    // Inner metal/frame
    windowCornerGraphics.fillStyle(0x8a9aaa, 1);
    windowCornerGraphics.fillRect(4, 4, 24, 24);
    windowCornerGraphics.generateTexture('window_corner', 32, 32);
    windowCornerGraphics.destroy();

    // Ping pong table
    const pingPongGraphics = this.make.graphics({ x: 0, y: 0 });
    // Table surface (dark green)
    pingPongGraphics.fillStyle(0x006633, 1);
    pingPongGraphics.fillRect(0, 8, 64, 40);
    // Table border (white lines)
    pingPongGraphics.fillStyle(0xffffff, 1);
    pingPongGraphics.fillRect(0, 8, 64, 2);  // Top edge
    pingPongGraphics.fillRect(0, 46, 64, 2); // Bottom edge
    pingPongGraphics.fillRect(0, 8, 2, 40);  // Left edge
    pingPongGraphics.fillRect(62, 8, 2, 40); // Right edge
    pingPongGraphics.fillRect(31, 8, 2, 40); // Center line
    // Net (in the middle)
    pingPongGraphics.fillStyle(0x333333, 1);
    pingPongGraphics.fillRect(30, 6, 4, 2);  // Net posts
    pingPongGraphics.fillStyle(0xcccccc, 1);
    pingPongGraphics.fillRect(0, 6, 64, 2);  // Net mesh
    // Table legs
    pingPongGraphics.fillStyle(0x444444, 1);
    pingPongGraphics.fillRect(4, 48, 4, 8);
    pingPongGraphics.fillRect(56, 48, 4, 8);
    pingPongGraphics.fillRect(4, 48, 4, 8);
    pingPongGraphics.fillRect(56, 48, 4, 8);
    // Ball on table
    pingPongGraphics.fillStyle(0xffffff, 1);
    pingPongGraphics.fillCircle(20, 28, 3);
    // Paddles
    pingPongGraphics.fillStyle(0xcc0000, 1);
    pingPongGraphics.fillRect(8, 32, 8, 12);
    pingPongGraphics.fillStyle(0x000000, 1);
    pingPongGraphics.fillRect(11, 44, 2, 6);
    pingPongGraphics.fillStyle(0x0000cc, 1);
    pingPongGraphics.fillRect(48, 20, 8, 12);
    pingPongGraphics.fillStyle(0x000000, 1);
    pingPongGraphics.fillRect(51, 32, 2, 6);
    pingPongGraphics.generateTexture('pingpong', 64, 56);
    pingPongGraphics.destroy();

    // Bookshelf
    const bookshelfGraphics = this.make.graphics({ x: 0, y: 0 });
    // Shelf frame (wood)
    bookshelfGraphics.fillStyle(0x5c4033, 1);
    bookshelfGraphics.fillRect(0, 0, 32, 32);
    bookshelfGraphics.fillStyle(0x8b6914, 1);
    bookshelfGraphics.fillRect(2, 2, 28, 28);
    // Shelves
    bookshelfGraphics.fillStyle(0x5c4033, 1);
    bookshelfGraphics.fillRect(2, 10, 28, 2);
    bookshelfGraphics.fillRect(2, 20, 28, 2);
    // Books (colorful)
    bookshelfGraphics.fillStyle(0xcc2222, 1);
    bookshelfGraphics.fillRect(4, 3, 4, 6);
    bookshelfGraphics.fillStyle(0x2222cc, 1);
    bookshelfGraphics.fillRect(9, 2, 3, 7);
    bookshelfGraphics.fillStyle(0x22aa22, 1);
    bookshelfGraphics.fillRect(13, 3, 5, 6);
    bookshelfGraphics.fillStyle(0xffaa00, 1);
    bookshelfGraphics.fillRect(19, 2, 4, 7);
    bookshelfGraphics.fillStyle(0x8844aa, 1);
    bookshelfGraphics.fillRect(24, 3, 4, 6);
    // Second shelf books
    bookshelfGraphics.fillStyle(0x44aaaa, 1);
    bookshelfGraphics.fillRect(4, 13, 5, 6);
    bookshelfGraphics.fillStyle(0xaa4488, 1);
    bookshelfGraphics.fillRect(10, 12, 4, 7);
    bookshelfGraphics.fillStyle(0x888888, 1);
    bookshelfGraphics.fillRect(15, 13, 6, 6);
    bookshelfGraphics.fillStyle(0xdd6622, 1);
    bookshelfGraphics.fillRect(22, 12, 5, 7);
    // Third shelf books
    bookshelfGraphics.fillStyle(0x226688, 1);
    bookshelfGraphics.fillRect(4, 23, 4, 6);
    bookshelfGraphics.fillStyle(0x882266, 1);
    bookshelfGraphics.fillRect(9, 22, 5, 7);
    bookshelfGraphics.fillStyle(0x668822, 1);
    bookshelfGraphics.fillRect(15, 23, 4, 6);
    bookshelfGraphics.fillStyle(0xcc8844, 1);
    bookshelfGraphics.fillRect(20, 22, 3, 7);
    bookshelfGraphics.fillStyle(0x4466aa, 1);
    bookshelfGraphics.fillRect(24, 23, 4, 6);
    bookshelfGraphics.generateTexture('bookshelf', 32, 32);
    bookshelfGraphics.destroy();

    // Coffee machine
    const coffeeGraphics = this.make.graphics({ x: 0, y: 0 });
    // Machine body
    coffeeGraphics.fillStyle(0x2a2a2a, 1);
    coffeeGraphics.fillRect(6, 4, 20, 24);
    coffeeGraphics.fillStyle(0x3a3a3a, 1);
    coffeeGraphics.fillRect(8, 6, 16, 18);
    // Display panel
    coffeeGraphics.fillStyle(0x44ff88, 1);
    coffeeGraphics.fillRect(10, 8, 12, 4);
    // Coffee dispensing area
    coffeeGraphics.fillStyle(0x1a1a1a, 1);
    coffeeGraphics.fillRect(10, 14, 12, 8);
    // Coffee cup
    coffeeGraphics.fillStyle(0xffffff, 1);
    coffeeGraphics.fillRect(12, 16, 8, 6);
    coffeeGraphics.fillStyle(0x4a2a1a, 1);
    coffeeGraphics.fillRect(13, 17, 6, 4);
    // Buttons
    coffeeGraphics.fillStyle(0xff4444, 1);
    coffeeGraphics.fillCircle(11, 26, 2);
    coffeeGraphics.fillStyle(0x44ff44, 1);
    coffeeGraphics.fillCircle(16, 26, 2);
    coffeeGraphics.fillStyle(0x4444ff, 1);
    coffeeGraphics.fillCircle(21, 26, 2);
    coffeeGraphics.generateTexture('coffee', 32, 32);
    coffeeGraphics.destroy();

    // Whiteboard
    const whiteboardGraphics = this.make.graphics({ x: 0, y: 0 });
    // Frame
    whiteboardGraphics.fillStyle(0x888888, 1);
    whiteboardGraphics.fillRect(0, 0, 48, 32);
    // White surface
    whiteboardGraphics.fillStyle(0xf8f8f8, 1);
    whiteboardGraphics.fillRect(2, 2, 44, 26);
    // Writing (scribbles)
    whiteboardGraphics.fillStyle(0x2222cc, 1);
    whiteboardGraphics.fillRect(6, 6, 20, 2);
    whiteboardGraphics.fillRect(6, 10, 15, 2);
    whiteboardGraphics.fillRect(6, 14, 25, 2);
    whiteboardGraphics.fillStyle(0xcc2222, 1);
    whiteboardGraphics.fillRect(30, 6, 12, 8);
    whiteboardGraphics.fillStyle(0x22aa22, 1);
    whiteboardGraphics.fillRect(6, 18, 8, 2);
    whiteboardGraphics.fillRect(16, 18, 10, 2);
    // Tray
    whiteboardGraphics.fillStyle(0x666666, 1);
    whiteboardGraphics.fillRect(4, 28, 40, 3);
    // Markers
    whiteboardGraphics.fillStyle(0xff0000, 1);
    whiteboardGraphics.fillRect(8, 28, 6, 2);
    whiteboardGraphics.fillStyle(0x0000ff, 1);
    whiteboardGraphics.fillRect(16, 28, 6, 2);
    whiteboardGraphics.fillStyle(0x00aa00, 1);
    whiteboardGraphics.fillRect(24, 28, 6, 2);
    whiteboardGraphics.generateTexture('whiteboard', 48, 32);
    whiteboardGraphics.destroy();

    // Filing cabinet
    const cabinetGraphics = this.make.graphics({ x: 0, y: 0 });
    // Body
    cabinetGraphics.fillStyle(0x666666, 1);
    cabinetGraphics.fillRect(4, 0, 24, 32);
    cabinetGraphics.fillStyle(0x888888, 1);
    cabinetGraphics.fillRect(6, 2, 20, 28);
    // Drawers
    cabinetGraphics.fillStyle(0x777777, 1);
    cabinetGraphics.fillRect(7, 3, 18, 8);
    cabinetGraphics.fillRect(7, 13, 18, 8);
    cabinetGraphics.fillRect(7, 23, 18, 6);
    // Handles
    cabinetGraphics.fillStyle(0xaaaaaa, 1);
    cabinetGraphics.fillRect(14, 6, 4, 2);
    cabinetGraphics.fillRect(14, 16, 4, 2);
    cabinetGraphics.fillRect(14, 25, 4, 2);
    // Labels
    cabinetGraphics.fillStyle(0xffffcc, 1);
    cabinetGraphics.fillRect(8, 4, 5, 3);
    cabinetGraphics.fillRect(8, 14, 5, 3);
    cabinetGraphics.generateTexture('cabinet', 32, 32);
    cabinetGraphics.destroy();

    // Wall clock
    const clockGraphics = this.make.graphics({ x: 0, y: 0 });
    // Frame
    clockGraphics.fillStyle(0x4a3a2a, 1);
    clockGraphics.fillCircle(16, 16, 14);
    // Face
    clockGraphics.fillStyle(0xffffff, 1);
    clockGraphics.fillCircle(16, 16, 12);
    // Hour markers
    clockGraphics.fillStyle(0x000000, 1);
    clockGraphics.fillRect(15, 5, 2, 3);  // 12
    clockGraphics.fillRect(15, 24, 2, 3); // 6
    clockGraphics.fillRect(5, 15, 3, 2);  // 9
    clockGraphics.fillRect(24, 15, 3, 2); // 3
    // Hands
    clockGraphics.fillStyle(0x000000, 1);
    clockGraphics.fillRect(15, 10, 2, 7); // Hour hand
    clockGraphics.fillStyle(0x000000, 1);
    clockGraphics.fillRect(16, 8, 1, 9);  // Minute hand
    clockGraphics.fillStyle(0xff0000, 1);
    clockGraphics.fillRect(16, 12, 1, 8); // Second hand
    // Center dot
    clockGraphics.fillStyle(0x000000, 1);
    clockGraphics.fillCircle(16, 16, 2);
    clockGraphics.generateTexture('clock', 32, 32);
    clockGraphics.destroy();

    // Couch/Sofa
    const couchGraphics = this.make.graphics({ x: 0, y: 0 });
    // Base
    couchGraphics.fillStyle(0x4a2a6a, 1);
    couchGraphics.fillRect(0, 14, 48, 16);
    // Back cushion
    couchGraphics.fillStyle(0x5a3a7a, 1);
    couchGraphics.fillRect(2, 6, 44, 10);
    // Seat cushions
    couchGraphics.fillStyle(0x6a4a8a, 1);
    couchGraphics.fillRect(4, 16, 18, 10);
    couchGraphics.fillRect(26, 16, 18, 10);
    // Armrests
    couchGraphics.fillStyle(0x4a2a6a, 1);
    couchGraphics.fillRect(0, 10, 6, 20);
    couchGraphics.fillRect(42, 10, 6, 20);
    // Pillows
    couchGraphics.fillStyle(0xffcc44, 1);
    couchGraphics.fillRect(6, 10, 8, 8);
    couchGraphics.fillStyle(0x44ccff, 1);
    couchGraphics.fillRect(34, 10, 8, 8);
    // Legs
    couchGraphics.fillStyle(0x3a2a1a, 1);
    couchGraphics.fillRect(4, 28, 4, 4);
    couchGraphics.fillRect(40, 28, 4, 4);
    couchGraphics.generateTexture('couch', 48, 32);
    couchGraphics.destroy();

    // Trash can
    const trashGraphics = this.make.graphics({ x: 0, y: 0 });
    // Can body
    trashGraphics.fillStyle(0x555555, 1);
    trashGraphics.fillRect(8, 8, 16, 22);
    // Rim
    trashGraphics.fillStyle(0x666666, 1);
    trashGraphics.fillRect(6, 6, 20, 4);
    // Trash inside
    trashGraphics.fillStyle(0xaaaaaa, 1);
    trashGraphics.fillRect(10, 8, 12, 6);
    // Paper sticking out
    trashGraphics.fillStyle(0xffffff, 1);
    trashGraphics.fillRect(12, 4, 6, 6);
    trashGraphics.fillRect(16, 2, 4, 4);
    trashGraphics.generateTexture('trash', 32, 32);
    trashGraphics.destroy();

    // Wall art/poster
    const posterGraphics = this.make.graphics({ x: 0, y: 0 });
    // Frame
    posterGraphics.fillStyle(0x2a2a2a, 1);
    posterGraphics.fillRect(0, 0, 24, 32);
    // Canvas
    posterGraphics.fillStyle(0xfaf0e6, 1);
    posterGraphics.fillRect(2, 2, 20, 28);
    // Abstract art
    posterGraphics.fillStyle(0xff6b6b, 1);
    posterGraphics.fillCircle(12, 10, 6);
    posterGraphics.fillStyle(0x4ecdc4, 1);
    posterGraphics.fillTriangle(6, 28, 18, 28, 12, 16);
    posterGraphics.fillStyle(0xffe66d, 1);
    posterGraphics.fillRect(4, 12, 6, 6);
    posterGraphics.generateTexture('poster', 24, 32);
    posterGraphics.destroy();

    // Volleyball court
    const volleyballGraphics = this.make.graphics({ x: 0, y: 0 });
    // Sand court base
    volleyballGraphics.fillStyle(0xf4d03f, 1);
    volleyballGraphics.fillRect(0, 24, 64, 24);
    // Sky backdrop
    volleyballGraphics.fillStyle(0x87ceeb, 1);
    volleyballGraphics.fillRect(0, 0, 64, 26);
    // Court lines
    volleyballGraphics.fillStyle(0xffffff, 1);
    volleyballGraphics.fillRect(4, 24, 56, 2);
    // Net pole
    volleyballGraphics.fillStyle(0x666666, 1);
    volleyballGraphics.fillRect(30, 8, 4, 18);
    // Net
    volleyballGraphics.fillStyle(0xffffff, 1);
    volleyballGraphics.fillRect(31, 10, 2, 14);
    volleyballGraphics.fillStyle(0xcccccc, 1);
    volleyballGraphics.fillRect(28, 10, 8, 1);
    volleyballGraphics.fillRect(28, 14, 8, 1);
    volleyballGraphics.fillRect(28, 18, 8, 1);
    // Player 1 (left)
    volleyballGraphics.fillStyle(0x3498db, 1);
    volleyballGraphics.fillRect(12, 16, 8, 12);
    volleyballGraphics.fillStyle(0xffdbac, 1);
    volleyballGraphics.fillCircle(16, 13, 4);
    // Player 2 (right)
    volleyballGraphics.fillStyle(0xe74c3c, 1);
    volleyballGraphics.fillRect(44, 16, 8, 12);
    volleyballGraphics.fillStyle(0xffdbac, 1);
    volleyballGraphics.fillCircle(48, 13, 4);
    // Volleyball
    volleyballGraphics.fillStyle(0xffffff, 1);
    volleyballGraphics.fillCircle(32, 6, 5);
    volleyballGraphics.fillStyle(0xf39c12, 1);
    volleyballGraphics.fillCircle(32, 6, 3);
    volleyballGraphics.generateTexture('volleyball', 64, 48);
    volleyballGraphics.destroy();

    // McDonald's Nuggets Stand
    const mcdonaldsGraphics = this.make.graphics({ x: 0, y: 0 });
    // Stand base (red)
    mcdonaldsGraphics.fillStyle(0xda291c, 1);
    mcdonaldsGraphics.fillRect(4, 16, 40, 16);
    // Counter top
    mcdonaldsGraphics.fillStyle(0xffcc00, 1);
    mcdonaldsGraphics.fillRect(2, 14, 44, 4);
    // Golden arches (M logo)
    mcdonaldsGraphics.fillStyle(0xffc72c, 1);
    // Left arch
    mcdonaldsGraphics.fillRect(10, 2, 4, 12);
    mcdonaldsGraphics.fillRect(14, 4, 2, 4);
    mcdonaldsGraphics.fillRect(16, 6, 2, 6);
    // Right arch
    mcdonaldsGraphics.fillRect(22, 6, 2, 6);
    mcdonaldsGraphics.fillRect(24, 4, 2, 4);
    mcdonaldsGraphics.fillRect(26, 2, 4, 12);
    // Middle connection
    mcdonaldsGraphics.fillRect(18, 8, 4, 4);
    // Nugget box on counter
    mcdonaldsGraphics.fillStyle(0xff6b35, 1);
    mcdonaldsGraphics.fillRect(16, 10, 16, 8);
    // Nuggets inside
    mcdonaldsGraphics.fillStyle(0xdaa520, 1);
    mcdonaldsGraphics.fillCircle(20, 14, 3);
    mcdonaldsGraphics.fillCircle(26, 14, 3);
    mcdonaldsGraphics.fillCircle(23, 12, 2);
    // "NUGGETS" sign
    mcdonaldsGraphics.fillStyle(0xffffff, 1);
    mcdonaldsGraphics.fillRect(10, 20, 28, 8);
    mcdonaldsGraphics.fillStyle(0xda291c, 1);
    mcdonaldsGraphics.fillRect(12, 22, 24, 4);
    mcdonaldsGraphics.generateTexture('mcdonalds', 48, 32);
    mcdonaldsGraphics.destroy();

    // ===== ARCADE MACHINE =====
    const arcadeGraphics = this.make.graphics({ x: 0, y: 0 });
    // Cabinet body (dark grey)
    arcadeGraphics.fillStyle(0x2d2d2d, 1);
    arcadeGraphics.fillRect(8, 8, 32, 48);
    // Cabinet top (red marquee)
    arcadeGraphics.fillStyle(0xcc2222, 1);
    arcadeGraphics.fillRect(6, 4, 36, 8);
    // Marquee lights
    arcadeGraphics.fillStyle(0xffff00, 1);
    arcadeGraphics.fillCircle(10, 8, 2);
    arcadeGraphics.fillStyle(0xff00ff, 1);
    arcadeGraphics.fillCircle(38, 8, 2);
    // Screen bezel (black)
    arcadeGraphics.fillStyle(0x111111, 1);
    arcadeGraphics.fillRect(10, 12, 28, 22);
    // Screen (dark blue/black with glow effect)
    arcadeGraphics.fillStyle(0x001122, 1);
    arcadeGraphics.fillRect(12, 14, 24, 18);
    // Screen content - asteroids game preview
    arcadeGraphics.fillStyle(0x00ffff, 1);
    // Ship triangle
    arcadeGraphics.fillTriangle(24, 20, 20, 26, 28, 26);
    // Asteroids (small dots)
    arcadeGraphics.fillStyle(0x888888, 1);
    arcadeGraphics.fillCircle(16, 18, 3);
    arcadeGraphics.fillCircle(30, 24, 2);
    arcadeGraphics.fillCircle(18, 28, 2);
    // Bullets
    arcadeGraphics.fillStyle(0xffff00, 1);
    arcadeGraphics.fillRect(24, 17, 2, 2);
    // Control panel
    arcadeGraphics.fillStyle(0x3d3d3d, 1);
    arcadeGraphics.fillRect(8, 34, 32, 12);
    // Joystick
    arcadeGraphics.fillStyle(0x222222, 1);
    arcadeGraphics.fillCircle(16, 40, 5);
    arcadeGraphics.fillStyle(0xcc3333, 1);
    arcadeGraphics.fillCircle(16, 39, 3);
    // Fire button
    arcadeGraphics.fillStyle(0xcc2222, 1);
    arcadeGraphics.fillCircle(32, 40, 4);
    // Coin slot
    arcadeGraphics.fillStyle(0x1a1a1a, 1);
    arcadeGraphics.fillRect(18, 48, 12, 4);
    arcadeGraphics.fillStyle(0xffd700, 1);
    arcadeGraphics.fillRect(20, 49, 8, 2);
    // Cabinet base
    arcadeGraphics.fillStyle(0x1a1a1a, 1);
    arcadeGraphics.fillRect(10, 52, 28, 4);
    arcadeGraphics.generateTexture('arcade', 48, 56);
    arcadeGraphics.destroy();
  }

  private createHeroSprite(name: string, config: {
    skinColor: number;
    hairColor: number;
    hairStyle: string;
    helmetColor?: number;
    bodyColor: number;
    bodyStyle: string;
    accessory: string;
    accessoryColor: number;
  }): void {
    const g = this.make.graphics({ x: 0, y: 0 });
    
    // Base head shape (skin)
    g.fillStyle(config.skinColor, 1);
    g.fillRect(10, 6, 12, 12);
    
    // Eyes
    g.fillStyle(0x000000, 1);
    g.fillRect(12, 10, 2, 3);
    g.fillRect(18, 10, 2, 3);
    // Eye shine
    g.fillStyle(0xffffff, 1);
    g.fillRect(12, 10, 1, 1);
    g.fillRect(18, 10, 1, 1);
    
    // Hair/helmet styles
    switch (config.hairStyle) {
      case 'spiky':
        g.fillStyle(config.hairColor, 1);
        g.fillRect(8, 2, 16, 6);
        g.fillTriangle(8, 2, 12, 2, 10, -2);
        g.fillTriangle(14, 2, 18, 2, 16, -3);
        g.fillTriangle(20, 2, 24, 2, 22, -1);
        break;
      case 'helmet':
        g.fillStyle(config.helmetColor || config.hairColor, 1);
        g.fillRect(8, 0, 16, 10);
        g.fillStyle(0x666666, 1);
        g.fillRect(10, 8, 12, 2);
        // Visor
        g.fillStyle(0x88ccff, 1);
        g.fillRect(11, 4, 10, 4);
        break;
      case 'goggles':
        g.fillStyle(config.hairColor, 1);
        g.fillRect(10, 2, 12, 6);
        // Goggles
        g.fillStyle(0x444444, 1);
        g.fillRect(8, 6, 16, 4);
        g.fillStyle(0xffaa44, 1);
        g.fillRect(10, 7, 5, 2);
        g.fillRect(17, 7, 5, 2);
        break;
      case 'short':
        g.fillStyle(config.hairColor, 1);
        g.fillRect(10, 2, 12, 5);
        break;
      case 'long':
        g.fillStyle(config.hairColor, 1);
        g.fillRect(8, 2, 16, 8);
        g.fillRect(6, 8, 4, 12);
        g.fillRect(22, 8, 4, 12);
        break;
      case 'bun':
        g.fillStyle(config.hairColor, 1);
        g.fillRect(10, 3, 12, 5);
        g.fillCircle(16, 2, 4);
        break;
    }
    
    // Body styles
    switch (config.bodyStyle) {
      case 'robe':
        g.fillStyle(config.bodyColor, 1);
        g.fillRect(6, 18, 20, 14);
        g.fillTriangle(6, 32, 26, 32, 16, 18);
        // Robe trim
        g.fillStyle(0xffcc00, 1);
        g.fillRect(14, 18, 4, 14);
        break;
      case 'armor':
        g.fillStyle(config.bodyColor, 1);
        g.fillRect(6, 18, 20, 12);
        // Shoulder pads
        g.fillRect(2, 18, 6, 6);
        g.fillRect(24, 18, 6, 6);
        // Belt
        g.fillStyle(0x8b4513, 1);
        g.fillRect(6, 26, 20, 3);
        // Legs
        g.fillStyle(0x666666, 1);
        g.fillRect(8, 30, 6, 4);
        g.fillRect(18, 30, 6, 4);
        break;
      case 'pilot':
        g.fillStyle(config.bodyColor, 1);
        g.fillRect(8, 18, 16, 10);
        // Suit details
        g.fillStyle(0xffffff, 1);
        g.fillRect(10, 18, 2, 4);
        g.fillRect(20, 18, 2, 4);
        // Belt with buckle
        g.fillStyle(0x333333, 1);
        g.fillRect(8, 26, 16, 2);
        g.fillStyle(0xffcc00, 1);
        g.fillRect(14, 26, 4, 2);
        // Boots
        g.fillStyle(0x333333, 1);
        g.fillRect(8, 28, 6, 6);
        g.fillRect(18, 28, 6, 6);
        break;
      case 'coat':
        g.fillStyle(config.bodyColor, 1);
        g.fillRect(6, 18, 20, 14);
        // Coat lapels
        g.fillStyle(0xdddddd, 1);
        g.fillRect(10, 18, 4, 8);
        g.fillRect(18, 18, 4, 8);
        // Shirt
        g.fillStyle(0x88ccff, 1);
        g.fillRect(13, 18, 6, 6);
        // Pants
        g.fillStyle(0x2a2a4a, 1);
        g.fillRect(10, 30, 5, 4);
        g.fillRect(17, 30, 5, 4);
        break;
      case 'cloak':
        g.fillStyle(config.bodyColor, 1);
        g.fillRect(4, 16, 24, 16);
        // Hood shadow
        g.fillStyle(0x000000, 0.3);
        g.fillRect(8, 4, 16, 4);
        // Inner tunic
        g.fillStyle(0x4a3a5a, 1);
        g.fillRect(12, 20, 8, 10);
        break;
      case 'vest':
        // Shirt
        g.fillStyle(0xffffff, 1);
        g.fillRect(8, 18, 16, 10);
        // Vest
        g.fillStyle(config.bodyColor, 1);
        g.fillRect(6, 18, 6, 12);
        g.fillRect(20, 18, 6, 12);
        // Bow tie
        g.fillStyle(0xaa0000, 1);
        g.fillRect(13, 18, 6, 3);
        // Pants
        g.fillStyle(0x1a1a1a, 1);
        g.fillRect(10, 28, 5, 6);
        g.fillRect(17, 28, 5, 6);
        break;
    }
    
    // Accessories
    switch (config.accessory) {
      case 'staff':
        g.fillStyle(0x8b4513, 1);
        g.fillRect(26, 4, 3, 28);
        g.fillStyle(config.accessoryColor, 1);
        g.fillCircle(28, 4, 4);
        break;
      case 'shield':
        g.fillStyle(config.accessoryColor, 1);
        g.fillRect(0, 18, 6, 12);
        g.fillStyle(0xffffff, 1);
        g.fillRect(1, 22, 4, 4);
        break;
      case 'rocket':
        g.fillStyle(config.accessoryColor, 1);
        g.fillRect(26, 20, 5, 10);
        g.fillTriangle(26, 20, 31, 20, 28, 14);
        // Flames
        g.fillStyle(0xff4400, 1);
        g.fillRect(26, 30, 5, 3);
        g.fillStyle(0xffff00, 1);
        g.fillRect(27, 31, 3, 2);
        break;
      case 'stethoscope':
        g.fillStyle(config.accessoryColor, 1);
        g.fillCircle(16, 28, 3);
        g.fillStyle(0x333333, 1);
        g.fillRect(14, 20, 2, 6);
        g.fillRect(16, 20, 2, 6);
        break;
      case 'binoculars':
        g.fillStyle(0x333333, 1);
        g.fillRect(0, 14, 5, 6);
        g.fillRect(2, 12, 6, 4);
        g.fillStyle(config.accessoryColor, 1);
        g.fillCircle(2, 17, 2);
        break;
      case 'coins':
        g.fillStyle(config.accessoryColor, 1);
        g.fillCircle(4, 26, 4);
        g.fillCircle(6, 22, 3);
        g.fillCircle(2, 30, 3);
        g.fillStyle(0xaa8800, 1);
        g.fillRect(3, 25, 2, 2);
        break;
      case 'meta':
        // Recursive/inception symbol - a mini screen showing the game
        g.fillStyle(0x222222, 1);
        g.fillRect(24, 14, 8, 10);
        g.fillStyle(config.accessoryColor, 1);
        g.fillRect(25, 15, 6, 8);
        // Tiny recursive figure inside
        g.fillStyle(0xff00ff, 1);
        g.fillRect(27, 17, 2, 4);
        // Sparkles around (meta magic)
        g.fillStyle(0xffaaff, 1);
        g.fillRect(22, 12, 2, 2);
        g.fillRect(30, 10, 2, 2);
        g.fillRect(26, 8, 2, 2);
        break;
      case 'book':
        // Open book held on left side
        g.fillStyle(0x5a3010, 1);  // spine
        g.fillRect(0, 18, 4, 14);
        g.fillStyle(config.accessoryColor, 1);  // cover
        g.fillRect(1, 19, 7, 12);
        g.fillStyle(0xffffff, 1);  // pages
        g.fillRect(2, 20, 5, 10);
        g.fillStyle(0xaaaaaa, 1);  // page lines
        g.fillRect(3, 22, 3, 1);
        g.fillRect(3, 24, 3, 1);
        g.fillRect(3, 26, 3, 1);
        break;
      case 'blueprint':
        // Rolled blueprint scroll on right side
        g.fillStyle(0x2244aa, 1);  // blueprint blue paper
        g.fillRect(24, 12, 7, 18);
        g.fillStyle(config.accessoryColor, 1);  // grid lines
        g.fillRect(25, 15, 5, 1);
        g.fillRect(25, 18, 5, 1);
        g.fillRect(25, 21, 5, 1);
        g.fillRect(27, 14, 1, 10);
        // Scroll ends (rolled paper)
        g.fillStyle(0xddddcc, 1);
        g.fillRect(23, 11, 9, 3);
        g.fillRect(23, 27, 9, 3);
        // Sparkle (architect magic)
        g.fillStyle(0xaaaaff, 1);
        g.fillRect(20, 8, 2, 2);
        g.fillRect(22, 10, 2, 2);
        break;
    }
    
    g.generateTexture(name, 32, 34);
    g.destroy();
  }

  create(): void {
    this.scene.start('OfficeScene');
  }
}
