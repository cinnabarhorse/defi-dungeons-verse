import { getAuraAbilityLabelsFromTags } from './aura-utils';
/**
 * Unified Entity Management System
 *
 * This class provides a consistent container-based approach for managing
 * both player and enemy entities in the game. It handles:
 * - Container creation and management
 * - Element positioning relative to containers
 * - Movement synchronization
 * - Cleanup and destruction
 */

export interface EntityElement {
  name: string;
  element: Phaser.GameObjects.GameObject;
  x: number;
  y: number;
}

export interface EntityConfig {
  mainSprite: Phaser.GameObjects.GameObject;
  elements: EntityElement[];
}

export class EntityManager {
  private scene: Phaser.Scene;
  private containers: Map<string, Phaser.GameObjects.Container> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Create a soft glow aura game object. Uses PointLight if available, otherwise falls back to a subtle circle.
   */
  private createAura(
    auraHexColor: string = '#ff66cc',
    level: number = 1
  ): Phaser.GameObjects.GameObject {
    // Default to saturated pink if no color provided
    const colorString =
      auraHexColor && auraHexColor !== '#000000' ? auraHexColor : '#ff66cc';
    const colorNumber = Number(colorString.replace('#', '0x'));

    // Subtle size scaling by level
    const baseWidth = Phaser.Math.Clamp(70 + (level * 60) / 100, 48, 120);
    const baseHeight = Math.max(18, Math.floor(baseWidth * 0.42));

    // Build an oval, slightly offset towards the feet
    const auraContainer = this.scene.add.container(0, 38).setName('light');
    (auraContainer as any).setDepth?.(-100);

    const outer = this.scene.add.ellipse(
      0,
      0,
      baseWidth,
      baseHeight,
      colorNumber,
      0.22
    );
    outer.setBlendMode((Phaser as any).BlendModes?.ADD ?? 1);

    const middle = this.scene.add.ellipse(
      0,
      0,
      baseWidth * 0.78,
      baseHeight * 0.78,
      colorNumber,
      0.28
    );
    middle.setBlendMode((Phaser as any).BlendModes?.ADD ?? 1);

    const inner = this.scene.add.ellipse(
      0,
      0,
      baseWidth * 0.56,
      baseHeight * 0.56,
      colorNumber,
      0.34
    );
    inner.setBlendMode((Phaser as any).BlendModes?.ADD ?? 1);

    auraContainer.add([outer, middle, inner]);
    return auraContainer as unknown as Phaser.GameObjects.GameObject;
  }

  /**
   * Create a new entity container with all its elements
   */
  createEntity(
    entityId: string,
    x: number,
    y: number,
    config: EntityConfig
  ): Phaser.GameObjects.Container {
    // Create container
    const container = this.scene.add.container(x, y);

    // Set Y-based depth for proper layering, but clamp below the fog layer.
    // Using a very large fog depth ensures entities never render above fog.
    const { RENDER_DEPTHS } = require('./constants');
    const clampedDepth = Math.min(
      Number.isFinite(y) ? y : 0,
      (RENDER_DEPTHS?.fog ?? 100000) - 1
    );
    container.setDepth(clampedDepth);

    // Add main sprite and elements to container
    const allElements = [
      config.mainSprite,
      ...config.elements.map((e) => e.element),
    ];
    container.add(allElements);

    // Store data references on container
    container.setData('mainSprite', config.mainSprite);
    // Also store mainSprite as 'playerSprite' and 'enemySprite' for compatibility
    container.setData('playerSprite', config.mainSprite);
    container.setData('enemySprite', config.mainSprite);

    config.elements.forEach((element) => {
      container.setData(element.name, element.element);
    });

    // Store container reference
    this.containers.set(entityId, container);

    return container;
  }

  /**
   * Attach a glow aura under the entity's sprite. No-op if it already exists.
   */
  addAuraToEntity(
    entityId: string,
    options?: { color?: string; level?: number }
  ): void {
    const container = this.containers.get(entityId) as any;
    if (!container) return;

    // Detect existing aura by name or stored data
    const existingChild = (container.list || []).find(
      (c: any) => c?.name === 'light'
    );
    if (existingChild) return;

    const aura = this.createAura(
      options?.color ?? '#ffb6c1',
      options?.level ?? 1
    );

    // Ensure the aura renders beneath the main sprite within the container
    if (typeof container.addAt === 'function') container.addAt(aura, 0);
    else container.add(aura);

    container.setData('light', aura);
  }

  /**
   * Get an entity container by ID
   */
  getEntity(entityId: string): Phaser.GameObjects.Container | undefined {
    return this.containers.get(entityId);
  }

