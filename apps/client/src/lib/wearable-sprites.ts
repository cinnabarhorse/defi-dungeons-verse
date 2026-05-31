import type Phaser from 'phaser';

export interface WearableSpriteOptions {
  scene: Phaser.Scene;
  x: number;
  y: number;
  wearableId: number | string;
  entityId: string;
  droppedItemEntities: { [itemId: string]: any };
  placeholderColor?: number;
}

function calculateWearableScaleFromTexture(
  texture: Phaser.Textures.Texture
): number {
  const targetSize = 64;
  const textureWidth = texture.source[0].width;
  const textureHeight = texture.source[0].height;
  const maxDimension = Math.max(textureWidth, textureHeight);
  return targetSize / maxDimension;
}

export function renderWearableCollectible(
  options: WearableSpriteOptions
): Phaser.GameObjects.GameObject {
  const {
    scene,
    x,
    y,
    wearableId,
    entityId,
    droppedItemEntities,
    placeholderColor = 0x9370db,
  } = options;
  const textureKey = `wearable_${wearableId}`;
  const imageUrl = `/wearables/${wearableId}.svg`;

  if (scene.textures.exists(textureKey)) {
    const sprite = scene.add.image(x, y, textureKey);
    const texture = scene.textures.get(textureKey);
    const normalizedScale = calculateWearableScaleFromTexture(texture);
    sprite.setScale(normalizedScale);
    return sprite;
  }

  // Placeholder rectangle with star indicator
  const rect = scene.add.rectangle(x, y, 32, 32, placeholderColor);
  rect.setStrokeStyle(1, 0xffffff);
  const star = scene.add
    .text(x + 8, y - 8, '★', { fontSize: '8px', color: '#FFD700' })
    .setOrigin(0.5);
  rect.setData('starIndicator', star);

  // Load high-res SVG similar to scene.loadHighResSVG if available
  const loaderHasHighRes = typeof (scene as any).loadHighResSVG === 'function';
  if (loaderHasHighRes) {
    (scene as any).loadHighResSVG(textureKey, imageUrl, () => {
      try {
        if (!scene.textures.exists(textureKey)) return;
        const current = droppedItemEntities[entityId];
        if (!current) return;
        const oldSprite = current.sprite;
        const itemData = current.itemData;
        const starIndicator = oldSprite?.getData?.('starIndicator');
        if (starIndicator) starIndicator.destroy();
        if (oldSprite) oldSprite.destroy();
        const imageSprite = scene.add.image(x, y, textureKey);
        const texture = scene.textures.get(textureKey);
        const normalizedScale = calculateWearableScaleFromTexture(texture);
        imageSprite.setScale(normalizedScale);
        if (itemData != null) imageSprite.setData('itemData', itemData);
        imageSprite.setDepth(1);
        droppedItemEntities[entityId].sprite = imageSprite;
      } catch {
        // no-op
      }
    });
  } else {
    scene.load.image(textureKey, imageUrl);
    scene.load.once('complete', () => {
      try {
        if (!scene.textures.exists(textureKey)) return;
        const current = droppedItemEntities[entityId];
        if (!current) return;
        const oldSprite = current.sprite;
        const itemData = current.itemData;
        const starIndicator = oldSprite?.getData?.('starIndicator');
        if (starIndicator) starIndicator.destroy();
        if (oldSprite) oldSprite.destroy();
        const imageSprite = scene.add.image(x, y, textureKey);
        const texture = scene.textures.get(textureKey);
        const normalizedScale = calculateWearableScaleFromTexture(texture);
        imageSprite.setScale(normalizedScale);
        if (itemData != null) imageSprite.setData('itemData', itemData);
        imageSprite.setDepth(1);
        droppedItemEntities[entityId].sprite = imageSprite;
      } catch {
        // no-op
      }
    });
    scene.load.start();
  }

  return rect;
}
