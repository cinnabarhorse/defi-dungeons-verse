import type { Room, Client } from 'colyseus';
import { GameRoomState, NPCSchema } from '../../schemas';
import { GAME_CONFIG } from '../constants';
import { getCharacterById, getCharacterStats } from '../../data/characters';
import { checkObstacleCollision, isOnFloor } from './MapCollisionSystem';

interface NPCSpawnOptions {
  anchor?: { x: number; y: number };
}

export function spawnNPCs(
  room: Room<GameRoomState>,
  options?: NPCSpawnOptions
) {
  const npcConfigs = [{ characterId: 'stani', dialogueId: 'stani' }];
  npcConfigs.forEach((config, index) => {
    const npcId = `npc_${config.characterId}_${Date.now()}_${index}`;
    const npc = new NPCSchema();
    npc.id = npcId;
    npc.characterId = config.characterId;
    npc.dialogueId = config.dialogueId;

    const characterInfo = getCharacterById(config.characterId);
    npc.name = characterInfo?.name || config.characterId;

    // Prefer spawning near the first player within a radius of ~3 tiles (~100px)
    const tileSize = GAME_CONFIG.TILE_SIZE;
    const radiusTiles = 3;
    const radiusPx = radiusTiles * tileSize;
    const padding = 150;

    const pickNearPlayerPosition = () => {
      const players = Array.from(room.state.players.values());
      const anchorFromPlayers = players.length > 0 ? players[0] : null;
      const anchor =
        options?.anchor && typeof options.anchor.x === 'number'
          ? options.anchor
          : anchorFromPlayers;
      if (!anchor) return null;
      const maxAttempts = 60;
      for (let i = 0; i < maxAttempts; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * radiusPx;
        const candidateX = anchor.x + Math.cos(angle) * distance;
        const candidateY = anchor.y + Math.sin(angle) * distance;

        // Ensure the candidate is inside world bounds. We do not clamp here
        // so we never push the NPC farther than radiusPx from the player.
        if (
          candidateX < 0 ||
          candidateX > GAME_CONFIG.WORLD_WIDTH ||
          candidateY < 0 ||
          candidateY > GAME_CONFIG.WORLD_HEIGHT
        ) {
          continue;
        }

        const x = candidateX;
        const y = candidateY;
        const collides = checkObstacleCollision(room, x, y, 40);
        if (collides) continue;
        if (!isOnFloor(room, x, y)) continue;
        let farEnough = true;
        for (const [_, existingNpc] of room.state.npcs) {
          const dx = (existingNpc as any).x - x;
          const dy = (existingNpc as any).y - y;
          if (dx * dx + dy * dy < 300 * 300) {
            farEnough = false;
            break;
          }
        }
        if (!farEnough) continue;
        return { x, y };
      }
      return null;
    };

    let attempts = 0;
    let validPosition = false;
    // Try near-player placement first
    const near = pickNearPlayerPosition();
    if (near) {
      npc.x = near.x;
      npc.y = near.y;
      validPosition = true;
    }
    // Fallback to legacy random placement within world bounds
    while (!validPosition && attempts < 40) {
      npc.x = padding + Math.random() * (GAME_CONFIG.WORLD_WIDTH - 2 * padding);
      npc.y =
        padding + Math.random() * (GAME_CONFIG.WORLD_HEIGHT - 2 * padding);
      validPosition =
        !checkObstacleCollision(room, npc.x, npc.y, 40) &&
        isOnFloor(room, npc.x, npc.y);
      if (validPosition) {
        for (const [_, existingNpc] of room.state.npcs) {
          const dx = (existingNpc as any).x - npc.x;
          const dy = (existingNpc as any).y - npc.y;
          if (dx * dx + dy * dy < 300 * 300) {
            validPosition = false;
            break;
          }
        }
      }
      attempts++;
    }

    npc.dir = ['up', 'down', 'left', 'right'][
      Math.floor(Math.random() * 4)
    ] as any;
    npc.anim = 'idle';
    const stats = getCharacterStats(config.characterId);
    npc.hp = stats.maxHealth;
    npc.maxHp = stats.maxHealth;
    npc.lastAttackTime = 0;
    npc.attackType = stats.weaponType;

    room.state.npcs.set(npcId, npc);
    console.log(
      `🤖 Spawned NPC ${npc.name} (${config.characterId}) at (${Math.floor(npc.x)}, ${Math.floor(npc.y)})`
    );
  });

  console.log(`🎭 Spawned ${npcConfigs.length} NPCs in room ${room.state.id}`);
}

export function spawnNPCsFromConfigs(
  room: Room<GameRoomState>,
  configs: Array<{
    characterId: string;
    dialogueId?: string;
    x: number;
    y: number;
  }>
) {
  configs.forEach((config, index) => {
    const npcId = `npc_${config.characterId}_${Date.now()}_${index}`;
    const npc = new NPCSchema();
    npc.id = npcId;
    npc.characterId = config.characterId;
    npc.dialogueId = config.dialogueId || config.characterId;
    const characterInfo = getCharacterById(config.characterId);
    npc.name = characterInfo?.name || config.characterId;
    npc.x = config.x;
    npc.y = config.y;
    npc.dir = ['up', 'down', 'left', 'right'][
      Math.floor(Math.random() * 4)
    ] as any;
    npc.anim = 'idle';
    const stats = getCharacterStats(config.characterId);
    npc.hp = stats.maxHealth;
    npc.maxHp = stats.maxHealth;
    npc.lastAttackTime = 0;
    npc.attackType = stats.weaponType;
    room.state.npcs.set(npcId, npc);
  });
}

export function handleNPCInteraction(
  room: Room<GameRoomState>,
  client: Client,
  data: { npcId: string; dialogueId: string }
) {
  console.log(
    `🎭 NPC interaction from ${client.sessionId}: npcId=${data.npcId}, dialogueId=${data.dialogueId}`
  );

  const player = room.state.players.get(client.sessionId);
  if (!player) {
    console.warn(`❌ Player not found for session ${client.sessionId}`);
    return;
  }

  const npc = room.state.npcs.get(data.npcId);
  if (!npc) {
    console.warn(`❌ NPC not found: ${data.npcId}`);
    return;
  }

  const distance = Math.sqrt(
    Math.pow(player.x - npc.x, 2) + Math.pow(player.y - npc.y, 2)
  );
  const interactionRange = 100;
  if (distance > interactionRange) {
    console.log(
      `🚫 Player ${player.name} too far from NPC ${npc.name}: ${Math.round(distance)}px > ${interactionRange}px`
    );
    return;
  }

  (client as any).send('npc_dialogue', {
    npcId: data.npcId,
    npcName: (npc as any).name,
    npcCharacterId: (npc as any).characterId,
    dialogueId: data.dialogueId,
  });

  console.log(
    `✅ Started dialogue between ${player.name} and ${(npc as any).name} using ${data.dialogueId}`
  );
}
