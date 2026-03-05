// Office state management
// Adapted from pixel-agents - with player character support

import { TileType, TILE_SIZE, CharacterState, Direction } from '../types';
import type { Character, Seat, FurnitureInstance, TileType as TileTypeVal, SpriteData } from '../types';
import {
  PALETTE_COUNT,
  HUE_SHIFT_MIN_DEG,
  HUE_SHIFT_RANGE_DEG,
  WAITING_BUBBLE_DURATION_SEC,
  WALK_SPEED_PX_PER_SEC,
  WALK_FRAME_DURATION_SEC,
  TYPE_FRAME_DURATION_SEC,
  WANDER_PAUSE_MIN_SEC,
  WANDER_PAUSE_MAX_SEC,
  WANDER_MOVES_BEFORE_REST_MIN,
  WANDER_MOVES_BEFORE_REST_MAX,
} from '../constants';

// Import layout configuration from the layout folder (editable by Alice)
import { 
  createDefaultLayout, 
  type OfficeLayout, 
  type PlacedFurniture,
  getFurnitureSprite,
  getFurnitureSize,
} from '../layout';

// ── Layout Helper Functions ────────────────────────────────────────────

function layoutToTileMap(layout: OfficeLayout): TileTypeVal[][] {
  const map: TileTypeVal[][] = [];
  for (let r = 0; r < layout.rows; r++) {
    const row: TileTypeVal[] = [];
    for (let c = 0; c < layout.cols; c++) {
      row.push(layout.tiles[r * layout.cols + c]);
    }
    map.push(row);
  }
  return map;
}

function layoutToFurnitureInstances(furniture: PlacedFurniture[]): FurnitureInstance[] {
  return furniture.map(f => {
    const sprite = getFurnitureSprite(f.type);
    const size = getFurnitureSize(f.type);
    return {
      sprite,
      x: f.col * TILE_SIZE,
      y: f.row * TILE_SIZE,
      zY: (f.row + size.h) * TILE_SIZE,
    };
  });
}

function layoutToSeats(furniture: PlacedFurniture[]): Map<string, Seat> {
  const seats = new Map<string, Seat>();
  for (const f of furniture) {
    if (f.type === 'chair') {
      seats.set(f.uid, {
        uid: f.uid,
        seatCol: f.col,
        seatRow: f.row,
        facingDir: Direction.UP, // Chairs face up toward desks
        assigned: false,
      });
    }
  }
  return seats;
}

// ── Character creation ────────────────────────────────────────

let nextPaletteIndex = 0;

function createCharacter(id: number, agentId: string, col: number, row: number, isPlayer: boolean = false): Character {
  const palette = isPlayer ? -1 : nextPaletteIndex % PALETTE_COUNT;
  if (!isPlayer) nextPaletteIndex++;
  
  const hueShift = (!isPlayer && nextPaletteIndex > PALETTE_COUNT)
    ? HUE_SHIFT_MIN_DEG + Math.random() * HUE_SHIFT_RANGE_DEG
    : 0;
  
  return {
    id,
    agentId,
    state: CharacterState.IDLE,
    dir: Direction.UP,
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    currentToolStatus: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    wanderTimer: WANDER_PAUSE_MIN_SEC + Math.random() * (WANDER_PAUSE_MAX_SEC - WANDER_PAUSE_MIN_SEC),
    wanderCount: 0,
    wanderLimit: WANDER_MOVES_BEFORE_REST_MIN + Math.floor(Math.random() * (WANDER_MOVES_BEFORE_REST_MAX - WANDER_MOVES_BEFORE_REST_MIN)),
    isActive: false,
    seatId: null,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: Array.from({ length: 16 }, () => Math.random()),
    folderName: undefined,
  };
}

// ── Office State ────────────────────────────────────────────────

