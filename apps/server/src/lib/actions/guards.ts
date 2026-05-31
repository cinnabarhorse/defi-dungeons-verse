import {
  ActionType,
  type ActionTypeString,
  type ResourceActionType,
  type CombatActionType,
} from './types';
import { BaseAction } from './base';
import type { ResourceHarvestAction } from './resource';
import type { AttackEnemyAction } from './attack';

export function isResourceActionType(type: string): type is ResourceActionType {
  return type === ActionType.CHOP_TREE || type === ActionType.MINE_STONE;
}

export function isCombatActionType(type: string): type is CombatActionType {
  return type === ActionType.ATTACK_ENEMY || type === ActionType.THROW_GRENADE;
}

export function isValidActionType(type: string): type is ActionTypeString {
  return Object.values(ActionType).includes(type as ActionType);
}

export function isResourceHarvestAction(
  action: BaseAction
): action is ResourceHarvestAction {
  return isResourceActionType(action.type);
}

export function isAttackEnemyAction(
  action: BaseAction
): action is AttackEnemyAction {
  return isCombatActionType(action.type);
}
