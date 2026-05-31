import { GAME_CONFIG, RENDER_DEPTHS } from '../lib/constants';
import { getAuraAbilityLabelsFromTags } from '../lib/aura-utils';
import { ENEMY_TYPES as CLIENT_ENEMY_TYPES } from '../data/enemies';
import { EntityManager, EntityFactory } from '../lib/entity-manager';

export function renderTreeSprite(scene: any, entity: any, entityId: string) {
  const state = JSON.parse(entity.state || '{}');
  const health = state.health || 3;
  const maxHealth = state.maxHealth || 3;
  const treeType = state.treeType || 'green'; // Default to green tree if no type specified
  const assetId = state.assetId; // Original asset ID from chunk

  // Get the appropriate sprite key - use asset ID directly if available, otherwise fallback to tree type
  let spriteKey = assetId || `tree_${treeType}`;

  // Check if the texture exists
  if (!scene.textures.exists(spriteKey)) {
    console.error(
      `❌ Missing tree texture: ${spriteKey} for entity ${entityId}`
    );
    return null;
  }

  // Create tree sprite using the loaded image
  const treeSprite = scene.add.image(entity.x, entity.y, spriteKey);
  treeSprite.setOrigin(0, 0); // Center the sprite
  // Ensure trees aren't hidden behind floor layers when placed at y=0
  treeSprite.setDepth(Math.max(entity.y, 2));

  // Apply health-based tinting (darker as health decreases)
  let tintColor = 0xffffff; // Full brightness
  if (health === 2) {
    tintColor = 0xcccccc; // Slightly darker
  } else if (health === 1) {
    tintColor = 0x999999; // Much darker (damaged)
  }
  treeSprite.setTint(tintColor);

  // Make tree clickable for chopping
  treeSprite.setInteractive();

  // Add hover cursor change
  treeSprite.on('pointerover', () => {
    // Change cursor to crosshair to indicate actionable tree
    scene.input.setDefaultCursor('crosshair');
  });

  treeSprite.on('pointerout', () => {
    scene.input.setDefaultCursor('auto');
  });

  treeSprite.on('pointerdown', () => {
    console.log(`🪓 Clicked on ${treeType} tree:`, entityId);
    // Use the new action system instead of direct chop_tree message
    scene.room?.send('startAction', { type: 'chop_tree', targetId: entityId });
  });

  // Add health indicator if tree is damaged
  let healthText: any = null;
  if (health < maxHealth) {
    healthText = scene.add
      .text(entity.x, entity.y - 35, `${health}/${maxHealth}`, {
        fontSize: '12px',
        color: '#ffffff',
        backgroundColor: '#000000',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5);
  }

  // Store references
  treeSprite.setData('healthText', healthText);
  treeSprite.setData('treeType', treeType);
  scene.environmentSystem.treeEntities[entityId] = treeSprite;

  // Listen for entity state changes
  entity.onChange(() => {
    const updatedState = JSON.parse(entity.state || '{}');
    const updatedHealth = updatedState.health || 3;
    const updatedMaxHealth = updatedState.maxHealth || 3;

    // Update tree tinting based on health
    let newTintColor = 0xffffff; // Full brightness
    if (updatedHealth === 2) {
      newTintColor = 0xcccccc; // Slightly darker
    } else if (updatedHealth === 1) {
      newTintColor = 0x999999; // Much darker (damaged)
    }
    treeSprite.setTint(newTintColor);

    // Update health text
    const currentHealthText = treeSprite.getData('healthText');
    if (currentHealthText) {
      currentHealthText.destroy();
    }
    if (updatedHealth < updatedMaxHealth) {
      const newHealthText = scene.add
        .text(entity.x, entity.y - 35, `${updatedHealth}/${updatedMaxHealth}`, {
          fontSize: '12px',
          color: '#ffffff',
          backgroundColor: '#000000',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5);
      treeSprite.setData('healthText', newHealthText);
    } else {
      treeSprite.setData('healthText', null);
    }
  });

  return treeSprite;
}

export function renderStoneSprite(scene: any, entity: any, entityId: string) {
  const state = JSON.parse(entity.state || '{}');
  const health = state.health || 6;
  const maxHealth = state.maxHealth || 6;
  const assetId = state.assetId; // Original asset ID from chunk

  // Get the appropriate sprite key - use asset ID directly if available, otherwise fallback to first available rock sprite
  let spriteKey = assetId;

  // Fallback for legacy/procedural stones without asset IDs
  if (!spriteKey) {
    console.warn(
      `⚠️ Stone entity ${entityId} has no assetId, using fallback sprite`
    );
    spriteKey = 'double_rocks_small'; // Use a chunk asset as fallback
  }

  // Check if the texture exists
  if (!scene.textures.exists(spriteKey)) {
    console.error(
      `❌ Missing stone texture: ${spriteKey} for entity ${entityId}`
    );
    return null;
  }

  // Create stone sprite using the loaded image
  const stoneSprite = scene.add.image(entity.x, entity.y, spriteKey);
  stoneSprite.setOrigin(0, 0); // Center the sprite
  stoneSprite.setDepth(entity.y); // Depth sorting

  // Apply health-based tinting (darker as health decreases)
  let tintColor = 0xffffff; // Full brightness
  if (health <= 4) {
    tintColor = 0xcccccc; // Slightly darker
  }
  if (health <= 2) {
    tintColor = 0x999999; // Much darker
  }
  stoneSprite.setTint(tintColor);

  // Make stone clickable for mining
  stoneSprite.setInteractive();

  // Add hover cursor change
  stoneSprite.on('pointerover', () => {
    // Change cursor to crosshair to indicate actionable stone
    scene.input.setDefaultCursor('crosshair');
  });

  stoneSprite.on('pointerout', () => {
    scene.input.setDefaultCursor('auto');
  });

  stoneSprite.on('pointerdown', () => {
    console.log('⛏️ Clicked on stone:', entityId);
    // Use the new action system instead of direct chop_stone message
    scene.room?.send('startAction', { type: 'mine_stone', targetId: entityId });
  });

  // Add health indicator if stone is damaged
  let healthText: any = null;
  if (health < maxHealth) {
    healthText = scene.add
      .text(entity.x, entity.y - 35, `${health}/${maxHealth}`, {
        fontSize: '12px',
        color: '#ffffff',
        backgroundColor: '#000000',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5);
  }

  // Store references
  stoneSprite.setData('healthText', healthText);
  scene.environmentSystem.stoneEntities[entityId] = stoneSprite;

  // Listen for entity state changes
  entity.onChange(() => {
    const updatedState = JSON.parse(entity.state || '{}');
    const updatedHealth = updatedState.health || 6;
    const updatedMaxHealth = updatedState.maxHealth || 6;

    // Update stone tinting based on health
    let newTintColor = 0xffffff; // Full brightness
    if (updatedHealth <= 4) {
      newTintColor = 0xcccccc; // Slightly darker
    }
    if (updatedHealth <= 2) {
      newTintColor = 0x999999; // Much darker
    }
    stoneSprite.setTint(newTintColor);

    // Update health text
    const currentHealthText = stoneSprite.getData('healthText');
    if (currentHealthText) {
      currentHealthText.destroy();
    }
    if (updatedHealth < updatedMaxHealth) {
      const newHealthText = scene.add
        .text(entity.x, entity.y - 35, `${updatedHealth}/${updatedMaxHealth}`, {
          fontSize: '12px',
          color: '#ffffff',
          backgroundColor: '#000000',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5);
      stoneSprite.setData('healthText', newHealthText);
    } else {
      stoneSprite.setData('healthText', null);
    }
  });

  return stoneSprite;
}

export function renderSpecialSprite(scene: any, entity: any, entityId: string) {
  const state = JSON.parse(entity.state || '{}');
  const assetId = state.assetId; // Original asset ID from chunk

  // Use asset ID directly as sprite key, with fallback
  let spriteKey = assetId;

  // Fallback for special entities without asset IDs
  if (!spriteKey) {
    console.warn(
      `⚠️ Special entity ${entityId} has no assetId, using fallback sprite`
    );
    spriteKey = 'monolith_grayscale'; // Use a chunk special asset as fallback
  }

  // Check if the texture exists
  if (!scene.textures.exists(spriteKey)) {
    console.error(
      `❌ Missing special texture: ${spriteKey} for entity ${entityId}`
    );
    return null;
  }

  const renderLayer = state.renderLayer;
  const depthHint = state.depthHint;

  // If the texture has multiple frames and an animation registered, use Sprite
  const animKey = `${spriteKey}_anim`;
  let specialSprite: any;
  const hasAnim = scene.anims && scene.anims.exists(animKey);
  const hasMultiFrameTexture = (() => {
    if (!scene.textures || !scene.textures.exists(spriteKey)) return false;
    const tex = scene.textures.get(spriteKey);
    try {
      return tex && tex.getFrameNames().length > 1;
    } catch {
      return false;
    }
  })();

  if (hasAnim || hasMultiFrameTexture) {
    // Prefer Sprite so frame sizing is correct even if animation not created yet
    specialSprite = scene.add.sprite(entity.x, entity.y, spriteKey);
    specialSprite.setOrigin(0, 0);
    if (hasAnim) {
      specialSprite.play(animKey);
    } else {
      // Ensure frame 0 so width/height match a single frame, not the full sheet
      try {
        specialSprite.setFrame(0);
      } catch {}
    }
  } else {
    // Fallback to static image
    specialSprite = scene.add.image(entity.x, entity.y, spriteKey);
    specialSprite.setOrigin(0, 0);
  }

  if (renderLayer === 'overlay') {
    const overlayDepth = typeof depthHint === 'number' ? depthHint : 2;
    specialSprite.setDepth(overlayDepth);
  } else {
    specialSprite.setDepth(entity.y); // Depth sorting
  }

  // Make special objects interactive for potential future interactions
  specialSprite.setInteractive();

  // Add hover cursor change
  // specialSprite.on('pointerover', () => {
  //   scene.input.setDefaultCursor('help');
  // });

  // specialSprite.on('pointerout', () => {
  //   scene.input.setDefaultCursor('auto');
  // });

  // specialSprite.on('pointerdown', () => {
  //   console.log('✨ Clicked on special object:', entityId, assetId);
  //   // Future: Add special object interactions
  // });

  // Store references
  specialSprite.setData('assetId', assetId);

  return specialSprite;
}

// Re-export treasure chest functionality from dedicated manager
export { renderTreasureChestSprite } from '../lib/treasure-chest-manager';

export function renderRoadSprite(scene: any, entity: any) {
  const roadState = JSON.parse(entity.state || '{}');
  const roadType = roadState.type || 'main';

  let roadSprite: any;

  if (roadType === 'main') {
    // Create main road background
    roadSprite = scene.add.rectangle(
      entity.x,
      entity.y,
      roadState.width || GAME_CONFIG.WORLD_WIDTH,
      roadState.height || 60,
      roadState.color || 0x4a4a2f
    );
    roadSprite.setDepth(-1); // Behind everything else
  } else if (roadType === 'dash') {
    // Create road dash markings
    roadSprite = scene.add.rectangle(
      entity.x,
      entity.y,
      roadState.width || 20,
      roadState.height || 2,
      roadState.color || 0xffffff
    );
    roadSprite.setDepth(0); // On top of road but behind players
  }

  return roadSprite;
}

const ELITE_AURA_COLOR_MAP: Record<string, number> = {
  red: 0xff5c5c,
  green: 0x5cff8d,
  blue: 0x5ac0ff,
  yellow: 0xffd866,
};

function normalizeVisualTags(input: any): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.filter((tag) => typeof tag === 'string');
  }

  const result: string[] = [];
  const maybeForEach = (input as any)?.forEach;
  if (typeof maybeForEach === 'function') {
    maybeForEach.call(input, (value: any) => {
      if (typeof value === 'string') {
        result.push(value);
      }
    });
    if (result.length > 0) {
      return result;
    }
  }

  const length = Number((input as any)?.length);
  if (Number.isFinite(length) && length > 0) {
    for (let i = 0; i < length; i++) {
      const value = (input as any)[i];
      if (typeof value === 'string') {
        result.push(value);
      }
    }
    if (result.length > 0) {
      return result;
    }
  }

  const iterator = (input as any)?.values;
  if (typeof iterator === 'function') {
    for (const value of iterator.call(input)) {
      if (typeof value === 'string') {
        result.push(value);
      }
    }
  }

  return result;
}

function resolveEliteAuraColor(visualTagsInput?: any): number {
  const visualTags = normalizeVisualTags(visualTagsInput);
  if (visualTags.length === 0) {
    return 0xffc14f;
  }
  const auraTag = visualTags.find(
    (tag) => typeof tag === 'string' && tag.startsWith('aura:')
  );
  if (!auraTag) return 0xffc14f;
  const [, colorKey] = auraTag.split(':');
  return ELITE_AURA_COLOR_MAP[colorKey ?? ''] ?? 0xffc14f;
}

function resolveEliteAuraColorForEnemy(enemy: any): number {
  return resolveEliteAuraColor(enemy?.visualTags);
}

export function renderEnemySprite(scene: any, enemy: any, enemyId: string) {
  if (process.env.NEXT_PUBLIC_DEBUG === '1') {
    console.log('👹 Creating enemy:', enemyId, 'at', enemy.x, enemy.y);
  }

  // EntityManager should already be initialized in GameScene
  if (!scene.entityManager) {
    console.error('EntityManager not initialized in GameScene!');
    return;
  }

  const clampSizeMultiplier = (value: number) => {
    if (!Number.isFinite(value)) return 1;
    return Math.max(0.5, Math.min(3, value));
  };

  const initialSizeMultiplier = clampSizeMultiplier(
    Number(enemy.sizeMultiplier)
  );

  const auraColor = resolveEliteAuraColorForEnemy(enemy);

  const auraColorCss = '#' + auraColor.toString(16).padStart(6, '0');
  const tags = normalizeVisualTags(enemy.visualTags);
  const hasAuraTag = tags.some(
    (tag) => tag.startsWith('aura:') || tag === 'aura:buffed'
  );
  const isElite =
    Boolean(enemy.isElite) || String(enemy?.name || '').startsWith('★');
  const showAura = isElite || hasAuraTag;

  // Create the main enemy sprite
  let enemySprite;
  const hasAnimatedSprite =
    enemy.enemyType &&
    scene.enemySpriteManager &&
    scene.enemySpriteManager.hasEnemyConfig(enemy.enemyType);

  if (hasAnimatedSprite) {
    // Get sprite configuration from enemy data if available
    const spriteConfig = enemy.spriteConfig || undefined;

    // Create animated sprite for supported enemies (positioned relative to container)
    enemySprite = scene.enemySpriteManager.createEnemySprite(
      enemyId,
      enemy.enemyType,
      0, // Position relative to container
      0, // Position relative to container
      spriteConfig,
      { sizeMultiplier: initialSizeMultiplier }
    );

    if (!enemySprite) {
      // Fallback to colored rectangle if sprite creation fails
      const enemyColor = scene.getEnemyColor(enemy.name);
      enemySprite = scene.add.rectangle(0, 0, 48, 48, enemyColor);
      enemySprite.setStrokeStyle(2, 0x000000);
      enemySprite.setScale(initialSizeMultiplier);
      enemySprite.setData('baseScale', 1);
      enemySprite.setData('baseRectWidth', 48);
      enemySprite.setData('baseRectHeight', 48);
    }
  } else {
    // Use colored rectangle for enemies without sprite support
    const enemyColor = scene.getEnemyColor(enemy.name);
    enemySprite = scene.add.rectangle(0, 0, 48, 48, enemyColor);
    enemySprite.setStrokeStyle(2, 0x000000);
    enemySprite.setScale(initialSizeMultiplier);
    enemySprite.setData('baseScale', 1);
    enemySprite.setData('baseRectWidth', 48);
    enemySprite.setData('baseRectHeight', 48);
  }

  if (enemySprite && typeof enemySprite.setData === 'function') {
    const currentBaseScale = enemySprite.getData('baseScale');
    if (typeof currentBaseScale !== 'number') {
      const scaleX = (enemySprite as any).scaleX ?? 1;
      const baseScale = scaleX / initialSizeMultiplier || 1;
      enemySprite.setData('baseScale', baseScale);
    }
  }

  if (showAura) {
    if (enemySprite && (enemySprite as any).setStrokeStyle) {
      (enemySprite as any).setStrokeStyle(2, auraColor, 0.9);
    }
  } else if (enemySprite && (enemySprite as any).setStrokeStyle) {
    (enemySprite as any).setStrokeStyle(2, 0x000000, 1);
  }

  // Make enemy clickable for attacks
  if (
    enemy.spriteConfig?.interactiveWidth &&
    enemy.spriteConfig?.interactiveHeight
  ) {
    // Use interactive area from configuration. Avoid hard dependency on global Phaser.
    const scaledWidth =
      enemy.spriteConfig.interactiveWidth * initialSizeMultiplier;
    const scaledHeight =
      enemy.spriteConfig.interactiveHeight * initialSizeMultiplier;
    const halfWidth = scaledWidth / 2;
    const halfHeight = scaledHeight / 2;
    try {
      const maybePhaser: any = (globalThis as any).Phaser;
      if (
        maybePhaser &&
        maybePhaser.Geom &&
        typeof maybePhaser.Geom.Rectangle === 'function'
      ) {
        enemySprite.setInteractive(
          new maybePhaser.Geom.Rectangle(
            -halfWidth,
            -halfHeight,
            scaledWidth,
            scaledHeight
          ),
          maybePhaser.Geom.Rectangle.Contains
        );
      } else {
        // Fallback to default interactive area if Phaser isn't globally available
        enemySprite.setInteractive();
      }
    } catch {
      // Safety fallback
      enemySprite.setInteractive();
    }
  } else {
    // For other enemies, use default interactive area
    enemySprite.setInteractive();
  }

  // Add sword cursor on hover
  enemySprite.on('pointerover', () => {
    scene.input.setDefaultCursor(
      "url(\"data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' alignment-baseline='middle' font-size='20'%3E⚔️%3C/text%3E%3C/svg%3E\"), auto"
    );
  });

  enemySprite.on('pointerout', () => {
    scene.input.setDefaultCursor('auto');
  });

  enemySprite.on('pointerdown', () => {
    if (process.env.NEXT_PUBLIC_DEBUG === '1') {
      console.log('🗡️ Starting attack action on enemy:', enemyId);
    }
    // Use the new action system instead of direct attack
    scene.room?.send('startAction', {
      type: 'attack_enemy',
      targetId: enemyId,
    });

    // Optimistic local highlight of selected target for snappy feedback
    try {
      if (scene.entityManager?.hasEntity(enemyId)) {
        // Remove any previous selected indicator
        if (
          scene.currentSelectedTargetId &&
          typeof scene.clearSelectedIndicatorForEnemy === 'function'
        ) {
          scene.clearSelectedIndicatorForEnemy(scene.currentSelectedTargetId);
        }
        if (typeof scene.createSelectedIndicatorForEnemy === 'function') {
          scene.createSelectedIndicatorForEnemy(enemyId);
          scene.currentSelectedTargetId = enemyId;
        }
      }
    } catch {}
  });

  // Create enemy entity configuration using the EntityFactory
  const enemyConfig = EntityFactory.createEnemyConfig(
    scene,
    enemy,
    enemySprite,
    scene.debugEnabled || false
  );

  // Create the enemy entity using EntityManager
  const enemyContainer = scene.entityManager.createEntity(
    enemyId,
    enemy.x,
    enemy.y,
    enemyConfig
  );
  enemyContainer.setData('sizeMultiplier', initialSizeMultiplier);
  enemyContainer.setData('isElite', isElite);
  enemyContainer.setData('hasAura', showAura);
  enemyContainer.setData('auraColor', auraColor);
  if (typeof scene.registerMinimapIgnore === 'function') {
    scene.registerMinimapIgnore(enemyContainer);
  }

  // Add a visible foot-glow aura for elites (more readable than a thin circle)
  if (
    showAura &&
    scene.entityManager &&
    typeof scene.entityManager.addAuraToEntity === 'function'
  ) {
    try {
      scene.entityManager.addAuraToEntity(enemyId, {
        color: auraColorCss,
        level: 2,
      });
    } catch {}
  }

  // Track last known HP to detect damage deltas for floating numbers
  enemyContainer.setData('lastHp', enemy.hp);

  // Removed red aggro targeting indicators (ring + label)

  // Store container reference in scene.enemyEntities for compatibility
  scene.enemyEntities[enemyId] = enemyContainer;

  const applyServerState = () => {
    // Update entity position using EntityManager (this moves all elements together)
    scene.entityManager.updateEntityPosition(enemyId, enemy.x, enemy.y);

    const enemyContainer = scene.entityManager.getEntity(enemyId);
    const mainSprite = enemyContainer
      ? enemyContainer.getData('enemySprite')
      : scene.entityManager.getEntityElement(enemyId, 'enemySprite');
    const newSizeMultiplier = clampSizeMultiplier(Number(enemy.sizeMultiplier));
    const auraColor = resolveEliteAuraColorForEnemy(enemy);
    const auraColorCss = '#' + auraColor.toString(16).padStart(6, '0');
    const tags = normalizeVisualTags(enemy.visualTags);
    const hasAuraTag = tags.some(
      (tag) => tag.startsWith('aura:') || tag === 'aura:buffed'
    );
    const isEliteNow =
      Boolean(enemy.isElite) || String(enemy?.name || '').startsWith('★');
    const showAura = isEliteNow || hasAuraTag;

    if (enemyContainer) {
      if (mainSprite && typeof (mainSprite as any).setScale === 'function') {
        const baseScale = mainSprite.getData('baseScale');
        if (typeof baseScale === 'number') {
          (mainSprite as any).setScale(baseScale * newSizeMultiplier);
        } else {
          (mainSprite as any).setScale(newSizeMultiplier);
        }
      }
      if (mainSprite && (mainSprite as any).setStrokeStyle) {
        if (showAura) {
          (mainSprite as any).setStrokeStyle(2, auraColor, 0.9);
        } else if (enemy.onRoad) {
          (mainSprite as any).setStrokeStyle(3, 0x00aaff, 1);
        } else {
          (mainSprite as any).setStrokeStyle(2, 0x000000, 1);
        }
      }
      enemyContainer.setData('sizeMultiplier', newSizeMultiplier);
      enemyContainer.setData('isElite', isEliteNow);
      enemyContainer.setData('hasAura', showAura);
      enemyContainer.setData('auraColor', auraColor);
      if (
        showAura &&
        scene.entityManager &&
        typeof scene.entityManager.addAuraToEntity === 'function'
      ) {
        const existingGlow = scene.entityManager.getEntityElement(
          enemyId,
          'light'
        );
        if (!existingGlow) {
          try {
            scene.entityManager.addAuraToEntity(enemyId, {
              color: auraColorCss,
              level: 2,
            });
          } catch {}
        }
      } else if (enemyContainer) {
        const existingGlow = enemyContainer.getData('light');
        if (existingGlow && typeof existingGlow.destroy === 'function') {
          existingGlow.destroy();
        }
        enemyContainer.setData('light', null);
      }
    }

    const nameText = scene.entityManager.getEntityElement(enemyId, 'nameText');
    if (nameText) {
      nameText.setText(isEliteNow ? `★ ${enemy.name}` : enemy.name);
      if (nameText.setStyle) {
        nameText.setStyle({
          color: isEliteNow ? auraColorCss : '#ffffff',
          fontStyle: isEliteNow ? 'bold' : 'normal',
        });
      }
      if (nameText.setShadow) {
        if (isEliteNow) {
          nameText.setShadow(1, 1, '#000000', 0, true, true);
        } else {
          nameText.setShadow(0, 0, '#000000', 0, false, false);
        }
      }
      nameText.y = -35 * newSizeMultiplier;
    }

    // Update aura ability line (if present)
    const abilityText = scene.entityManager.getEntityElement(
      enemyId,
      'auraAbilitiesText'
    );
    if (abilityText) {
      const labelsNow = getAuraAbilityLabelsFromTags(enemy.visualTags);
      const labelNow = labelsNow.length > 0 ? labelsNow.join(', ') : '';
      if (typeof (abilityText as any).setText === 'function') {
        (abilityText as any).setText(labelNow);
      }
      (abilityText as any).y = -35 * newSizeMultiplier + 14;
      const auraColorNow = resolveEliteAuraColorForEnemy(enemy);
      const auraColorCssNow = '#' + auraColorNow.toString(16).padStart(6, '0');
      if ((abilityText as any).setStyle) {
        (abilityText as any).setStyle({
          color: auraColorCssNow,
        });
      }
    }

    const hpBarContainer = scene.entityManager.getEntityElement(
      enemyId,
      'hpBarContainer'
    );
    if (hpBarContainer) {
      const hpBarFill = hpBarContainer.getData('hpBarFill');
      const hpBarBg = hpBarContainer.getData('hpBarBg');
      const hpBarHeight =
        hpBarContainer.getData('hpBarHeight') || hpBarBg?.displayHeight || 6;
      const baseWidth = Math.max(
        36,
        Math.round(48 * Math.min(newSizeMultiplier, 1.6))
      );
      if (hpBarBg && typeof (hpBarBg as any).setDisplaySize === 'function') {
        (hpBarBg as any).setDisplaySize(baseWidth, hpBarHeight);
      }
      if (hpBarFill) {
        if (typeof (hpBarFill as any).setDisplaySize === 'function') {
          (hpBarFill as any).setDisplaySize(baseWidth, hpBarHeight);
        }
        hpBarFill.setData('baseWidth', baseWidth);
        if (hpBarFill.setFillStyle) {
          hpBarFill.setFillStyle(
            showAura ? auraColor : 0xaa0000,
            showAura ? 0.95 : 0.9
          );
        }
        if (hpBarFill.setPosition) {
          hpBarFill.setPosition(-baseWidth / 2, 0);
        }
        const maxHp = enemy.maxHp ?? 0;
        const hpPercent =
          maxHp > 0 ? Math.max(0, Math.min(1, enemy.hp / maxHp)) : 1;
        hpBarFill.scaleX = hpPercent;
        hpBarContainer.setVisible(hpPercent < 1);
      } else {
        hpBarContainer.setVisible(false);
      }
      hpBarContainer.y = -50 * newSizeMultiplier;
    }

    let eliteAura = scene.entityManager.getEntityElement(enemyId, 'eliteAura');
    if (showAura) {
      const desiredRadius = 36 * newSizeMultiplier;
      if (!eliteAura) {
        eliteAura = scene.add.circle(0, 0, desiredRadius);
        eliteAura.setFillStyle(auraColor, 0.18);
        eliteAura.setStrokeStyle(2, auraColor, 0.35);
        eliteAura.setDepth(-1);
        scene.entityManager.addElementToEntity(enemyId, 'eliteAura', eliteAura);
      } else {
        eliteAura.setRadius(desiredRadius);
        if (eliteAura.setFillStyle) {
          eliteAura.setFillStyle(auraColor, 0.18);
        }
        if (eliteAura.setStrokeStyle) {
          eliteAura.setStrokeStyle(2, auraColor, 0.35);
        }
      }
    } else if (eliteAura) {
      scene.entityManager.removeElementFromEntity(enemyId, 'eliteAura');
      eliteAura = null;
    }

    // Floating damage numbers when HP decreases
    if (enemyContainer) {
      const lastHp = enemyContainer.getData('lastHp') ?? enemy.hp;
      if (typeof lastHp === 'number' && enemy.hp < lastHp) {
        const damageAmount = lastHp - enemy.hp;
        const dmgText = scene.add
          .text(0, -55, `-${damageAmount}`, {
            fontSize: '16px',
            color: '#ff5555',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 3,
          })
          .setOrigin(0.5);

        // Attach to enemy container so it follows during the brief float
        enemyContainer.add(dmgText);

        // Animate upward and fade out, then destroy
        scene.tweens.add({
          targets: dmgText,
          y: -75,
          alpha: 0,
          duration: 600,
          ease: 'Cubic.easeOut',
          onComplete: () => dmgText.destroy(),
        });
      }
      // Update lastHp snapshot
      enemyContainer.setData('lastHp', enemy.hp);
    }

    // Update/create distance text for guardians
    if (
      enemy.name?.includes('Guardian') &&
      scene.room &&
      scene.room.sessionId
    ) {
      const currentPlayer = scene.playerEntities?.[scene.room.sessionId];
      if (currentPlayer) {
        let distanceText = scene.entityManager.getEntityElement(
          enemyId,
          'distanceText'
        );

        const playerDistance = Math.sqrt(
          Math.pow(currentPlayer.x - enemy.x, 2) +
            Math.pow(currentPlayer.y - enemy.y, 2)
        );
        const aggroRange = enemy.aggroRange || 96;

        // Create distance text if it doesn't exist
        if (!distanceText) {
          distanceText = scene.add
            .text(
              0, // Position relative to container
              65,
              `Dist: ${Math.floor(playerDistance)}px`,
              {
                fontSize: '10px',
                color: playerDistance <= aggroRange ? '#00ff00' : '#ff0000',
                backgroundColor: '#000000',
                padding: { x: 4, y: 2 },
              }
            )
            .setOrigin(0.5);
          scene.entityManager.addElementToEntity(
            enemyId,
            'distanceText',
            distanceText
          );
        } else {
          // Update existing distance text (no positioning needed since it's in container)
          distanceText.setText(`Dist: ${Math.floor(playerDistance)}px`);
          distanceText.setColor(
            playerDistance <= aggroRange ? '#00ff00' : '#ff0000'
          );
        }
      }
    }

    const hasAnimatedSprite =
      enemy.enemyType &&
      scene.enemySpriteManager &&
      scene.enemySpriteManager.hasEnemyConfig(enemy.enemyType);

    if (hasAnimatedSprite) {
      const animationToPlay = enemy.anim || 'idle';

      if (animationToPlay === 'death') {
        const containerWithSoundState = scene.enemyEntities[enemyId];
        if (
          containerWithSoundState &&
          !containerWithSoundState.getData('deathSoundPlayed')
        ) {
          console.log('💀 Playing enemy death sound for', enemyId);
          const deathSfxKey =
            (CLIENT_ENEMY_TYPES?.[enemy.enemyType!]?.deathSound as
              | string
              | undefined) ?? 'enemy_dead';
          scene.playSFX(deathSfxKey, 0.8);
          containerWithSoundState.setData('deathSoundPlayed', true);
        }
        // Fade out HP bar with the same transition as the enemy sprite
        const hpBarContainer = scene.entityManager.getEntityElement(
          enemyId,
          'hpBarContainer'
        );
        if (
          hpBarContainer &&
          typeof hpBarContainer.setAlpha === 'function' &&
          !hpBarContainer.getData('deathFadeStarted')
        ) {
          hpBarContainer.setData('deathFadeStarted', true);
          scene.tweens.add({
            targets: hpBarContainer,
            alpha: 0,
            duration: 1000,
            ease: 'Power2.easeOut',
          });
        }
      }

      const sprite = scene.enemySpriteManager.getEnemySprite(enemyId);
      if (sprite) {
        sprite.setFlipX(enemy.dir === 'right');
      }

      const isPortalGuardian =
        enemy.enemyType === 'portal_guardian' ||
        (enemy.name as any) === 'Portal Guardian';
      if (animationToPlay === 'death' && isPortalGuardian) {
        // Hold Portal Guardian sprite visually; final fade happens on 'boss_loot_ready'
      } else {
        scene.enemySpriteManager.playEnemyAnimation(enemyId, animationToPlay);
      }
    } else {
      if (enemy.anim === 'death') {
        const containerWithSoundState = scene.enemyEntities[enemyId];
        if (
          containerWithSoundState &&
          !containerWithSoundState.getData('deathSoundPlayed')
        ) {
          console.log('💀 Playing enemy death sound for', enemyId);
          const deathSfxKey =
            (CLIENT_ENEMY_TYPES?.[enemy.enemyType!]?.deathSound as
              | string
              | undefined) ?? 'enemy_dead';
          scene.playSFX(deathSfxKey, 0.8);
          containerWithSoundState.setData('deathSoundPlayed', true);
        }
        // Fade out HP bar even for non-animated enemies
        const hpBarContainer = scene.entityManager.getEntityElement(
          enemyId,
          'hpBarContainer'
        );
        if (
          hpBarContainer &&
          typeof hpBarContainer.setAlpha === 'function' &&
          !hpBarContainer.getData('deathFadeStarted')
        ) {
          hpBarContainer.setData('deathFadeStarted', true);
          scene.tweens.add({
            targets: hpBarContainer,
            alpha: 0,
            duration: 1000,
            ease: 'Power2.easeOut',
          });
        }
      }

      if (enemy.anim === 'hurt') {
        const enemyColor = scene.getEnemyColor(enemy.name);
        const spriteForFlash = mainSprite;
        if (spriteForFlash && !spriteForFlash.getData('originalColor')) {
          spriteForFlash.setData('originalColor', enemyColor);
        }
        const originalColor =
          spriteForFlash?.getData('originalColor') ?? enemyColor;
        if (spriteForFlash) {
          const flashSequence = [
            { delay: 0, color: 0xcc4444 },
            { delay: 150, color: originalColor },
          ];

          flashSequence.forEach((flash) => {
            setTimeout(() => {
              if (spriteForFlash.setFillStyle) {
                spriteForFlash.setFillStyle(flash.color);
              }
            }, flash.delay);
          });
        }
      }
    }
  };

  enemy.onChange(applyServerState);

  if (typeof queueMicrotask === 'function') {
    queueMicrotask(applyServerState);
  } else {
    Promise.resolve().then(applyServerState);
  }

  return enemyContainer;
}

export function renderNPCSprite(scene: any, npc: any, npcId: string) {
  console.log(
    '🎭 Creating NPC:',
    npcId,
    'character:',
    npc.characterId,
    'at',
    npc.x,
    npc.y
  );

  // EntityManager should already be initialized in GameScene
  if (!scene.entityManager) {
    console.error('EntityManager not initialized in GameScene!');
    return;
  }

  // Create character sprite for NPC using the character sprite manager
  let npcSprite;
  if (scene.characterSpriteManager) {
    // Load the character for the NPC if not already loaded
    scene.characterSpriteManager.loadCharacterForPlayer(npcId, npc.characterId);

    // Create character sprite at container's position (0,0 relative to container)
    npcSprite = scene.characterSpriteManager.createCharacterSpriteForPlayer(
      npcId,
      0, // Position relative to container
      0, // Position relative to container
      npc.characterId
    );

    // Scale up from 100px frames to 150px display for good visibility
    npcSprite.setDisplaySize(150, 150);

    // Set initial animation based on NPC state
    const initialAnimation = scene.characterSpriteManager.getAnimationKey(
      npc.anim || 'idle',
      npc.dir || 'down'
    );

    if (scene.anims.exists(initialAnimation)) {
      npcSprite.play(initialAnimation);
    }
  } else {
    // Fallback to colored rectangle if character sprite manager isn't available
    npcSprite = scene.add.rectangle(0, 0, 48, 48, 0x00ff00); // Green for NPCs
    npcSprite.setStrokeStyle(2, 0x000000);
  }

  // Make NPC clickable for dialogue
  npcSprite.setInteractive();

  // Add chat cursor on hover
  npcSprite.on('pointerover', () => {
    scene.input.setDefaultCursor(
      "url(\"data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' alignment-baseline='middle' font-size='20'%3E💬%3C/text%3E%3C/svg%3E\"), auto"
    );
  });

  npcSprite.on('pointerout', () => {
    scene.input.setDefaultCursor('auto');
  });

  npcSprite.on('pointerdown', () => {
    console.log('💬 Clicked on NPC:', npcId, npc.name);

    // Check proximity to player before allowing interaction
    const currentPlayer = scene.room
      ? scene.playerEntities[scene.room.sessionId]
      : null;
    if (!currentPlayer) return;

    const distance = Math.sqrt(
      Math.pow(currentPlayer.x - npc.x, 2) +
        Math.pow(currentPlayer.y - npc.y, 2)
    );

    const interactionRange = 100; // 100px interaction range
    if (distance > interactionRange) {
      console.log('🚫 Player too far from NPC for interaction:', distance);
      // TODO: Show "Move closer to interact" message
      return;
    }

    // Trigger NPC dialogue
    scene.room?.send('npc_interact', {
      npcId: npcId,
      dialogueId: npc.dialogueId,
    });
  });

  // Create NPC entity configuration using proper NPC factory method
  const npcConfig = EntityFactory.createNPCConfig(
    scene,
    npc,
    npcSprite,
    scene.debugEnabled || false
  );

  // Create the NPC entity using EntityManager
  const npcContainer = scene.entityManager.createEntity(
    npcId,
    npc.x,
    npc.y,
    npcConfig
  );
  if (typeof scene.registerMinimapIgnore === 'function') {
    scene.registerMinimapIgnore(npcContainer);
  }

  // Store container reference in scene.npcEntities
  scene.npcEntities[npcId] = npcContainer;

  // Listen for NPC state changes
  npc.onChange(() => {
    // Update entity position using EntityManager
    scene.entityManager.updateEntityPosition(npcId, npc.x, npc.y);

    // Update animation if character sprite manager is available
    if (scene.characterSpriteManager && npcSprite) {
      const animationKey = scene.characterSpriteManager.getAnimationKey(
        npc.anim || 'idle',
        npc.dir || 'down'
      );

      if (
        scene.anims.exists(animationKey) &&
        npcSprite.anims.currentAnim?.key !== animationKey
      ) {
        npcSprite.play(animationKey);
      }
    }
  });

  return npcContainer;
}

export function renderProjectileSprite(
  scene: any,
  projectile: any,
  projectileId: string
) {
  let projectileSprite;

  // Check if this is an enemy projectile and determine the enemy type
  if (projectile.ownerId && projectile.ownerId.startsWith('enemy_')) {
    // Find the enemy that fired this projectile
    const ownerEnemy = scene.room?.state.enemies.get(projectile.ownerId);

    if (ownerEnemy && ownerEnemy.enemyType === 'cactus') {
      // Create animated Cactus bullet sprite
      if (
        scene.enemySpriteManager &&
        scene.enemySpriteManager.hasEnemyConfig('cactus_bullet')
      ) {
        projectileSprite = scene.enemySpriteManager.createEnemySprite(
          projectileId + '_bullet',
          'cactus_bullet',
          projectile.x,
          projectile.y,
          { displayWidth: 102, displayHeight: 59 } // Larger size for better visibility
        );

        if (projectileSprite) {
          // Play the idle animation for flying bullet
          projectileSprite.play('cactus_bullet_idle');
          // Ensure projectile renders above fog overlay
          if (typeof projectileSprite.setDepth === 'function') {
            projectileSprite.setDepth(RENDER_DEPTHS.overFogProjectiles);
          }
        }
      }
    }
  }

  // Fallback to yellow circle for all other projectiles or if sprite creation failed
  if (!projectileSprite) {
    projectileSprite = scene.add.circle(
      projectile.x,
      projectile.y,
      4,
      0xffff00
    );
    if (typeof (projectileSprite as any).setDepth === 'function') {
      (projectileSprite as any).setDepth(RENDER_DEPTHS.overFogProjectiles);
    }
  }

  scene.projectileEntities[projectileId] = projectileSprite;
  return projectileSprite;
}
