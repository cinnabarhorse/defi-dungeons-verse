import type Phaser from 'phaser';

export interface TokenSpriteOptions {
  scene: Phaser.Scene;
  x: number;
  y: number;
  tokenName: string;
  entityId: string;
  amount?: number;
  // Reference to scene-managed dropped items so we can swap placeholders post-load
  droppedItemEntities: { [itemId: string]: any };
}

function normalizeTokenName(name: string): string {
  return name.trim().toUpperCase();
}

function extractTokenSlug(tokenName: string): string {
  const upper = normalizeTokenName(tokenName);
  if (/(^|\s)USDC(\s|$)/.test(upper) || /USD\s*COIN/.test(upper)) {
    return 'usdc';
  }
  if (/(^|\s)GHST(\s|$)/.test(upper)) {
    return 'ghst';
  }
  return tokenName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getTokenIconUrl(tokenName: string): string {
  const slug = extractTokenSlug(tokenName);
  return `/loot-icons/${slug}.svg`;
}

export function getTokenPlaceholderColor(tokenName: string): number {
  const slug = extractTokenSlug(tokenName);
  if (slug === 'usdc') return 0x2775ca;
  if (slug === 'ghst') return 0x7c3aed; // violet
  return 0xd4af37; // gold-ish default
}

export function getTokenDisplaySize(amount?: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 24;
  if (amount <= 0.1) return 16;
  if (amount > 0.5) return 32;
  return 24;
}

export function renderTokenCollectible(
  options: TokenSpriteOptions
): Phaser.GameObjects.GameObject {
  const { scene, x, y, tokenName, entityId, amount, droppedItemEntities } =
    options;
  const name = normalizeTokenName(tokenName);
  const slug = extractTokenSlug(tokenName);

  // Special animated token handling
  if (slug === 'ghst') {
    const sprite = scene.add.sprite(x, y, 'ghst_token');
    sprite.setDisplaySize(64, 64);
    sprite.setOrigin(0.5, 0.5);
    sprite.play('ghst_token_spin');
    return sprite;
  }

  // Static icon handling (default path-based icon)
  const size = getTokenDisplaySize(amount);
  const textureKey = `token_icon_${slug}`;
  const iconUrl = getTokenIconUrl(tokenName);

  const createIconSprite = () => {
    const icon = scene.add.image(x, y, textureKey);
    icon.setDisplaySize(size, size);
    icon.setOrigin(0.5, 0.5);
    return icon;
  };

  if (scene.textures.exists(textureKey)) {
    return createIconSprite();
  }

  // Placeholder until icon loads
  const placeholder = scene.add.circle(
    x,
    y,
    size / 2,
    getTokenPlaceholderColor(tokenName)
  );
  const strokeColor = slug === 'usdc' ? 0xffffff : 0x000000;
  placeholder.setStrokeStyle(1, strokeColor);

  scene.load.image(textureKey, iconUrl);
  scene.load.once('complete', () => {
    try {
      if (!scene.textures.exists(textureKey)) return;
      const current = droppedItemEntities[entityId];
      if (!current) return;
      const oldSprite = current.sprite;
      const itemData = current.itemData;
      if (oldSprite) {
        oldSprite.destroy();
      }
      const icon = createIconSprite();
      if (itemData != null) icon.setData('itemData', itemData);
      icon.setDepth(1);
      droppedItemEntities[entityId].sprite = icon;
    } catch {
      // no-op
    }
  });
  scene.load.start();

  return placeholder;
}
