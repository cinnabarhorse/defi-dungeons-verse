import { GAME_CONFIG, FLOOR_TILEMAPS_ENABLED } from '../../lib/constants';
import { debugLog } from '../../lib/debug';
import {
  FLOOR_TILESET,
  getTileIndex,
  getMultiTileIndices,
} from '../../data/floor-tileset';

type PreparedChunkGrid = {
  wTiles: number;
  hTiles: number;
  data: Int32Array;
};

/**
 * EnvironmentSystem - Chunk-based world rendering
 *
 * This system handles client-side rendering of chunk-based environments:
 * - Floor tiles: Rendered directly from chunk data (excluded from server entities)
 * - World boundaries: Simple border generation
 * - Entity tracking: Tracks server-generated trees, stones, etc.
 *
 * Note: Trees, stones, and special objects are now server entities,
 * this system only handles their client-side tracking and floor rendering.
 */
export class EnvironmentSystem {
  private scene: any;

  // Environment state - tracks server entities for cleanup
  public treeEntities: { [treeId: string]: any } = {};
  public treePositions: Array<{ x: number; y: number }> = [];
  public stoneEntities: { [stoneId: string]: any } = {};
  public stonePositions: Array<{ x: number; y: number }> = [];

  private chunkLayout: Array<{ x: number; y: number; chunkName: string }> = [];
  private layoutMap: Map<string, { x: number; y: number; chunkName: string }> =
    new Map();
  private chunkMap: Map<string, any> = new Map();
  private cellSizePx: { w: number; h: number } | null = null;
  private visibleCells: Set<string> = new Set();
  private preparedChunkGrids: Map<string, PreparedChunkGrid> = new Map();
  private activeTilemaps: Map<
    string,
    { map: Phaser.Tilemaps.Tilemap; layer: Phaser.Tilemaps.TilemapLayer }
  > = new Map();
  private backgroundTilemap: Phaser.Tilemaps.Tilemap | null = null;
  private backgroundLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private chunkBounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null = null;
  private lastCameraWindowKey: string | null = null;

  private readonly FLOOR_GRID_SIZE = GAME_CONFIG.TILE_SIZE;

  constructor(scene: any) {
    this.scene = scene;
  }

  // Road creation removed - roads are now generated server-side via MapGenerator
  // and rendered as entities through room.state.entities.onAdd

  createWorldBoundaries(worldWidth: number, worldHeight: number) {
    debugLog('EnvironmentSystem: 🏗️ Creating world boundaries...');

    const borderWidth = 4;
    const borderColor = 0x444444; // Dark gray

    // Top border
    this.scene.add
      .rectangle(
        worldWidth / 2,
        borderWidth / 2,
        worldWidth,
        borderWidth,
        borderColor
      )
      .setDepth(-2);

    // Bottom border
    this.scene.add
      .rectangle(
        worldWidth / 2,
        worldHeight - borderWidth / 2,
        worldWidth,
        borderWidth,
        borderColor
      )
      .setDepth(-2);

    // Left border
    this.scene.add
      .rectangle(
        borderWidth / 2,
        worldHeight / 2,
        borderWidth,
        worldHeight,
        borderColor
      )
      .setDepth(-2);

    // Right border
    this.scene.add
      .rectangle(
        worldWidth - borderWidth / 2,
        worldHeight / 2,
        borderWidth,
        worldHeight,
        borderColor
      )
      .setDepth(-2);

    debugLog('✅ World boundaries created successfully');
  }

  // Initialize the complete environment
  initializeEnvironment(
    worldWidth?: number,
    worldHeight?: number,
    seed?: number
  ) {
    const width = worldWidth || GAME_CONFIG?.WORLD_WIDTH || 3840;
    const height = worldHeight || GAME_CONFIG?.WORLD_HEIGHT || 2160;

    debugLog('EnvironmentSystem: 🌍 Initializing complete environment...');

    // Reset any previous background before creating a new one
    this.destroyBackground();

    // Create a full-world background tilemap behind everything else to
    // replace Phaser's default gray camera background.
    this.createBackgroundLayer(width, height);

    // Create world boundaries
    this.createWorldBoundaries(width, height);
    // Road and terrain are now generated server-side via MapGenerator and rendered via entities/chunks

    debugLog('✅ Environment initialization complete');
  }

