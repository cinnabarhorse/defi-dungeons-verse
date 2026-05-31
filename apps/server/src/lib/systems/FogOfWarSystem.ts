import type {
  PlayerSchema,
  EnemySchema,
  NPCSchema,
  ProjectileSchema,
  EntitySchema,
} from '../../schemas';

interface FogUpdateInput {
  players: Iterable<PlayerSchema>;
  enemies: Iterable<EnemySchema>;
  npcs: Iterable<NPCSchema>;
  projectiles: Iterable<ProjectileSchema>;
  entities: Iterable<EntitySchema>;
  visionRadiusTiles?: number;
}

export interface FogUpdateResult {
  newlyDiscoveredTiles: Array<{ x: number; y: number }>;
  visibleEnemyIds: Set<string>;
  visibleNpcIds: Set<string>;
  visibleProjectileIds: Set<string>;
  newlyDiscoveredEntityIds: string[];
}

export class FogOfWarSystem {
  private readonly tileSize: number;
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private visionRadiusTiles: number;

  private discoveredTiles: Set<number> = new Set();
  private discoveredEntityIds: Set<string> = new Set();

  constructor(options: {
    tileSize: number;
    mapWidth: number;
    mapHeight: number;
    visionRadiusTiles: number;
  }) {
    this.tileSize = options.tileSize;
    this.mapWidth = options.mapWidth;
    this.mapHeight = options.mapHeight;
    this.visionRadiusTiles = options.visionRadiusTiles;
  }

  reset(): void {
    this.discoveredTiles.clear();
    this.discoveredEntityIds.clear();
  }

  setVisionRadiusTiles(radius: number): void {
    if (Number.isFinite(radius) && radius > 0) {
      this.visionRadiusTiles = radius;
    }
  }

  getVisionRadiusTiles(): number {
    return this.visionRadiusTiles;
  }

  getAllDiscoveredTiles(): Array<{ x: number; y: number }> {
    const tiles: Array<{ x: number; y: number }> = [];
    this.discoveredTiles.forEach((key) => {
      tiles.push(this.decodeTileKey(key));
    });
    return tiles;
  }

  getDiscoveredEntityIds(): Set<string> {
    return this.discoveredEntityIds;
  }

  update(input: FogUpdateInput): FogUpdateResult {
    const players = Array.from(input.players);

    if (players.length === 0) {
      return {
        newlyDiscoveredTiles: [],
        visibleEnemyIds: new Set(),
        visibleNpcIds: new Set(),
        visibleProjectileIds: new Set(),
        newlyDiscoveredEntityIds: [],
      };
    }

    const radiusTiles = input.visionRadiusTiles ?? this.visionRadiusTiles;

    // Rollback: Only compute newly discovered tiles; do not gate visibility server-side.
    const newlyDiscoveredTiles = this.revealForPlayers(players, radiusTiles);

    return {
      newlyDiscoveredTiles,
      visibleEnemyIds: new Set(),
      visibleNpcIds: new Set(),
      visibleProjectileIds: new Set(),
      newlyDiscoveredEntityIds: [],
    };
  }

  private revealForPlayers(
    players: PlayerSchema[],
    radiusTiles: number
  ): Array<{ x: number; y: number }> {
    const newlyDiscovered: Array<{ x: number; y: number }> = [];

    for (const player of players) {
      const playerRadius = Math.max(
        1,
        Math.floor((player as any)._visionRadiusTiles || radiusTiles)
      );
      const tileX = Math.floor(player.x / this.tileSize);
      const tileY = Math.floor(player.y / this.tileSize);
      this.revealCircle(tileX, tileY, playerRadius, newlyDiscovered);
    }

    return newlyDiscovered;
  }

  private revealCircle(
    centerX: number,
    centerY: number,
    radius: number,
    accumulator: Array<{ x: number; y: number }>
  ): void {
    const radiusSq = radius * radius;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const distSq = dx * dx + dy * dy;
        if (distSq > radiusSq) {
          continue;
        }

        const tileX = centerX + dx;
        const tileY = centerY + dy;
        if (!this.isInBounds(tileX, tileY)) {
          continue;
        }

        const key = this.encodeTileKey(tileX, tileY);
        if (!this.discoveredTiles.has(key)) {
          this.discoveredTiles.add(key);
          accumulator.push({ x: tileX, y: tileY });
        }
      }
    }
  }

  private isInBounds(tileX: number, tileY: number): boolean {
    return (
      tileX >= 0 &&
      tileY >= 0 &&
      tileX < this.mapWidth &&
      tileY < this.mapHeight
    );
  }

  private encodeTileKey(tileX: number, tileY: number): number {
    return tileY * this.mapWidth + tileX;
  }

  private decodeTileKey(key: number): { x: number; y: number } {
    const x = key % this.mapWidth;
    const y = Math.floor(key / this.mapWidth);
    return { x, y };
  }
}
