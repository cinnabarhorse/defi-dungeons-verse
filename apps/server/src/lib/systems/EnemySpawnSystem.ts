import type { Room } from 'colyseus';
import { GameRoomState, EnemySchema, PlayerSchema } from '../../schemas';
import { GAME_CONFIG, DEBUG_LOGS } from '../constants';
import {
  getRoomEnemyDifficultyMultipliers,
  snapshotEnemyDifficultyBase,
} from '../enemy-difficulty';
import { ENEMY_TYPES, getEnemyStats, EliteArchetype } from '../../data/enemies';
import * as ENEMY_DATA_MOD from '../../data/enemies';
import { getDifficultyTier } from '../../data/difficulty-tiers';
import type { AuraEffect } from './AuraSystem';
import type { AbilityReference } from '../../data/characters';
import {
  isSpawnPositionSafe,
  findNearestSafePosition,
  findRandomSafePosition,
  findRandomSafeFloorPosition,
  checkObstacleCollision,
  isOnFloor,
} from './MapCollisionSystem';

export function applyDifficultyScaling(
  room: Room<GameRoomState>,
  baseStats: any
): any {
  const difficultyTier = getDifficultyTier(room.state.difficultyTier);
  const healthMultiplier = difficultyTier?.enemyHealthMultiplier ?? 1;
  const damageMultiplier = difficultyTier?.enemyDamageMultiplier ?? 1;
  const speedMultiplier = difficultyTier?.enemySpeedMultiplier ?? 1;
  const aggroMultiplier = difficultyTier?.enemyAggroRangeMultiplier ?? 1;

  const baseHealth = Math.max(
    1,
    Number(baseStats.health ?? baseStats.maxHealth ?? 1)
  );
  const baseMaxHealth = Math.max(
    1,
    Number(baseStats.maxHealth ?? baseStats.health ?? 1)
  );
  const baseDamage = Math.max(0, Number(baseStats.damage ?? 0));
  const baseSpeed = Number(baseStats.speed ?? 0);
  const baseAggroRange = Math.max(0, Number(baseStats.aggroRange ?? 0));

  const tierHealth = Math.round(baseHealth * healthMultiplier);
  const tierMaxHealth = Math.round(baseMaxHealth * healthMultiplier);
  const tierDamage = Math.round(baseDamage * damageMultiplier);
  const tierSpeed = baseSpeed * speedMultiplier;

  const meterMultipliers = getRoomEnemyDifficultyMultipliers(room.state);
  const scaledMaxHealth = Math.max(
    1,
    Math.round(tierMaxHealth * meterMultipliers.hpMultiplier)
  );
  const scaledHealth = Math.max(
    1,
    Math.round(tierHealth * meterMultipliers.hpMultiplier)
  );
  const scaledDamage = Math.max(
    0,
    Math.round(tierDamage * meterMultipliers.damageMultiplier)
  );
  const scaledSpeed = tierSpeed * Math.max(0, meterMultipliers.speedMultiplier || 1);

  return {
    ...baseStats,
    health: Math.min(scaledMaxHealth, scaledHealth),
    maxHealth: scaledMaxHealth,
    damage: scaledDamage,
    speed: scaledSpeed,
    aggroRange: Math.round(baseAggroRange * aggroMultiplier),
  };
}

interface SpawnEnemyOptions {
  minDistanceFromOthers?: number;
  /** When true, do not add the enemy to room.state.enemies; caller must add */
  deferAddToState?: boolean;
  /** Optional fields to assign BEFORE adding to state so the initial snapshot includes them */
  initial?: {
    isElite?: boolean;
    eliteArchetypeId?: string;
    leaderId?: string;
    sizeMultiplier?: number;
    visualTags?: string[];
    namePrefix?: string;
  };
}

const ABILITY_THREAT_WEIGHTS: Record<string, number> = {
  'life-steal': 1.0,
  evade: 1.2,
  elite_minion_aura: 1.4,
};

export interface EliteChunkInfo {
  anchorX: number;
  anchorY: number;
  widthTiles: number;
  heightTiles: number;
  worldWidthPx: number;
  worldHeightPx: number;
  ports?: Array<{
    side: 'N' | 'S' | 'E' | 'W';
    centerOffsetTiles?: number;
    widthTiles?: number;
  }>;
  gridX?: number;
  gridY?: number;
  tags?: string[];
}

export interface SpawnEliteGroupOptions {
  chunk: EliteChunkInfo;
  archetype: EliteArchetype;
  rng: () => number;
  roomTier: string;
  leaderPositionHint?: { x: number; y: number };
}

export interface EliteSpawnGroupResult {
  leader: EnemySchema;
  minions: EnemySchema[];
}

