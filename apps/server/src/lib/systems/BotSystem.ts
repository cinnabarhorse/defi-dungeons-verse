import type { Room } from 'colyseus';
import { GameRoomState, PlayerSchema } from '../../schemas';
import { GAME_CONFIG } from '../constants';
import { syncPlayerCharacterStats } from '../player-stats';
import { isOnFloor } from './MapCollisionSystem';
import { checkObstacleCollision } from './MapCollisionSystem';

export function respawnBot(room: Room<GameRoomState>, bot: PlayerSchema) {
  syncPlayerCharacterStats(bot, { fullHeal: true });

  const padding = 100;
  let attempts = 0;
  let validPosition = false;

  while (!validPosition && attempts < 20) {
    bot.x = padding + Math.random() * (GAME_CONFIG.WORLD_WIDTH - 2 * padding);
    bot.y = padding + Math.random() * (GAME_CONFIG.WORLD_HEIGHT - 2 * padding);
    validPosition = true;
    if (!isOnFloor(room, bot.x, bot.y)) validPosition = false;
    if (checkObstacleCollision(room, bot.x, bot.y, 30)) validPosition = false;
    if (validPosition) {
      for (const [_, enemy] of room.state.enemies) {
        const distance = Math.sqrt(
          Math.pow(enemy.x - bot.x, 2) + Math.pow(enemy.y - bot.y, 2)
        );
        if (distance < 200) {
          validPosition = false;
          break;
        }
      }
    }
    attempts++;
  }

  bot.anim = 'idle';
  bot.dir = 'down';
  bot.lastMoveTime = 0;
  bot.lastAttackTime = 0;
}