  private createBackgroundLayer(worldWidth: number, worldHeight: number) {
    const tileSize = FLOOR_TILESET.tileSize ?? this.FLOOR_GRID_SIZE;

    // Ensure the tileset image is loaded (done in GameScene.preload)
    if (!this.scene.textures?.exists(FLOOR_TILESET.imageKey)) {
      console.warn(
        `⚠️ Floor tileset "${FLOOR_TILESET.imageKey}" not loaded; skipping background layer.`
      );
      return;
    }

    const tilesWide = Math.ceil(worldWidth / tileSize);
    const tilesHigh = Math.ceil(worldHeight / tileSize);

    const map = this.scene.make.tilemap({
      tileWidth: tileSize,
      tileHeight: tileSize,
      width: tilesWide,
      height: tilesHigh,
    });
    if (!map) return;

    const tileset = map.addTilesetImage(
      FLOOR_TILESET.imageKey,
      FLOOR_TILESET.imageKey,
      tileSize,
      tileSize,
      0,
      0
    );
    if (!tileset) {
      map.destroy();
      return;
    }

    const layer = map.createBlankLayer('background', tileset, 0, 0);
    if (!layer) {
      map.destroy();
      return;
    }

    // Choose a floor tile by ID. Prefer a single-tile index if available,
    // otherwise fall back to the top-left of a 2x2 multi-tile definition.
    const single = getTileIndex('dungeons_floor_10');
    const mt =
      typeof single !== 'number'
        ? getMultiTileIndices('dungeons_floor_10')
        : undefined;
    const tileIndex = typeof single === 'number' ? single : mt ? mt.tl : 0;

    // Fill entire world area with the selected tile
    layer.setOrigin(0, 0);
    layer.setDepth(-5);
    layer.setCullPadding(1, 1);
    layer.fill(tileIndex, 0, 0, tilesWide, tilesHigh);

    this.backgroundTilemap = map;
    this.backgroundLayer = layer;
  }

  private destroyBackground() {
    if (this.backgroundLayer) {
      this.backgroundLayer.destroy();
      this.backgroundLayer = null;
    }
    if (this.backgroundTilemap) {
      this.backgroundTilemap.destroy();
      this.backgroundTilemap = null;
    }
  }

  renderChunkFloors(
    chunks: any[],
    chunkLayout: Array<{ x: number; y: number; chunkName: string }>
  ) {
    debugLog('EnvironmentSystem: 🏠 Initializing chunk floor data...');

    this.destroyFloors();

    if (!chunks || chunks.length === 0) {
      console.warn(
        '⚠️ No chunks provided for floor rendering (cleared previous floors)'
      );
      return;
    }

    if (!chunkLayout || chunkLayout.length === 0) {
      console.warn(
        '⚠️ No chunk layout provided for floor rendering (cleared previous floors)'
      );
      return;
    }

    const firstChunk = chunks[0];
    if (!firstChunk) {
      console.warn('⚠️ Unable to derive chunk size from first chunk');
      return;
    }

    const baseWidthTiles = this.computeTileDimension(firstChunk.width);
    const baseHeightTiles = this.computeTileDimension(firstChunk.height);
    const chunkWidthPixels = baseWidthTiles * this.FLOOR_GRID_SIZE;
    const chunkHeightPixels = baseHeightTiles * this.FLOOR_GRID_SIZE;

    this.chunkMap = new Map();
    chunks.forEach((chunk) => {
      this.chunkMap.set(chunk.name, chunk);
    });

    if (FLOOR_TILEMAPS_ENABLED) {
      this.prepareChunkGrids(chunks, baseWidthTiles, baseHeightTiles);
    } else {
      this.preparedChunkGrids.clear();
    }

    this.chunkLayout = chunkLayout.slice();
    this.layoutMap.clear();
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    this.chunkLayout.forEach((layout) => {
      const key = this.getCellKey(layout.x, layout.y);
      this.layoutMap.set(key, layout);
      minX = Math.min(minX, layout.x);
      maxX = Math.max(maxX, layout.x);
      minY = Math.min(minY, layout.y);
      maxY = Math.max(maxY, layout.y);
    });

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      console.warn('⚠️ Unable to determine chunk bounds from layout');
      this.chunkBounds = null;
    } else {
      this.chunkBounds = { minX, maxX, minY, maxY };
    }