  /**
   * Update entity position (moves all elements together)
   */
  updateEntityPosition(entityId: string, x: number, y: number): void {
    const container = this.containers.get(entityId);
    if (container) {
      container.x = x;
      container.y = y;
      // Maintain Y-based depth ordering, clamped below fog overlay depth.
      const { RENDER_DEPTHS } = require('./constants');
      const clampedDepth = Math.min(
        Number.isFinite(y) ? y : 0,
        (RENDER_DEPTHS?.fog ?? 100000) - 1
      );
      container.setDepth(clampedDepth);
    }
  }

  /**
   * Get an element from an entity
   */
  getEntityElement(entityId: string, elementName: string): any {
    const container = this.containers.get(entityId);
    return container?.getData(elementName) || null;
  }

  /**
   * Add a new element to an existing entity
   */
  addElementToEntity(
    entityId: string,
    elementName: string,
    element: any
  ): void {
    const container = this.containers.get(entityId);
    if (container) {
      container.add(element);
      container.setData(elementName, element);
    }
  }

  /**
   * Remove an element from an entity
   */
  removeElementFromEntity(entityId: string, elementName: string): void {
    const container = this.containers.get(entityId);
    if (container) {
      const element = container.getData(elementName);
      if (element) {
        container.remove(element);
        element.destroy();
        container.setData(elementName, null);
      }
    }
  }

  /**
   * Destroy an entity and all its elements
   */
  destroyEntity(entityId: string): void {
    const container = this.containers.get(entityId);
    if (container) {
      container.destroy(); // This destroys all child elements automatically
      this.containers.delete(entityId);
    }
  }

  /**
   * Get all entity IDs
   */
  getAllEntityIds(): string[] {
    return Array.from(this.containers.keys());
  }

  /**
   * Check if an entity exists
   */
  hasEntity(entityId: string): boolean {
    return this.containers.has(entityId);
  }

  /**
   * Clear all entities
   */
  clearAllEntities(): void {
    this.containers.forEach((container) => {
      container.destroy();
    });
    this.containers.clear();
  }

  /**
   * Get container count for debugging
   */
  getEntityCount(): number {
    return this.containers.size;
  }
}

/**
 * Factory functions for common entity configurations
 */
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

function resolveEliteAuraColor(enemy: any): {
  colorInt: number;
  colorCss: string;
} {
  const visualTags = normalizeVisualTags(enemy?.visualTags);
  const auraTag = visualTags.find(
    (tag) => typeof tag === 'string' && tag.startsWith('aura:')
  );
  const colorInt = auraTag
    ? (ELITE_AURA_COLOR_MAP[auraTag.split(':')[1] ?? ''] ?? 0xffc14f)
    : 0xffc14f;
  const colorCss = '#' + colorInt.toString(16).padStart(6, '0');
  return { colorInt, colorCss };
}

export class EntityFactory {
  /**
   * Create a player entity configuration
   */
  static createPlayerConfig(
    scene: Phaser.Scene,
    sessionId: string,
    player: any,
    isCurrentPlayer: boolean,
    debugEnabled: boolean = false
  ): EntityConfig {
    // Create placeholder sprite
    const playerSprite = scene.add.rectangle(
      0,
      0,
      85,
      85,
      isCurrentPlayer ? 0x00ff00 : 0x8a2be2
    );
    playerSprite.setStrokeStyle(2, 0xffffff);

    // Create name text
    const nameText = scene.add
      .text(
        0,
        -40,
        isCurrentPlayer
          ? player.name || 'YOU'
          : player.name || sessionId.slice(0, 8),
        {
          fontSize: '16px',
          color: '#ffffff',
        }
      )
      .setOrigin(0.5);

    // Create direction indicator
    const directionIndicator = scene.add.triangle(
      0,
      -20,
      0,
      8,
      -4,
      -4,
      4,
      -4,
      0xffffff
    );

    // Create HP bar (above name). Only visible when not full HP
    const hpBarWidth = 52;
    const hpBarHeight = 6;
    const initialHp = typeof player.hp === 'number' ? player.hp : 100;
    const initialMaxHp = typeof player.maxHp === 'number' ? player.maxHp : 100;
    const initialPercent = Math.max(
      0,
      Math.min(1, initialMaxHp > 0 ? initialHp / initialMaxHp : 1)
    );

    const hpBarContainer = scene.add.container(0, -58);

    const hpBarBg = scene.add
      .rectangle(0, 0, hpBarWidth, hpBarHeight, 0x000000, 0.5)
      .setOrigin(0.5, 0.5);
    (hpBarBg as any).setStrokeStyle?.(1, 0xffffff, 0.6);

    const hpBarFill = scene.add
      .rectangle(-hpBarWidth / 2, 0, hpBarWidth, hpBarHeight, 0x00aa00, 0.9)
      .setOrigin(0, 0.5);
    // Set initial HP bar color based on percentage
    if (initialPercent < 0.33) {
      (hpBarFill as any).setFillStyle?.(0xaa0000, 0.9);
    } else if (initialPercent < 0.66) {
      (hpBarFill as any).setFillStyle?.(0xffcc00, 0.9);
    } else {
      (hpBarFill as any).setFillStyle?.(0x00aa00, 0.9);
    }
    (hpBarFill as any).setName?.('hpBarFill');
    hpBarFill.scaleX = initialPercent;
    hpBarFill.setData('baseWidth', hpBarWidth);

    hpBarContainer.add([hpBarBg, hpBarFill]);
    hpBarContainer.setData('hpBarFill', hpBarFill);
    hpBarContainer.setData('hpBarBg', hpBarBg);
    hpBarContainer.setData('hpBarHeight', hpBarHeight);
    hpBarContainer.setVisible(initialPercent < 1);

    return {
      mainSprite: playerSprite,
      elements: [
        { name: 'nameText', element: nameText, x: 0, y: -40 },
        {
          name: 'directionIndicator',
          element: directionIndicator,
          x: 0,
          y: -20,
        },
        { name: 'hpBarContainer', element: hpBarContainer, x: 0, y: -58 },
      ],
    };
  }

