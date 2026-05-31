import type { PlayerSchema, EntitySchema } from '../../schemas';
import type { GameRoom } from '../../rooms/GameRoom';

export enum ActionType {
  CHOP_TREE = 'chop_tree',
  MINE_STONE = 'mine_stone',
  ATTACK_ENEMY = 'attack_enemy',
  THROW_GRENADE = 'throw_grenade',
}

export type ResourceActionType = ActionType.CHOP_TREE | ActionType.MINE_STONE;
export type CombatActionType =
  | ActionType.ATTACK_ENEMY
  | ActionType.THROW_GRENADE;
export type ActionTypeString = `${ActionType}`;

export enum ActionResult {
  CONTINUE = 'continue',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

export interface ActionUpdateResult {
  result: ActionResult;
  message?: string;
}
