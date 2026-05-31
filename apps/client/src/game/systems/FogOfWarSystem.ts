import { GAME_CONFIG, RENDER_DEPTHS } from '../../lib/constants';
interface FogStatePayload {
  enabled: boolean;
  tileSize: number;
  mapWidth: number;
  mapHeight: number;
  radiusTiles: number;
  discovered?: Array<{ x: number; y: number }>;
}

interface FogRevealTile {
  x: number;
  y: number;
}

const FOG_DEPTH = RENDER_DEPTHS.fog;
const DEFAULT_ALPHA = 1;
const ERASE_PADDING_PX = 1;

export class FogOfWarSystem {
  private scene: any;
  private tileSize = GAME_CONFIG.TILE_SIZE;
  private mapWidth = 0;
  private mapHeight = 0;
  private radiusTiles = 0;
  private enabled = false;

  private fogRT: Phaser.GameObjects.RenderTexture | null = null;
  private drawGraphics: Phaser.GameObjects.Graphics | null = null;

  private discovered: Uint8Array | null = null;

  private debugEnabled = false;
  private debugGraphics: Phaser.GameObjects.Graphics | null = null;
  private lastPlayerX = 0;
  private lastPlayerY = 0;

  constructor(scene: any) {
    this.scene = scene;
  }

  applyState(payload: FogStatePayload): void {
    this.tileSize = Number.isFinite(payload.tileSize)
      ? payload.tileSize
      : this.tileSize;
    this.mapWidth = Number.isFinite(payload.mapWidth)
      ? payload.mapWidth
      : this.mapWidth;
    this.mapHeight = Number.isFinite(payload.mapHeight)
      ? payload.mapHeight
      : this.mapHeight;
    this.radiusTiles = Number.isFinite(payload.radiusTiles)
      ? payload.radiusTiles
      : this.radiusTiles;

    if (!payload.enabled || this.mapWidth <= 0 || this.mapHeight <= 0) {
      this.enabled = false;
      this.discovered = null;
      this.destroyOverlay();
      this.clearDebugGraphics();
      return;
    }

    this.enabled = true;
    this.initializeDiscovered(payload.discovered);
    this.rebuildOverlay();

    if (this.debugEnabled) {
      this.updatePlayerPosition(this.lastPlayerX, this.lastPlayerY);
    }
  }

  applyReveal(tiles: Array<FogRevealTile> | null | undefined): void {
    if (!this.enabled || !Array.isArray(tiles) || tiles.length === 0) {
      return;
    }

    const discovered = this.discovered;
    if (!discovered) {
      return;
    }

    const changed: Array<FogRevealTile> = [];
    for (const tile of tiles) {
      if (!tile) continue;
      const tx = Math.floor(tile.x);
      const ty = Math.floor(tile.y);
      if (this.markDiscovered(tx, ty)) {
        changed.push({ x: tx, y: ty });
      }
    }

    if (changed.length > 0) {
      this.eraseTiles(changed);
    }
  }

  updatePlayerPosition(x: number, y: number): void {
    this.lastPlayerX = x;
    this.lastPlayerY = y;

    if (!this.debugEnabled) {
      return;
    }

    const graphics = this.ensureDebugGraphics();
    graphics.clear();
    graphics.lineStyle(2, 0x00ffff, 0.8);
    const radiusPx = this.radiusTiles * this.tileSize;
    graphics.strokeCircle(x, y, radiusPx);
  }

  toggleDebug(): void {
    this.debugEnabled = !this.debugEnabled;

    this.updateOverlayVisibility();

    if (!this.debugEnabled) {
      this.clearDebugGraphics();
      return;
    }

    this.updatePlayerPosition(this.lastPlayerX, this.lastPlayerY);
  }

  destroy(): void {
    this.destroyOverlay();
    this.clearDebugGraphics();
    this.discovered = null;
    // World-sized overlay path has no viewport state to reset
  }

  private rebuildOverlay(): void {
    if (!this.enabled || this.mapWidth <= 0 || this.mapHeight <= 0) {
      this.destroyOverlay();
      return;
    }

    const fogRT = this.ensureFogRenderTexture();
    if (!fogRT) {
      return;
    }
    this.updateOverlayVisibility();
    this.redrawFogWorld();
  }

  private destroyOverlay(): void {
    if (this.fogRT) {
      this.fogRT.destroy();
      this.fogRT = null;
    }
    if (this.drawGraphics) {
      this.drawGraphics.destroy();
      this.drawGraphics = null;
    }
  }

  private clearDebugGraphics(): void {
    if (!this.debugGraphics) {
      return;
    }
    const graphics = this.debugGraphics;
    graphics.clear();
    graphics.destroy();
    this.debugGraphics = null;
  }

  private updateOverlayVisibility(): void {
    const visible = this.enabled && !this.debugEnabled;
    if (this.fogRT) this.fogRT.setVisible(visible);
  }