  /**
   * Create an enemy entity configuration
   */
  static createEnemyConfig(
    scene: Phaser.Scene,
    enemy: any,
    enemySprite: Phaser.GameObjects.GameObject,
    debugEnabled: boolean = false
  ): EntityConfig {
    const sizeMultiplier = Math.max(
      0.5,
      Math.min(3, Number(enemy.sizeMultiplier) || 1)
    );
    const { colorInt: auraColor, colorCss: auraColorCss } =
      resolveEliteAuraColor(enemy);
    const tags = normalizeVisualTags(enemy?.visualTags);
    const hasAuraTag = tags.some(
      (tag) => tag.startsWith('aura:') || tag === 'aura:buffed'
    );
    const abilityLabels = getAuraAbilityLabelsFromTags(enemy?.visualTags);
    const abilityLabel =
      abilityLabels.length > 0 ? abilityLabels.join(', ') : '';
    const isElite = Boolean(enemy.isElite);
    const showAura = isElite || hasAuraTag;

    // Create name text
    const eliteName = isElite ? `★ ${enemy.name}` : enemy.name;
    const nameText = scene.add
      .text(0, 0, eliteName, {
        fontSize: '14px',
        color: showAura ? auraColorCss : '#ffffff',
        fontStyle: isElite ? 'bold' : undefined,
        shadow: isElite
          ? { offsetX: 1, offsetY: 1, color: '#000000', fill: true }
          : undefined,
      })
      .setOrigin(0.5);

    // Optional: aura ability line under the name
    const abilityText =
      abilityLabel.length > 0
        ? scene.add
            .text(0, 0, abilityLabel, {
              fontSize: '11px',
              color: auraColorCss,
              backgroundColor: '#000000',
              padding: { x: 3, y: 1 },
            })
            .setOrigin(0.5)
        : null;

    // Create HP bar (above name). Only visible when not full HP
    const hpBarWidth = Math.max(
      36,
      Math.round(48 * Math.min(sizeMultiplier, 1.6))
    );
    const hpBarHeight = 6;
    const initialHp =
      typeof enemy.hp === 'number' ? enemy.hp : (enemy.maxHp ?? 1);
    const initialMaxHp = typeof enemy.maxHp === 'number' ? enemy.maxHp : 1;
    const initialPercent = Math.max(
      0,
      Math.min(1, initialMaxHp > 0 ? initialHp / initialMaxHp : 1)
    );

    const hpBarContainer = scene.add.container(0, 0);

    const hpBarBg = scene.add
      .rectangle(0, 0, hpBarWidth, hpBarHeight, 0x000000, 0.5)
      .setOrigin(0.5, 0.5);
    (hpBarBg as any).setStrokeStyle?.(1, 0xffffff, 0.6);

    const hpBarFill = scene.add
      .rectangle(-hpBarWidth / 2, 0, hpBarWidth, hpBarHeight, 0xaa0000, 0.9)
      .setOrigin(0, 0.5);
    (hpBarFill as any).setName?.('hpBarFill');
    hpBarFill.scaleX = initialPercent;
    hpBarFill.setData('baseWidth', hpBarWidth);
    if (showAura) {
      (hpBarFill as any).setFillStyle?.(auraColor, 0.95);
    }

    hpBarContainer.add([hpBarBg, hpBarFill]);
    hpBarContainer.setData('hpBarFill', hpBarFill);
    hpBarContainer.setData('hpBarBg', hpBarBg);
    hpBarContainer.setData('hpBarHeight', hpBarHeight);
    hpBarContainer.setVisible(initialPercent < 1);

    const nameOffsetY = -35 * sizeMultiplier;
    const hpBarOffsetY = -50 * sizeMultiplier;
    const abilityOffsetY = nameOffsetY + 14;

    const elements: EntityElement[] = [
      { name: 'nameText', element: nameText, x: 0, y: nameOffsetY },
      {
        name: 'hpBarContainer',
        element: hpBarContainer,
        x: 0,
        y: hpBarOffsetY,
      },
    ];

    if (abilityText) {
      elements.push({
        name: 'auraAbilitiesText',
        element: abilityText,
        x: 0,
        y: abilityOffsetY,
      });
    }

    if (showAura) {
      const auraRadius = 36 * sizeMultiplier;
      const eliteAura = scene.add.circle(0, 0, auraRadius);
      eliteAura.setFillStyle(auraColor, 0.18);
      eliteAura.setStrokeStyle(2, auraColor, 0.35);
      eliteAura.setDepth(-1);
      elements.push({ name: 'eliteAura', element: eliteAura, x: 0, y: 0 });
    }

    // Add debug elements if enabled
    if (debugEnabled) {
      const aggroRange =
        enemy.aggroRange || (enemy.attackType === 'ranged' ? 192 : 96);
      const attackRange = enemy.attackRange || 24;

      let auraColor = 0xff4444;
      if (enemy.attackType === 'ranged') auraColor = 0x4444ff;
      if (enemy.name?.includes('Guardian')) {
        auraColor = enemy.name.includes('Entrance') ? 0xffaa00 : 0xff00aa;
      }

      // Range text
      const rangeText = scene.add
        .text(0, 50, `Aggro: ${aggroRange}px | Attack: ${attackRange}px`, {
          fontSize: '9px',
          color: '#ffffff',
          backgroundColor: '#000000',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5);

      // Attack type text
      const attackTypeText = scene.add
        .text(0, -50, enemy.attackType.toUpperCase(), {
          fontSize: '10px',
          color: enemy.attackType === 'melee' ? '#ff4444' : '#4444ff',
        })
        .setOrigin(0.5);

      elements.push(
        { name: 'rangeText', element: rangeText, x: 0, y: 50 },
        { name: 'attackTypeText', element: attackTypeText, x: 0, y: -50 }
      );
    }

    return {
      mainSprite: enemySprite,
      elements,
    };
  }

  /**
   * Create an NPC entity configuration
   */
  static createNPCConfig(
    scene: Phaser.Scene,
    npc: any,
    npcSprite: Phaser.GameObjects.GameObject,
    debugEnabled: boolean = false
  ): EntityConfig {
    // Create name text above NPC (green for NPCs)
    const nameText = scene.add
      .text(0, -80, npc.name, {
        fontSize: '14px',
        color: '#00ff00', // Green for NPCs
        fontStyle: 'bold',
        backgroundColor: '#000000',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5);

    const elements: EntityElement[] = [
      { name: 'nameText', element: nameText, x: 0, y: -80 },
    ];

    // Add debug elements if enabled
    if (debugEnabled) {
      // NPC interaction range indicator
      const interactionRange = 100; // 100px interaction range

      // Interaction aura (subtle green)
      const interactionAura = scene.add.circle(0, 0, interactionRange);
      interactionAura.setStrokeStyle(2, 0x00ff00, 0.4);
      interactionAura.setFillStyle(0x00ff00, 0.1);
      interactionAura.setDepth(-1);

      // Interaction text
      const interactionText = scene.add
        .text(0, 50, `Interaction: ${interactionRange}px`, {
          fontSize: '9px',
          color: '#00ff00',
          backgroundColor: '#000000',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5);

      // NPC type text
      const npcTypeText = scene.add
        .text(0, -50, 'NPC', {
          fontSize: '10px',
          color: '#00ff00',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);

      elements.push(
        { name: 'interactionAura', element: interactionAura, x: 0, y: 0 },
        { name: 'interactionText', element: interactionText, x: 0, y: 50 },
        { name: 'npcTypeText', element: npcTypeText, x: 0, y: -50 }
      );
    }

    return {
      mainSprite: npcSprite,
      elements,
    };
  }
}