export function spawnEnemyOfType(
  room: Room<GameRoomState>,
  enemyType: string,
  forcePosition?: { x: number; y: number },
  options?: SpawnEnemyOptions
) {
  const enemyId = `enemy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  if (room.state.enemies.has(enemyId)) return null;

  const baseEnemyStats = getEnemyStats(enemyType);
  const enemyStats = applyDifficultyScaling(room, baseEnemyStats);
  const meterMultipliers = getRoomEnemyDifficultyMultipliers(room.state);

  const enemy = new EnemySchema();
  enemy.id = enemyId;
  enemy.name = enemyStats.name;

  if (typeof (enemy as any).attackCooldownMs !== 'number') {
    (enemy as any).attackCooldownMs = 800;
  }

  const padding = 64;
  const minDistanceFromOthers = Math.max(
    0,
    typeof options?.minDistanceFromOthers === 'number'
      ? options.minDistanceFromOthers
      : 100
  );

  if (forcePosition) {
    if (
      isSpawnPositionSafe(
        room,
        forcePosition.x,
        forcePosition.y,
        minDistanceFromOthers
      )
    ) {
      enemy.x = forcePosition.x;
      enemy.y = forcePosition.y;
    } else {
      const adjusted = findNearestSafePosition(
        room,
        forcePosition.x,
        forcePosition.y,
        minDistanceFromOthers
      );
      if (adjusted) {
        enemy.x = adjusted.x;
        enemy.y = adjusted.y;
      } else {
        const randomSafe = findRandomSafePosition(
          room,
          padding,
          minDistanceFromOthers,
          25
        );
        if (randomSafe) {
          enemy.x = randomSafe.x;
          enemy.y = randomSafe.y;
        } else {
          return null;
        }
      }
    }
  } else {
    // Prefer sampling from floor tiles to spread across traversable map surface
    const floorSample = findRandomSafeFloorPosition(
      room,
      minDistanceFromOthers,
      200
    );
    if (floorSample) {
      enemy.x = floorSample.x;
      enemy.y = floorSample.y;
    } else {
      const randomSafe = findRandomSafePosition(
        room,
        padding,
        minDistanceFromOthers,
        50
      );
      if (randomSafe) {
        enemy.x = randomSafe.x;
        enemy.y = randomSafe.y;
      } else {
        const centerX = GAME_CONFIG.WORLD_WIDTH / 2;
        const centerY = GAME_CONFIG.WORLD_HEIGHT / 2;
        const adjusted = findNearestSafePosition(
          room,
          centerX,
          centerY,
          minDistanceFromOthers
        );
        if (adjusted) {
          enemy.x = adjusted.x;
          enemy.y = adjusted.y;
        } else {
          return null;
        }
      }
    }
  }

  enemy.hp = enemyStats.health;
  enemy.maxHp = enemyStats.maxHealth;
  enemy.damage = enemyStats.damage;
  enemy.projectileSpeed = enemyStats.projectileSpeed || 200;
  enemy.rangedAttackSpeed = enemyStats.rangedAttackSpeed || 2000;
  enemy.enemyType = enemyStats.enemyType;
  enemy.speed = enemyStats.speed;
  enemy.dir = 'down';
  enemy.anim = 'idle';
  enemy.attackType = enemyStats.attackType;
  enemy.aggroRange = enemyStats.aggroRange;
  enemy.attackRange = enemyStats.attackRange;
  enemy.isAttacking = false;
  enemy.targetPlayerId = '';
  enemy.lastAttackTime = 0;
  enemy.moveTimer = 0;
  enemy.nextMoveTime = Date.now() + Math.random() * 2000 + 1000;
  enemy.targetX = enemy.x;
  enemy.targetY = enemy.y;

  // Apply ranged reload/burst config generically if present in stats
  {
    const reloadMs = (enemyStats as any).reloadDurationMs;
    const magSize = (enemyStats as any).rangedMagazineSize;
    const hasReloadCfg =
      Number.isFinite(reloadMs) &&
      Number(reloadMs) > 0 &&
      Number.isFinite(magSize) &&
      Number(magSize) > 0;
    if (hasReloadCfg) {
      (enemy as any).reloadDurationMs = Number(reloadMs);
      (enemy as any).rangedMagazineSize = Number(magSize);
      (enemy as any).isReloading = false;
      (enemy as any).reloadUntil = 0;
      (enemy as any).shotsFiredInBurst = 0;
    }
  }

  // Precompute melee lifesteal percent from abilities for this enemy type
  try {
    const base = ENEMY_TYPES?.[enemy.enemyType];
    const abilities: Array<{ id: string; params?: any }> =
      base?.abilities || [];
    let totalLifeSteal = 0;
    for (const a of abilities) {
      if (a?.id === 'life-steal') {
        const params = a.params || {};
        const appliesTo = params.appliesTo || 'melee';
        if (appliesTo === 'melee' || appliesTo === 'all') {
          const pct = typeof params.percent === 'number' ? params.percent : 0;
          totalLifeSteal += pct;
        }
      }
    }
    enemy.lifeStealMeleePct = Math.max(0, totalLifeSteal);
    if (typeof (enemy as any)._baseLifeStealMeleePct !== 'number') {
      (enemy as any)._baseLifeStealMeleePct = enemy.lifeStealMeleePct;
    }
  } catch {}

  // Attach ability definitions for runtime ability handlers
  try {
    const abilityRefs = Array.isArray(enemyStats.abilities)
      ? enemyStats.abilities
          .map((ability: { id?: string; params?: Record<string, any> }) => {
            const id =
              ability && typeof ability.id === 'string'
                ? ability.id.trim()
                : '';
            if (!id) return null;
            const params =
              ability && ability.params && typeof ability.params === 'object'
                ? { ...ability.params }
                : undefined;
            return { id, params };
          })
          .filter(
            (
              entry: { id: string; params?: Record<string, any> } | null
            ): entry is { id: string; params?: Record<string, any> } =>
              Boolean(entry)
          )
      : [];
    (enemy as any)._abilityRefs = abilityRefs;
  } catch {
    (enemy as any)._abilityRefs = [];
  }

  // Apply optional initial fields before the first state set
  if (options?.initial) {
    const init = options.initial;
    if (typeof init.isElite === 'boolean') enemy.isElite = init.isElite;
    if (typeof init.eliteArchetypeId === 'string')
      enemy.eliteArchetypeId = init.eliteArchetypeId;
    if (typeof init.leaderId === 'string') enemy.leaderId = init.leaderId;
    if (typeof init.sizeMultiplier === 'number')
      enemy.sizeMultiplier = Math.max(0.5, init.sizeMultiplier);
    if (Array.isArray(init.visualTags) && init.visualTags.length > 0) {
      try {
        setVisualTags(enemy as any, init.visualTags);
      } catch {}
    }
    // For elite leaders, assign a random themed leader name; otherwise, hide name for non-boss trash
    if (
      enemy.isElite === true &&
      (init.leaderId === 'self' || enemy.leaderId === 'self')
    ) {
      try {
        const randomEliteName = (ENEMY_DATA_MOD as any)
          .getRandomEliteNameForType
          ? (ENEMY_DATA_MOD as any).getRandomEliteNameForType(enemy.enemyType)
          : undefined;
        const fallbackName = `${enemyStats.name} the Unbound`;
        enemy.name = (randomEliteName || fallbackName) as any;
      } catch {}
    }
  }

  // Hide names for non-elites except special boss types (e.g., Portal Guardian)
  if (!enemy.isElite && enemy.enemyType !== 'portal_guardian') {
    enemy.name = '' as any;
  }

  if (!options?.deferAddToState) {
    room.state.enemies.set(enemy.id, enemy);
  }

  snapshotEnemyDifficultyBase(enemy, meterMultipliers);
  return enemy;
}

function setVisualTags(enemy: EnemySchema, tags: string[]): void {
  const visualTags = enemy.visualTags as any;
  if (!visualTags) return;
  visualTags.length = 0;
  const unique = new Set<string>();
  for (const tag of tags) {
    if (typeof tag === 'string' && tag.length > 0) {
      unique.add(tag);
    }
  }
  for (const tag of unique) {
    visualTags.push(tag);
  }
}

function computeThreatScore(archetype: EliteArchetype): number {
  const base = Math.max(1, Number(archetype.baseThreatWeight) || 1);
  let bonus = 0;
  for (const ability of archetype.abilityIds || []) {
    bonus += ABILITY_THREAT_WEIGHTS[ability.id] ?? 0.8;
  }
  return Math.round((base + bonus) * 10) / 10;
}

function getDoorPositions(
  chunk: EliteChunkInfo,
  tileSize: number
): Array<{ x: number; y: number }> {
  if (!Array.isArray(chunk.ports) || chunk.ports.length === 0) {
    return [];
  }
  const widthPx = chunk.worldWidthPx;
  const heightPx = chunk.worldHeightPx;
  const positions: Array<{ x: number; y: number }> = [];
  for (const port of chunk.ports) {
    const offset = Math.max(0, (port.centerOffsetTiles ?? 0) * tileSize);
    switch (port.side) {
      case 'N':
        positions.push({ x: chunk.anchorX + offset, y: chunk.anchorY });
        break;
      case 'S':
        positions.push({
          x: chunk.anchorX + offset,
          y: chunk.anchorY + heightPx,
        });
        break;
      case 'W':
        positions.push({ x: chunk.anchorX, y: chunk.anchorY + offset });
        break;
      case 'E':
        positions.push({
          x: chunk.anchorX + widthPx,
          y: chunk.anchorY + offset,
        });
        break;
      default:
        break;
    }
  }
  return positions;
}

function isWithinChunkBounds(
  chunk: EliteChunkInfo,
  x: number,
  y: number,
  margin: number
): boolean {
  const minX = chunk.anchorX + margin;
  const maxX = chunk.anchorX + chunk.worldWidthPx - margin;
  const minY = chunk.anchorY + margin;
  const maxY = chunk.anchorY + chunk.worldHeightPx - margin;
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

function distanceSquared(
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function isNearDoor(
  doors: Array<{ x: number; y: number }>,
  x: number,
  y: number,
  thresholdSq: number
): boolean {
  for (const door of doors) {
    if (distanceSquared(door.x, door.y, x, y) <= thresholdSq) {
      return true;
    }
  }
  return false;
}

function hasEnemyConflict(
  room: Room<GameRoomState>,
  x: number,
  y: number,
  minDistance: number,
  ignoreIds?: Set<string>
): boolean {
  const minDistanceSq = minDistance * minDistance;
  for (const [enemyId, enemy] of room.state.enemies) {
    if (ignoreIds && ignoreIds.has(enemyId)) continue;
    if (distanceSquared(enemy.x, enemy.y, x, y) < minDistanceSq) {
      return true;
    }
  }
  return false;
}

function computeDesiredMinionCount(
  archetype: EliteArchetype,
  rng: () => number
): number {
  const minCount = Math.max(0, Math.floor(archetype.minMinions ?? 0));
  const maxCount = Math.max(
    minCount,
    Math.floor(archetype.maxMinions ?? minCount)
  );
  if (maxCount === minCount) {
    return minCount;
  }
  const spread = maxCount - minCount + 1;
  return minCount + Math.floor(rng() * spread);
}

function generateMinionPositions(
  room: Room<GameRoomState>,
  chunk: EliteChunkInfo,
  leader: EnemySchema,
  desiredCount: number,
  rng: () => number,
  doorPositions: Array<{ x: number; y: number }>,
  tileSize: number,
  maxFormationAttempts: number,
  baseRingRadiusTiles: number
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  if (desiredCount <= 0) return positions;
  const attempts = Math.max(1, maxFormationAttempts);
  const baseRadius = Math.max(tileSize * 3, baseRingRadiusTiles * tileSize);
  const doorThresholdSq = Math.pow(tileSize * 2.2, 2);
  const leaderSpacing = tileSize * 1.1;
  const minSpacing = tileSize * 0.9;
  let extraRadius = 0;
  let targetCount = desiredCount;

  for (
    let attempt = 0;
    attempt < attempts && positions.length < targetCount;
    attempt++
  ) {
    positions.length = 0;
    const radius = baseRadius + extraRadius;
    for (let i = 0; i < targetCount; i++) {
      let success = false;
      for (let tries = 0; tries < 10; tries++) {
        const angle = rng() * Math.PI * 2;
        const distance = radius * (0.8 + rng() * 0.35);
        const candidateX = leader.x + Math.cos(angle) * distance;
        const candidateY = leader.y + Math.sin(angle) * distance;

        if (
          !isWithinChunkBounds(chunk, candidateX, candidateY, tileSize * 0.75)
        )
          continue;
        if (!isOnFloor(room, candidateX, candidateY)) continue;
        if (
          checkObstacleCollision(room, candidateX, candidateY, tileSize * 0.6)
        )
          continue;
        if (
          distanceSquared(candidateX, candidateY, leader.x, leader.y) <
          leaderSpacing * leaderSpacing
        )
          continue;
        if (
          doorPositions.length &&
          isNearDoor(doorPositions, candidateX, candidateY, doorThresholdSq)
        )
          continue;
        if (
          hasEnemyConflict(
            room,
            candidateX,
            candidateY,
            tileSize * 0.9,
            new Set([leader.id])
          )
        )
          continue;
        if (
          positions.some(
            (pos) =>
              distanceSquared(pos.x, pos.y, candidateX, candidateY) <
              minSpacing * minSpacing
          )
        )
          continue;

        positions.push({ x: candidateX, y: candidateY });
        success = true;
        break;
      }
      if (!success) {
        break;
      }
    }

    if (positions.length === targetCount) {
      break;
    }

    extraRadius += tileSize * 0.5;

    if (
      attempt === attempts - 2 &&
      positions.length >= Math.max(3, Math.floor(targetCount * 0.6))
    ) {
      targetCount = positions.length;
      break;
    }
  }

  return positions;
}

function applyEliteLeaderModifiers(
  leader: EnemySchema,
  scaledStats: any,
  archetype: EliteArchetype
): void {
  const healthMultiplier = Math.max(1, Number(archetype.healthMultiplier) || 1);
  const damageMultiplier = Math.max(1, Number(archetype.damageMultiplier) || 1);
  const speedMultiplier = Math.max(0.5, Number(archetype.speedMultiplier) || 1);
  const sizeMultiplier = Math.max(1, Number(archetype.sizeMultiplier) || 1);

  const maxHp = Math.max(1, Math.round(scaledStats.health * healthMultiplier));
  leader.maxHp = maxHp;
  leader.hp = maxHp;
  leader.damage = Math.max(
    1,
    Math.round(scaledStats.damage * damageMultiplier)
  );
  leader.speed = scaledStats.speed * speedMultiplier;
  leader.sizeMultiplier = sizeMultiplier;
  leader.isElite = true;
  leader.eliteArchetypeId = archetype.id;
  leader.leaderId = leader.id;
  leader.rewardMultiplier = Math.max(
    1,
    Number(archetype.rewardMultiplier) || 1.5
  );
  leader.threatScore = computeThreatScore(archetype);

  const tags = ['elite', 'elite:leader', ...(archetype.visualTags || [])];
  setVisualTags(leader, tags);
  (leader as any)._baseDamage = leader.damage;
  (leader as any)._baseSpeed = leader.speed;
  const baseCooldown = Math.max(
    200,
    Number((leader as any).attackCooldownMs) || 800
  );
  (leader as any)._baseAttackCooldownMs = baseCooldown;
  (leader as any).attackCooldownMs = baseCooldown;
  if (typeof (leader as any)._baseLifeStealMeleePct !== 'number') {
    (leader as any)._baseLifeStealMeleePct = leader.lifeStealMeleePct || 0;
  }
}

function applyEliteMinionModifiers(
  minion: EnemySchema,
  _scaledStats: any,
  _archetype: EliteArchetype,
  leader: EnemySchema
): void {
  minion.leaderId = leader.id;

  if (typeof (minion as any)._baseDamage !== 'number') {
    (minion as any)._baseDamage = minion.damage;
  }
  if (typeof (minion as any)._baseSpeed !== 'number') {
    (minion as any)._baseSpeed = minion.speed;
  }
  if (typeof (minion as any)._baseAttackCooldownMs !== 'number') {
    const baseCooldown = Math.max(
      200,
      Number((minion as any).attackCooldownMs) || 800
    );
    (minion as any)._baseAttackCooldownMs = baseCooldown;
  }
  if (typeof (minion as any)._baseLifeStealMeleePct !== 'number') {
    (minion as any)._baseLifeStealMeleePct =
      typeof minion.lifeStealMeleePct === 'number'
        ? minion.lifeStealMeleePct
        : 0;
  }
}

function spawnEliteGroup(
  room: Room<GameRoomState>,
  options: SpawnEliteGroupOptions
): EliteSpawnGroupResult | null {
  const { chunk, archetype, rng } = options;
  if (!chunk || !archetype || typeof rng !== 'function') {
    return null;
  }

  const meterMultipliers = getRoomEnemyDifficultyMultipliers(room.state);

  console.log(
    'spawning elite group:',
    options.chunk.gridX,
    options.chunk.gridY
  );

  const abilityParamsById = new Map<string, Record<string, any>>();
  for (const ability of archetype.abilityIds || []) {
    abilityParamsById.set(ability.id, ability.params || {});
  }

  const leaderSelfAbilities: AbilityReference[] = [];

  const tileSize = GAME_CONFIG.TILE_SIZE;
  const widthTiles = Math.max(
    1,
    Math.floor(chunk.widthTiles ?? chunk.worldWidthPx / tileSize)
  );
  const heightTiles = Math.max(
    1,
    Math.floor(chunk.heightTiles ?? chunk.worldHeightPx / tileSize)
  );
  const worldWidthPx = Math.max(
    tileSize,
    chunk.worldWidthPx || widthTiles * tileSize
  );
  const worldHeightPx = Math.max(
    tileSize,
    chunk.worldHeightPx || heightTiles * tileSize
  );
  const anchorX = chunk.anchorX ?? 0;
  const anchorY = chunk.anchorY ?? 0;

  const boundsMargin = tileSize * 1.25;
  if (worldWidthPx <= boundsMargin * 2 || worldHeightPx <= boundsMargin * 2) {
    return null;
  }

  const doorPositions = getDoorPositions(chunk, tileSize);
  const leaderIgnoreDoorsSq = Math.pow(tileSize * 2.2, 2);

  let leaderPosition = options.leaderPositionHint || null;
  if (
    leaderPosition &&
    !isWithinChunkBounds(
      chunk,
      leaderPosition.x,
      leaderPosition.y,
      boundsMargin
    )
  ) {
    leaderPosition = null;
  }

  const maxLeaderAttempts = Math.max(3, GAME_CONFIG.maxFormationAttempts || 6);
  for (
    let attempt = 0;
    !leaderPosition && attempt < maxLeaderAttempts;
    attempt++
  ) {
    const candidate =
      attempt === 0
        ? {
            x: anchorX + worldWidthPx / 2,
            y: anchorY + worldHeightPx / 2,
          }
        : {
            x:
              anchorX +
              boundsMargin +
              rng() * Math.max(1, worldWidthPx - boundsMargin * 2),
            y:
              anchorY +
              boundsMargin +
              rng() * Math.max(1, worldHeightPx - boundsMargin * 2),
          };

    if (!isWithinChunkBounds(chunk, candidate.x, candidate.y, boundsMargin))
      continue;
    if (!isOnFloor(room, candidate.x, candidate.y)) continue;
    if (checkObstacleCollision(room, candidate.x, candidate.y, tileSize * 0.8))
      continue;
    if (
      doorPositions.length &&
      isNearDoor(doorPositions, candidate.x, candidate.y, leaderIgnoreDoorsSq)
    )
      continue;
    if (!isSpawnPositionSafe(room, candidate.x, candidate.y, tileSize * 2))
      continue;

    leaderPosition = candidate;
  }

  if (!leaderPosition) {
    return null;
  }

  const baseStats = getEnemyStats(archetype.leaderEnemyTypeId);
  const scaledStats = applyDifficultyScaling(room, baseStats);

  const leader = spawnEnemyOfType(
    room,
    archetype.leaderEnemyTypeId,
    leaderPosition,
    {
      minDistanceFromOthers: tileSize * 1.5,
      deferAddToState: true,
      initial: {
        isElite: true,
        eliteArchetypeId: archetype.id,
        leaderId: 'self',
        sizeMultiplier: Math.max(1, Number(archetype.sizeMultiplier) || 1),
        visualTags: ['elite', 'elite:leader', ...(archetype.visualTags || [])],
        namePrefix: '★ ',
      },
    }
  );
  if (!leader) {
    return null;
  }

  if (DEBUG_LOGS) console.log('leader:', leader.id);

  // Apply elite leader modifiers immediately so initial state reflects elite visuals and stats
  applyEliteLeaderModifiers(leader, scaledStats, archetype);
  snapshotEnemyDifficultyBase(leader, meterMultipliers);
  // Name prefix handled client-side; do not add symbols here
  // Normalize leaderId 'self' to real id and add after modifiers
  if ((leader as any).leaderId === 'self') (leader as any).leaderId = leader.id;
  if (!Array.isArray((leader as any)._auraSources)) {
    (leader as any)._auraSources = [];
  }
  // Add the leader after modifiers so clients receive elite fields in onAdd snapshot
  room.state.enemies.set(leader.id, leader);

  const lifestealParams = abilityParamsById.get('life-steal');
  if (lifestealParams) {
    const percent = Math.max(0, Number(lifestealParams.percent) || 0);
    if (percent > 0) {
      leaderSelfAbilities.push({
        id: 'life-steal',
        params: {
          percent,
          appliesTo:
            typeof lifestealParams.appliesTo === 'string'
              ? lifestealParams.appliesTo
              : 'melee',
          maxPerHit:
            typeof lifestealParams.maxPerHit === 'number'
              ? lifestealParams.maxPerHit
              : undefined,
        },
      });
    }
  }

  const evadeParams = abilityParamsById.get('evade');
  if (evadeParams) {
    const chance = Math.max(0, Math.min(1, Number(evadeParams.chance) || 0));
    const cooldownMs = Math.max(
      0,
      Number(evadeParams.internalCooldownMs) ||
        Number(evadeParams.cooldownMs) ||
        0
    );
    if (chance > 0) {
      leaderSelfAbilities.push({
        id: 'evade',
        params: { chance, cooldownMs },
      });
    }
  }

  if (leaderSelfAbilities.length > 0) {
    const auraSources = (leader as any)._auraSources as AuraEffect[];
    auraSources.push({
      id: 'elite_leader_passives',
      radiusPx: 0,
      abilities: leaderSelfAbilities,
    });
  }

  const auraParams = abilityParamsById.get('elite_minion_aura');
  if (auraParams) {
    const radiusTiles = Math.max(
      1,
      Number(auraParams.radiusTiles) || GAME_CONFIG.minionRingRadiusTiles || 4
    );
    const auraTag = (archetype.visualTags || []).find(
      (tag) => typeof tag === 'string' && tag.startsWith('aura:')
    );
    const auraAbilities: AbilityReference[] = [];

    const moveSpeedMultiplier = Math.max(
      0,
      Number(auraParams.moveSpeedMultiplier) || 1
    );
    if (moveSpeedMultiplier && moveSpeedMultiplier !== 1) {
      auraAbilities.push({
        id: 'move-speed',
        params: { multiplier: moveSpeedMultiplier },
      });
    }

    const damageMultiplier = Math.max(
      0,
      Number(auraParams.damageMultiplier) || 1
    );
    if (damageMultiplier && damageMultiplier !== 1) {
      auraAbilities.push({
        id: 'damage-multiplier',
        params: { multiplier: damageMultiplier, appliesTo: 'all' },
      });
    }

    const attackSpeedMultiplier = Math.max(
      0,
      Number(auraParams.attackSpeedMultiplier) || 1
    );
    if (attackSpeedMultiplier && attackSpeedMultiplier !== 1) {
      auraAbilities.push({
        id: 'attack-speed',
        params: { multiplier: attackSpeedMultiplier },
      });
    }

    const damageReductionPercent = Math.max(
      0,
      Math.min(0.8, Number(auraParams.damageReduction) || 0)
    );
    if (damageReductionPercent > 0) {
      auraAbilities.push({
        id: 'damage-reduction',
        params: { armor: Math.round(damageReductionPercent * 100) },
      });
    }

    const regenPerSecond = Math.max(0, Number(auraParams.regenPerSecond) || 0);
    if (regenPerSecond > 0) {
      auraAbilities.push({
        id: 'regen',
        params: { perSecond: regenPerSecond },
      });
    }

    const auraEffect: AuraEffect = {
      id: 'elite_minion_aura',
      radiusPx: radiusTiles * GAME_CONFIG.TILE_SIZE,
      abilities: auraAbilities,
      visualTag: typeof auraTag === 'string' ? auraTag : undefined,
    };

    const auraSources = (leader as any)._auraSources as AuraEffect[];
    auraSources.push(auraEffect);
  }

  const minions: EnemySchema[] = [];
  const desiredMinions = computeDesiredMinionCount(archetype, rng);

  if (desiredMinions > 0) {
    const minionPositions = generateMinionPositions(
      room,
      chunk,
      leader,
      desiredMinions,
      rng,
      doorPositions,
      tileSize,
      Math.max(2, GAME_CONFIG.maxFormationAttempts || 6),
      Math.max(3, GAME_CONFIG.minionRingRadiusTiles || 4)
    );

    for (let idx = 0; idx < minionPositions.length; idx++) {
      const position = minionPositions[idx];
      const minionTypeIds =
        archetype.minionTypeIds && archetype.minionTypeIds.length > 0
          ? archetype.minionTypeIds
          : [archetype.leaderEnemyTypeId];
      const minionType = minionTypeIds[idx % minionTypeIds.length];

      const minion = spawnEnemyOfType(room, minionType, position, {
        minDistanceFromOthers: tileSize * 0.8,
        deferAddToState: true,
        initial: {
          leaderId: leader.id,
        },
      });
      if (!minion) {
        continue;
      }

      applyEliteMinionModifiers(minion, scaledStats, archetype, leader);
      snapshotEnemyDifficultyBase(minion, meterMultipliers);
      room.state.enemies.set(minion.id, minion);
      if (minion.name && !minion.name.endsWith('(minion)')) {
        minion.name = `${minion.name}` as any;
      }
      minions.push(minion);
    }
  }

  (leader as any)._eliteMeta = {
    archetypeId: archetype.id,
    abilityIds: (archetype.abilityIds || []).map((ability) => ({
      id: ability.id,
      params: ability.params ? { ...ability.params } : undefined,
    })),
  };

  if (DEBUG_LOGS)
    console.log(
      `🛡️ Spawned elite ${archetype.label} with ${minions.length} minions at (${leader.x.toFixed(0)}, ${leader.y.toFixed(0)})`
    );

  return { leader, minions };
}

export { spawnEliteGroup };

export function getRandomEnemyType(): string {
  const enemyTypes = Object.keys(ENEMY_TYPES).filter(
    (type) => type !== 'portal_guardian'
  );
  return enemyTypes[Math.floor(Math.random() * enemyTypes.length)];
}

export function setPlayerSpawnPosition(
  room: Room<GameRoomState>,
  player: PlayerSchema
) {
  const worldWidth = GAME_CONFIG.WORLD_WIDTH;
  const worldHeight = GAME_CONFIG.WORLD_HEIGHT;
  const tileSize = GAME_CONFIG.TILE_SIZE;
  const eliteMinTiles = Math.max(
    0,
    Number((GAME_CONFIG as any).playerSpawnMinDistanceFromElites) || 0
  );
  const eliteMinDistancePx = eliteMinTiles * tileSize;

  const isFarFromEliteLeaders = (x: number, y: number, minDistPx: number) => {
    if (minDistPx <= 0) return true;
    const minDistSq = minDistPx * minDistPx;
    for (const [_, enemy] of room.state.enemies) {
      const isLeader = Boolean(enemy.isElite) && enemy.leaderId === enemy.id;
      if (!isLeader) continue;
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      if (dx * dx + dy * dy < minDistSq) return false;
    }
    return true;
  };

  // Helper to clamp and finalize a spawn position with basic nudge if colliding or off-floor
  const finalizeSpawn = (baseX: number, baseY: number) => {
    const clamp = (v: number, min: number, max: number) =>
      Math.max(min, Math.min(max, v));
    player.x = clamp(baseX, 50, worldWidth - 50);
    player.y = clamp(baseY, 50, worldHeight - 50);
    player.dir = 'down';

    const collisionRadius = 40;
    if (
      checkObstacleCollision(room, player.x, player.y, collisionRadius) ||
      !isOnFloor(room, player.x, player.y) ||
      !isFarFromEliteLeaders(player.x, player.y, eliteMinDistancePx)
    ) {
      let attempts = 0;
      const maxAttempts = 18;
      const offsetDistance = Math.max(50, eliteMinDistancePx > 0 ? 64 : 50);
      while (
        attempts < maxAttempts &&
        (checkObstacleCollision(room, player.x, player.y, collisionRadius) ||
          !isOnFloor(room, player.x, player.y) ||
          !isFarFromEliteLeaders(player.x, player.y, eliteMinDistancePx))
      ) {
        const angle = (attempts / maxAttempts) * Math.PI * 2;
        const nx = baseX + Math.cos(angle) * offsetDistance;
        const ny = baseY + Math.sin(angle) * offsetDistance;
        player.x = clamp(nx, 50, worldWidth - 50);
        player.y = clamp(ny, 50, worldHeight - 50);
        attempts++;
      }
    }
  };

  // Gather spawn points and chunk layout metadata
  let spawnPoints: Array<{ x: number; y: number }> = [];
  let layout: Array<{ x: number; y: number; chunkName: string }> = [];
  let chunkSize: { widthPx: number; heightPx: number } | null = null;
  try {
    const gameRoom: any = room;
    if (
      gameRoom.mapGenerator &&
      typeof gameRoom.mapGenerator.getSpawnPoints === 'function'
    ) {
      spawnPoints = gameRoom.mapGenerator.getSpawnPoints();
      if (typeof gameRoom.mapGenerator.getChunkPixelSize === 'function') {
        chunkSize = gameRoom.mapGenerator.getChunkPixelSize();
      }
    }
    if (Array.isArray(gameRoom.chunkLayoutData)) {
      layout = gameRoom.chunkLayoutData as Array<{
        x: number;
        y: number;
        chunkName: string;
      }>; // dungeon layout used by GameRoom
    } else if (Array.isArray(gameRoom.dungeonChunkLayoutData)) {
      layout = gameRoom.dungeonChunkLayoutData as Array<{
        x: number;
        y: number;
        chunkName: string;
      }>;
    }
  } catch {}

  // Allowed cells are those generated from room-base blueprints (enemy-room family)
  const allowedCells = new Set<string>();
  if (layout && layout.length > 0) {
    for (const cell of layout) {
      const name = String(cell.chunkName || '');
      if (name.startsWith('enemy-room')) {
        allowedCells.add(`${cell.x},${cell.y}`);
      }
    }
  }

  const widthPx = Math.max(0, chunkSize?.widthPx || 0);
  const heightPx = Math.max(0, chunkSize?.heightPx || 0);
  const cellKeyForPoint = (x: number, y: number): string | null => {
    if (!widthPx || !heightPx) return null;
    const gx = Math.floor(x / widthPx);
    const gy = Math.floor(y / heightPx);
    return `${gx},${gy}`;
  };

  // Prefer explicit spawn points, filtered to allowed cells when available
  if (spawnPoints.length > 0) {
    let candidates = spawnPoints;
    if (allowedCells.size > 0 && widthPx && heightPx) {
      candidates = spawnPoints.filter((pt) => {
        const key = cellKeyForPoint(pt.x, pt.y);
        return key ? allowedCells.has(key) : false;
      });
    }
    const filtered = eliteMinDistancePx
      ? candidates.filter((pt) =>
          isFarFromEliteLeaders(pt.x, pt.y, eliteMinDistancePx)
        )
      : candidates;
    const pool = filtered.length > 0 ? filtered : candidates;
    if (pool.length > 0) {
      const selected = pool[Math.floor(Math.random() * pool.length)];
      finalizeSpawn(selected.x, selected.y);
      return;
    }
  }

  // If we reach here, no authored spawn point was found/usable
  throw new Error(
    'EnemySpawnSystem: No authored player spawn points found or usable in dungeon layout.'
  );
}