  private ensureDrawGraphics(): Phaser.GameObjects.Graphics {
    if (!this.drawGraphics) {
      const g = this.scene.add.graphics();
      g.setDepth(FOG_DEPTH + 1);
      g.setScrollFactor(1);
      g.setVisible(false);
      this.drawGraphics = g;
    }
    return this.drawGraphics!;
  }

  private ensureDebugGraphics(): Phaser.GameObjects.Graphics {
    if (!this.debugGraphics) {
      const graphics = this.scene.add.graphics();
      graphics.setDepth(FOG_DEPTH + 3);
      graphics.setScrollFactor(1);
      this.debugGraphics = graphics;
    }
    return this.debugGraphics!;
  }

  private initializeDiscovered(
    tiles: Array<{ x: number; y: number }> | undefined
  ): void {
    const totalTiles = this.mapWidth * this.mapHeight;
    if (!Number.isFinite(totalTiles) || totalTiles <= 0) {
      this.discovered = null;
      return;
    }

    if (!this.discovered || this.discovered.length !== totalTiles) {
      this.discovered = new Uint8Array(totalTiles);
    } else {
      this.discovered.fill(0);
    }

    if (!Array.isArray(tiles)) {
      return;
    }

    for (const tile of tiles) {
      if (!tile) continue;
      const tx = Math.floor(tile.x);
      const ty = Math.floor(tile.y);
      this.markDiscovered(tx, ty);
    }
  }

  private ensureFogRenderTexture(): Phaser.GameObjects.RenderTexture | null {
    const width = Math.max(1, Math.round(this.mapWidth * this.tileSize));
    const height = Math.max(1, Math.round(this.mapHeight * this.tileSize));

    if (this.fogRT) {
      // Recreate if size changed
      if (this.fogRT.width !== width || this.fogRT.height !== height) {
        this.fogRT.destroy();
        this.fogRT = null;
      }
    }

    if (!this.fogRT) {
      const fog = this.scene.add
        .renderTexture(0, 0, width, height)
        .setOrigin(0)
        .setScrollFactor(1)
        .setDepth(FOG_DEPTH)
        .setAlpha(DEFAULT_ALPHA);
      fog.fill(0x000000, DEFAULT_ALPHA);
      this.fogRT = fog;
      this.updateOverlayVisibility();
    }

    return this.fogRT;
  }

  private redrawFogWorld(): void {
    const fogRT = this.fogRT;
    const discovered = this.discovered;
    if (!fogRT || !discovered) {
      return;
    }

    fogRT.clear();
    fogRT.fill(0x000000, DEFAULT_ALPHA);

    const graphics = this.ensureDrawGraphics();
    graphics.setVisible(true);
    graphics.clear();
    graphics.fillStyle(0xffffff, 1);

    const padding = ERASE_PADDING_PX;
    const tileSize = this.tileSize;
    let erasedAny = false;

    const total = discovered.length;
    for (let idx = 0; idx < total; idx += 1) {
      if (discovered[idx] !== 1) continue;
      const tx = idx % this.mapWidth;
      const ty = Math.floor(idx / this.mapWidth);
      const worldX = tx * tileSize;
      const worldY = ty * tileSize;
      graphics.fillRect(
        worldX - padding,
        worldY - padding,
        tileSize + padding * 2,
        tileSize + padding * 2
      );
      erasedAny = true;
    }

    if (erasedAny) {
      fogRT.erase(graphics);
    }

    graphics.clear();
    graphics.setVisible(false);
  }

  private eraseTiles(tiles: Array<FogRevealTile>): void {
    const fogRT = this.fogRT;
    if (!fogRT || tiles.length === 0) return;
    const graphics = this.ensureDrawGraphics();
    graphics.setVisible(true);
    graphics.clear();
    graphics.fillStyle(0xffffff, 1);

    const padding = ERASE_PADDING_PX;
    const tileSize = this.tileSize;
    let erasedAny = false;

    for (const t of tiles) {
      const tx = Math.floor(t.x);
      const ty = Math.floor(t.y);
      if (!this.tileInBounds(tx, ty)) continue;
      graphics.fillRect(
        tx * tileSize - padding,
        ty * tileSize - padding,
        tileSize + padding * 2,
        tileSize + padding * 2
      );
      erasedAny = true;
    }

    if (erasedAny) {
      fogRT.erase(graphics);
    }

    graphics.clear();
    graphics.setVisible(false);
  }

  private tileInBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.mapWidth && ty < this.mapHeight;
  }

  private encodeIndex(tx: number, ty: number): number {
    return ty * this.mapWidth + tx;
  }

  private markDiscovered(tx: number, ty: number): boolean {
    if (!this.discovered || !this.tileInBounds(tx, ty)) {
      return false;
    }
    const idx = this.encodeIndex(tx, ty);
    if (this.discovered[idx] === 1) {
      return false;
    }
    this.discovered[idx] = 1;
    return true;
  }
}