    this.cellSizePx = { w: chunkWidthPixels, h: chunkHeightPixels };
    this.visibleCells.clear();
    this.lastCameraWindowKey = null;

    debugLog(
      `🎯 Prepared ${chunkLayout.length} chunk cells for floor virtualization (${chunkWidthPixels}×${chunkHeightPixels}px)`
    );
  }

  private prepareChunkGrids(
    chunks: any[],
    fallbackWidthTiles: number,
    fallbackHeightTiles: number
  ) {
    this.preparedChunkGrids.clear();

    chunks.forEach((chunk) => {
      if (!chunk || typeof chunk.name !== 'string') {
        return;
      }

      const floorAssets = Array.isArray(chunk.assets)
        ? chunk.assets.filter((asset: any) => asset?.category === 'floors')
        : [];

      if (floorAssets.length === 0) {
        return;
      }

      const baseWidth = this.computeTileDimension(
        chunk.width,
        fallbackWidthTiles
      );
      const baseHeight = this.computeTileDimension(
        chunk.height,
        fallbackHeightTiles
      );

      const grid = this.buildChunkGrid(
        chunk.name,
        floorAssets,
        baseWidth,
        baseHeight
      );
      if (grid) {
        this.preparedChunkGrids.set(chunk.name, grid);
      }
    });
  }

  private buildChunkGrid(
    chunkName: string,
    floorAssets: any[],
    baseWidthTiles: number,
    baseHeightTiles: number
  ): PreparedChunkGrid | null {
    type Placement =
      | {
          type: 'single';
          assetId: string;
          tileX: number;
          tileY: number;
          index: number;
        }
      | {
          type: 'multi';
          assetId: string;
          tileX: number;
          tileY: number;
          indices: {
            topLeft: number;
            topRight: number;
            bottomLeft: number;
            bottomRight: number;
          };
        };

    const placements: Placement[] = [];
    const missingAssets = new Set<string>();
    const invalidCoords: string[] = [];

    // Keep chunk grid fixed to the declared base size; normalize any
    // out-of-range floor coordinates into local cell space. This avoids
    // creating oversized tilemaps when authoring coordinates are absolute
    // or exceed the nominal chunk dimensions.
    const widthCap = Math.max(1, baseWidthTiles);
    const heightCap = Math.max(1, baseHeightTiles);
    let requiredWidth = widthCap;
    let requiredHeight = heightCap;

    for (const asset of floorAssets) {
      if (!asset || typeof asset.assetId !== 'string') {
        continue;
      }

      const rawX = this.toTileCoordinate(asset.x);
      const rawY = this.toTileCoordinate(asset.y);

      if (rawX === null || rawY === null) {
        invalidCoords.push(asset.assetId);
        continue;
      }

      // Normalize authoring coordinates to local chunk space
      const tileX = ((rawX % widthCap) + widthCap) % widthCap;
      const tileY = ((rawY % heightCap) + heightCap) % heightCap;

      // Prefer generic grid indices (NxN), fall back to quad mapping
      const gridIdx = (() => {
        const gridEntry = (FLOOR_TILESET as any).gridTile?.[asset.assetId];
        if (
          gridEntry &&
          typeof gridEntry.widthTiles === 'number' &&
          typeof gridEntry.heightTiles === 'number' &&
          Array.isArray(gridEntry.indices)
        ) {
          return {
            w: gridEntry.widthTiles,
            h: gridEntry.heightTiles,
            indices: gridEntry.indices as number[],
          };
        }

        const mt = getMultiTileIndices(asset.assetId);
        if (mt) {
          return { w: 2, h: 2, indices: [mt.tl, mt.tr, mt.bl, mt.br] };
        }
        return undefined;
      })();
      if (gridIdx && gridIdx.w >= 1 && gridIdx.h >= 1) {
        const maxOriginX = Math.max(0, widthCap - gridIdx.w);
        const maxOriginY = Math.max(0, heightCap - gridIdx.h);
        const clampedX = Math.min(tileX, maxOriginX);
        const clampedY = Math.min(tileY, maxOriginY);

        if (
          gridIdx.w === 2 &&
          gridIdx.h === 2 &&
          gridIdx.indices.length === 4
        ) {
          placements.push({
            type: 'multi',
            assetId: asset.assetId,
            tileX: clampedX,
            tileY: clampedY,
            indices: {
              topLeft: gridIdx.indices[0],
              topRight: gridIdx.indices[1],
              bottomLeft: gridIdx.indices[2],
              bottomRight: gridIdx.indices[3],
            },
          });
        } else if (
          gridIdx.w === 1 &&
          gridIdx.h === 1 &&
          gridIdx.indices.length === 1
        ) {
          const tileIndex = gridIdx.indices[0];
          placements.push({
            type: 'single',
            assetId: asset.assetId,
            tileX: clampedX,
            tileY: clampedY,
            index: tileIndex,
          });
        } else {
          // Write NxN in row-major order
          for (let dy = 0; dy < gridIdx.h; dy++) {
            for (let dx = 0; dx < gridIdx.w; dx++) {
              const index = gridIdx.indices[dy * gridIdx.w + dx];
              if (typeof index !== 'number') continue;
              placements.push({
                type: 'single',
                assetId: asset.assetId,
                tileX: clampedX + dx,
                tileY: clampedY + dy,
                index,
              });
            }
          }
        }
        continue;
      }

      const tileIndex = getTileIndex(asset.assetId);
      if (typeof tileIndex !== 'number') {
        missingAssets.add(asset.assetId);
        continue;
      }

      // Grid size remains fixed to the base dimensions
      placements.push({
        type: 'single',
        assetId: asset.assetId,
        tileX,
        tileY,
        index: tileIndex,
      });
    }

    if (placements.length === 0) {
      if (missingAssets.size > 0 || invalidCoords.length > 0) {
        console.warn(
          `⚠️ No valid floor tiles for chunk "${chunkName}" (missing: ${missingAssets.size}, invalid: ${invalidCoords.length})`
        );
      }
      return null;
    }

    const width = Math.max(1, requiredWidth);
    const height = Math.max(1, requiredHeight);
    const data = new Int32Array(width * height).fill(-1);
    const outOfBounds: string[] = [];

    const writeTile = (
      assetId: string,
      tx: number,
      ty: number,
      tileIndex: number
    ) => {
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) {
        outOfBounds.push(`${assetId}@${tx},${ty}`);
        return;
      }
      data[ty * width + tx] = tileIndex;
    };

    placements.forEach((placement) => {
      if (placement.type === 'single') {
        writeTile(
          placement.assetId,
          placement.tileX,
          placement.tileY,
          placement.index
        );
        return;
      }

      const { indices } = placement;
      writeTile(
        placement.assetId,
        placement.tileX,
        placement.tileY,
        indices.topLeft
      );
      writeTile(
        placement.assetId,
        placement.tileX + 1,
        placement.tileY,
        indices.topRight
      );
      writeTile(
        placement.assetId,
        placement.tileX,
        placement.tileY + 1,
        indices.bottomLeft
      );
      writeTile(
        placement.assetId,
        placement.tileX + 1,
        placement.tileY + 1,
        indices.bottomRight
      );
    });

    if (missingAssets.size > 0) {
      const sample = Array.from(missingAssets).slice(0, 5).join(', ');
      const more =
        missingAssets.size > 5 ? ` (+${missingAssets.size - 5} more)` : '';
      console.warn(
        `⚠️ Missing floor tile mappings for chunk "${chunkName}": ${sample}${more}`
      );
    }

    if (invalidCoords.length > 0) {
      const sample = invalidCoords.slice(0, 5).join(', ');
      const more =
        invalidCoords.length > 5 ? ` (+${invalidCoords.length - 5} more)` : '';
      console.warn(
        `⚠️ Ignored floor assets with invalid coordinates in chunk "${chunkName}": ${sample}${more}`
      );
    }

    if (outOfBounds.length > 0) {
      const sample = outOfBounds.slice(0, 5).join(', ');
      const more =
        outOfBounds.length > 5 ? ` (+${outOfBounds.length - 5} more)` : '';
      console.warn(
        `⚠️ ${outOfBounds.length} floor tiles exceeded grid bounds in chunk "${chunkName}": ${sample}${more}`
      );
    }

    return { wTiles: width, hTiles: height, data };
  }

  private computeTileDimension(value: unknown, fallback?: number): number {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      return Math.max(1, Math.ceil(num / 2) * 2);
    }
    return Math.max(1, fallback ?? 2);
  }

  private toTileCoordinate(value: unknown): number | null {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return null;
    }
    return Math.round(num);
  }

  updateVisibleFloors(camera: Phaser.Cameras.Scene2D.Camera | undefined) {
    if (!camera || !this.cellSizePx || !this.chunkBounds) {
      return;
    }

    const view = camera.worldView;
    if (!view) {
      return;
    }

    const { w: cellW, h: cellH } = this.cellSizePx;
    if (cellW <= 0 || cellH <= 0) {
      return;
    }

    const { minX, maxX, minY, maxY } = this.chunkBounds;
    const padding = 1;

    const clamp = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(max, value));

    const left = view.left ?? view.x;
    const top = view.top ?? view.y;
    const right = view.right ?? left + view.width;
    const bottom = view.bottom ?? top + view.height;

    let cx0 = Math.floor(left / cellW) - padding;
    let cy0 = Math.floor(top / cellH) - padding;
    let cx1 = Math.floor((right - 1) / cellW) + padding;
    let cy1 = Math.floor((bottom - 1) / cellH) + padding;

    cx0 = clamp(cx0, minX, maxX);
    cy0 = clamp(cy0, minY, maxY);
    cx1 = clamp(cx1, minX, maxX);
    cy1 = clamp(cy1, minY, maxY);

    if (cx1 < cx0 || cy1 < cy0) {
      return;
    }

    const windowKey = `${cx0},${cy0},${cx1},${cy1}`;
    if (windowKey === this.lastCameraWindowKey && this.visibleCells.size > 0) {
      return;
    }

    this.lastCameraWindowKey = windowKey;

    const nextVisible = new Set<string>();

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cellKey = this.getCellKey(cx, cy);
        if (this.layoutMap.has(cellKey)) {
          nextVisible.add(cellKey);
        }
      }
    }

    const newlyVisible: string[] = [];
    nextVisible.forEach((cellKey) => {
      if (!this.visibleCells.has(cellKey)) {
        newlyVisible.push(cellKey);
      }
    });

    const noLongerVisible: string[] = [];
    this.visibleCells.forEach((cellKey) => {
      if (!nextVisible.has(cellKey)) {
        noLongerVisible.push(cellKey);
      }
    });

    newlyVisible.forEach((cellKey) => {
      const layout = this.layoutMap.get(cellKey);
      if (layout) {
        this.mountCellFloors(cellKey, layout);
      }
    });

    noLongerVisible.forEach((cellKey) => {
      this.unmountCellFloors(cellKey);
    });

    this.visibleCells = nextVisible;
  }

  public isFloorAtWorldXY(worldX: number, worldY: number): boolean {
    // Fast path: derive target cell and tile directly from prepared grids
    if (
      this.cellSizePx &&
      this.layoutMap.size > 0 &&
      this.preparedChunkGrids.size > 0
    ) {
      const cellW = this.cellSizePx.w;
      const cellH = this.cellSizePx.h;

      if (cellW > 0 && cellH > 0) {
        const cx = Math.floor(worldX / cellW);
        const cy = Math.floor(worldY / cellH);
        const cellKey = this.getCellKey(cx, cy);
        const layout = this.layoutMap.get(cellKey);
        if (layout) {
          const chunk = this.chunkMap.get(layout.chunkName);
          const grid = chunk
            ? this.preparedChunkGrids.get(chunk.name)
            : undefined;
          if (grid) {
            const tileSize = FLOOR_TILESET.tileSize ?? this.FLOOR_GRID_SIZE;
            const gridPixelW = grid.wTiles * tileSize;
            const gridPixelH = grid.hTiles * tileSize;

            // Compute same anchoring offset used when mounting the layer
            const ports = Array.isArray(chunk?.meta?.ports)
              ? (chunk.meta!.ports as any[])
              : [];
            const hasN = ports.some((p) => p.side === 'N');
            const hasS = ports.some((p) => p.side === 'S');
            const hasW = ports.some((p) => p.side === 'W');
            const hasE = ports.some((p) => p.side === 'E');

            const centerDX = Math.floor((cellW - gridPixelW) / 2);
            const centerDY = Math.floor((cellH - gridPixelH) / 2);

            const dx =
              hasW && !hasE
                ? 0
                : hasE && !hasW
                  ? Math.max(0, cellW - gridPixelW)
                  : Math.max(0, centerDX);
            const dy =
              hasN && !hasS
                ? 0
                : hasS && !hasN
                  ? Math.max(0, cellH - gridPixelH)
                  : Math.max(0, centerDY);

            const offsetX = layout.x * cellW + dx;
            const offsetY = layout.y * cellH + dy;

            const localX = worldX - offsetX;
            const localY = worldY - offsetY;
            if (
              localX < 0 ||
              localY < 0 ||
              localX >= gridPixelW ||
              localY >= gridPixelH
            ) {
              return false;
            }

            const tileX = Math.floor(localX / tileSize);
            const tileY = Math.floor(localY / tileSize);
            if (
              tileX < 0 ||
              tileY < 0 ||
              tileX >= grid.wTiles ||
              tileY >= grid.hTiles
            ) {
              return false;
            }

            const tileIndex = grid.data[tileY * grid.wTiles + tileX];
            return typeof tileIndex === 'number' && tileIndex >= 0;
          }
        }
      }
    }

    // Fallback: check rendered tilemap layers (still O(number of active layers))
    if (this.activeTilemaps.size > 0) {
      const camera = this.scene?.cameras?.main;
      for (const entry of this.activeTilemaps.values()) {
        const tile = entry.layer.getTileAtWorldXY(
          worldX,
          worldY,
          false,
          camera
        );
        if (tile && tile.index >= 0) {
          return true;
        }
      }
    }
    return false;
  }

  destroyFloors() {
    if (this.activeTilemaps.size > 0) {
      this.activeTilemaps.forEach(({ layer, map }) => {
        layer.destroy();
        map.destroy();
      });
      this.activeTilemaps.clear();
    }

    // Legacy blitter path removed

    this.preparedChunkGrids.clear();
    this.visibleCells.clear();
    this.chunkLayout = [];
    this.layoutMap.clear();
    this.chunkMap.clear();
    this.cellSizePx = null;
    this.chunkBounds = null;
    this.lastCameraWindowKey = null;
  }

  private getCellKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private mountCellFloors(
    cellKey: string,
    layout: { x: number; y: number; chunkName: string }
  ) {
    if (!this.cellSizePx) {
      return;
    }

    const chunk = this.chunkMap.get(layout.chunkName);
    if (!chunk) {
      console.warn(
        `⚠️ Chunk "${layout.chunkName}" not found while mounting floors`
      );
      return;
    }

    this.mountCellFloorsWithTilemap(cellKey, layout, chunk);
  }

  private mountCellFloorsWithTilemap(
    cellKey: string,
    layout: { x: number; y: number; chunkName: string },
    chunk: any
  ): boolean {
    if (this.activeTilemaps.has(cellKey)) {
      return true;
    }

    const grid = this.preparedChunkGrids.get(chunk.name);
    if (!grid) {
      return false;
    }

    const textureKey = FLOOR_TILESET.imageKey;
    const tileSize = FLOOR_TILESET.tileSize ?? this.FLOOR_GRID_SIZE;

    if (!this.scene.textures.exists(textureKey)) {
      console.warn(
        `⚠️ Floor tileset "${textureKey}" is not loaded yet; floors will not render in this cell.`
      );
      return false;
    }

    const map = this.scene.make.tilemap({
      tileWidth: tileSize,
      tileHeight: tileSize,
      width: grid.wTiles,
      height: grid.hTiles,
    });

    if (!map) {
      console.warn(`⚠️ Failed to create tilemap for chunk "${chunk.name}"`);
      return false;
    }

    const tileset = map.addTilesetImage(
      textureKey,
      textureKey,
      tileSize,
      tileSize,
      0,
      0
    );

    if (!tileset) {
      console.warn(
        `⚠️ Failed to add tileset "${textureKey}" to map for chunk "${chunk.name}"`
      );
      map.destroy();
      return false;
    }

    // Anchor smaller chunks to cell edges based on port sides so openings meet
    // the cell seams (e.g., S port → align bottom). Default to centering when
    // ambiguous (e.g., both N and S present).
    const cellW = this.cellSizePx!.w;
    const cellH = this.cellSizePx!.h;
    const gridPixelW = grid.wTiles * tileSize;
    const gridPixelH = grid.hTiles * tileSize;

    const ports = Array.isArray(chunk?.meta?.ports)
      ? (chunk.meta!.ports as any[])
      : [];
    const hasN = ports.some((p) => p.side === 'N');
    const hasS = ports.some((p) => p.side === 'S');
    const hasW = ports.some((p) => p.side === 'W');
    const hasE = ports.some((p) => p.side === 'E');

    const centerDX = Math.floor((cellW - gridPixelW) / 2);
    const centerDY = Math.floor((cellH - gridPixelH) / 2);

    const dx =
      hasW && !hasE
        ? 0
        : hasE && !hasW
          ? Math.max(0, cellW - gridPixelW)
          : Math.max(0, centerDX);
    const dy =
      hasN && !hasS
        ? 0
        : hasS && !hasN
          ? Math.max(0, cellH - gridPixelH)
          : Math.max(0, centerDY);

    const offsetX = layout.x * cellW + dx;
    const offsetY = layout.y * cellH + dy;
    const layer = map.createBlankLayer(
      `floors-${cellKey}`,
      tileset,
      offsetX,
      offsetY
    );

    if (!layer) {
      console.warn(`⚠️ Failed to create tilemap layer for cell "${cellKey}"`);
      map.destroy();
      return false;
    }

    layer.setOrigin(0, 0);
    layer.setDepth(1);
    layer.setCullPadding(1, 1);
    layer.setScrollFactor(1);

    const { data, wTiles, hTiles } = grid;
    const tilesMatrix: number[][] = [];
    for (let ty = 0; ty < hTiles; ty += 1) {
      const row: number[] = new Array(wTiles);
      for (let tx = 0; tx < wTiles; tx += 1) {
        const tileIndex = data[ty * wTiles + tx];
        row[tx] = tileIndex >= 0 ? tileIndex : -1;
      }
      tilesMatrix.push(row);
    }
    layer.putTilesAt(tilesMatrix, 0, 0, false);

    this.activeTilemaps.set(cellKey, { map, layer });
    return true;
  }

  private unmountCellFloors(cellKey: string) {
    const tilemapEntry = this.activeTilemaps.get(cellKey);
    if (tilemapEntry) {
      tilemapEntry.layer.destroy();
      tilemapEntry.map.destroy();
      this.activeTilemaps.delete(cellKey);
    }
  }

  destroy() {
    debugLog('EnvironmentSystem: Cleaning up environment...');
    this.destroyBackground();
    this.destroyFloors();

    // Clean up trees
    Object.values(this.treeEntities).forEach((tree: any) => {
      if (tree.trunk) tree.trunk.destroy();
      if (tree.leaves) tree.leaves.destroy();
    });

    this.treeEntities = {};
    this.treePositions = [];

    debugLog('✅ Environment cleanup complete');
  }
}