export class OfficeState {
  layout: OfficeLayout;
  tileMap: TileTypeVal[][];
  seats: Map<string, Seat>;
  furniture: FurnitureInstance[];
  characters: Map<string, Character> = new Map();
  selectedAgentId: string | null = null;
  hoveredAgentId: string | null = null;
  
  // Player character
  player: Character | null = null;
  playerInOffice: boolean = false;
  
  // Entrance position
  entranceCol: number = 10;
  entranceRow: number = 13;
  
  private nextCharId = 1;
  
  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout();
    this.tileMap = layoutToTileMap(this.layout);
    this.seats = layoutToSeats(this.layout.furniture);
    this.furniture = layoutToFurnitureInstances(this.layout.furniture);
    
    // Set entrance based on layout
    this.entranceRow = this.layout.rows;
  }
  
  getLayout(): OfficeLayout {
    return this.layout;
  }
  
  // ── Player management ────────────────────────────────────────
  
  spawnPlayer(): void {
    if (this.player) return; // Already spawned
    
    // Spawn player just below entrance, they'll walk in
    this.player = createCharacter(
      0, // ID 0 for player
      '__player__',
      this.entranceCol,
      this.entranceRow, // Below the office
      true // isPlayer
    );
    this.player.dir = Direction.UP;
    this.playerInOffice = true;
    
    // Move player up into the office
    this.player.y = (this.layout.rows - 2) * TILE_SIZE + TILE_SIZE / 2;
    this.player.tileRow = this.layout.rows - 2;
  }
  
  removePlayer(): void {
    this.player = null;
    this.playerInOffice = false;
  }
  
  movePlayer(dx: number, dy: number, speedMult: number = 1.0): void {
    if (!this.player) return;
    
    const speed = WALK_SPEED_PX_PER_SEC / 60 * speedMult; // Per frame at 60fps
    const newX = this.player.x + dx * speed * 3;
    const newY = this.player.y + dy * speed * 3;
    
    // Calculate tile position
    const tileCol = Math.floor(newX / TILE_SIZE);
    const tileRow = Math.floor(newY / TILE_SIZE);
    
    // Check bounds and walkability
    if (tileCol >= 1 && tileCol < this.layout.cols - 1 &&
        tileRow >= 1 && tileRow < this.layout.rows - 1) {
      const tile = this.tileMap[tileRow]?.[tileCol];
      if (tile !== TileType.WALL && tile !== TileType.VOID) {
        this.player.x = newX;
        this.player.y = newY;
        this.player.tileCol = tileCol;
        this.player.tileRow = tileRow;
        
        // Update direction
        if (Math.abs(dx) > Math.abs(dy)) {
          this.player.dir = dx > 0 ? Direction.RIGHT : Direction.LEFT;
        } else if (dy !== 0) {
          this.player.dir = dy > 0 ? Direction.DOWN : Direction.UP;
        }
        
        // Set walking state
        this.player.state = CharacterState.WALK;
      }
    }
  }
  
  stopPlayer(): void {
    if (this.player) {
      this.player.state = CharacterState.IDLE;
    }
  }
  
  // ── Agent management ────────────────────────────────────────
  
  addAgent(agentId: string, col?: number, row?: number): Character {
    // Use provided position or find a free seat
    let spawnCol = col ?? Math.floor(this.layout.cols / 2);
    let spawnRow = row ?? Math.floor(this.layout.rows / 2) - 2;
    let assignedSeat: string | null = null;
    
    // If position provided, try to find matching seat
    if (col !== undefined && row !== undefined) {
      for (const [uid, seat] of this.seats) {
        if (seat.seatCol === col && seat.seatRow === row && !seat.assigned) {
          seat.assigned = true;
          assignedSeat = uid;
          break;
        }
      }
    } else {
      // Auto-assign first free seat
      for (const [uid, seat] of this.seats) {
        if (!seat.assigned) {
          spawnCol = seat.seatCol;
          spawnRow = seat.seatRow;
          seat.assigned = true;
          assignedSeat = uid;
          break;
        }
      }
    }
    
    const char = createCharacter(this.nextCharId++, agentId, spawnCol, spawnRow);
    char.seatId = assignedSeat;
    if (assignedSeat) {
      const seat = this.seats.get(assignedSeat)!;
      char.dir = seat.facingDir;
    }
    
    this.characters.set(agentId, char);
    return char;
  }
  
  removeAgent(agentId: string): void {
    const char = this.characters.get(agentId);
    if (char && char.seatId) {
      const seat = this.seats.get(char.seatId);
      if (seat) seat.assigned = false;
    }
    this.characters.delete(agentId);
  }
  
  getCharacter(agentId: string): Character | undefined {
    return this.characters.get(agentId);
  }
  
  // ── Activity updates ────────────────────────────────────────
  
  setAgentActive(agentId: string, toolName: string | null, status: string | null): void {
    const char = this.characters.get(agentId);
    if (!char) return;
    
    char.isActive = toolName !== null;
    char.currentTool = toolName;
    char.currentToolStatus = status;
    
    if (toolName) {
      if (char.seatId) {
        char.state = CharacterState.TYPE;
      }
      char.bubbleType = null;
    }
  }
  
  setAgentWaiting(agentId: string): void {
    const char = this.characters.get(agentId);
    if (!char) return;
    
    char.isActive = false;
    char.currentTool = null;
    char.currentToolStatus = null;
    char.state = CharacterState.IDLE;
    char.bubbleType = 'waiting';
    char.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
  }
  
  clearAgentBubble(agentId: string): void {
    const char = this.characters.get(agentId);
    if (!char) return;
    char.bubbleType = null;
  }
  
  // ── Update loop ────────────────────────────────────────────
  
  update(dt: number): void {
    // Update agents
    for (const char of this.characters.values()) {
      this.updateCharacter(char, dt);
    }
    
    // Update player
    if (this.player) {
      this.updateCharacter(this.player, dt);
    }
  }
  
  private updateCharacter(char: Character, dt: number): void {
    // Update animation frame
    char.frameTimer += dt;
    
    if (char.state === CharacterState.TYPE) {
      if (char.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        char.frameTimer = 0;
        char.frame = (char.frame + 1) % 2;
      }
    } else if (char.state === CharacterState.WALK) {
      if (char.frameTimer >= WALK_FRAME_DURATION_SEC) {
        char.frameTimer = 0;
        char.frame = (char.frame + 1) % 4;
      }
    }
    
    // Update bubble timer
    if (char.bubbleType === 'waiting' && char.bubbleTimer > 0) {
      char.bubbleTimer -= dt;
      if (char.bubbleTimer <= 0) {
        char.bubbleType = null;
      }
    }
    
    // Skip seat logic for player
    if (char.agentId === '__player__') return;
    
    // If not active and has a seat, ensure sitting
    if (!char.isActive && char.seatId && char.state !== CharacterState.TYPE) {
      const seat = this.seats.get(char.seatId);
      if (seat) {
        char.tileCol = seat.seatCol;
        char.tileRow = seat.seatRow;
        char.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
        char.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
        char.dir = seat.facingDir;
        char.state = CharacterState.IDLE;
      }
    }
  }
  
  // ── Check entrance click ────────────────────────────────────
  
  isEntranceClick(worldX: number, worldY: number): boolean {
    // Find entrance-rug in furniture to get actual position
    const rugFurniture = this.layout.furniture.find(f => f.type === 'entrance_rug');
    if (!rugFurniture) return false;
    
    const rugLeft = rugFurniture.col * TILE_SIZE;
    const rugRight = (rugFurniture.col + 2) * TILE_SIZE; // 2 tiles wide
    const rugTop = rugFurniture.row * TILE_SIZE;
    const rugBottom = (rugFurniture.row + 1) * TILE_SIZE;
    
    return worldX >= rugLeft && worldX <= rugRight && 
           worldY >= rugTop && worldY <= rugBottom;
  }
}
