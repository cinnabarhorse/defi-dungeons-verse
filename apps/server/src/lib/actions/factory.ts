import { BaseAction } from './base';
import { ResourceHarvestAction } from './resource';
import { AttackEnemyAction } from './attack';
import { ActionType, type ActionTypeString } from './types';
import { isValidActionType } from './guards';

interface CreateActionOptions {
  derivedStats?: Record<string, any> | null;
}

export class ActionFactory {
  static createAction(
    type: string,
    targetId: string | undefined,
    characterId?: string,
    weaponType?: string,
    payload?: any,
    options?: CreateActionOptions
  ): BaseAction | null {
    if (!isValidActionType(type)) {
      console.warn(
        `❌ Invalid action type: "${type}". Valid types: ${Object.values(ActionType).join(', ')}`
      );
      return null;
    }
    return ActionFactory.createTypedAction(
      type as ActionTypeString,
      targetId,
      characterId,
      weaponType,
      payload,
      options
    );
  }

  private static createTypedAction(
    type: ActionTypeString,
    targetId: string | undefined,
    characterId?: string,
    weaponType?: string,
    payload?: any,
    options?: CreateActionOptions
  ): BaseAction {
    switch (type) {
      case ActionType.CHOP_TREE:
        if (!targetId) {
          console.warn('🌲 Missing targetId for chop_tree action');
        }
        return new ResourceHarvestAction(
          ActionType.CHOP_TREE,
          targetId ?? '',
          'tree'
        );
      case ActionType.MINE_STONE:
        if (!targetId) {
          console.warn('🪨 Missing targetId for mine_stone action');
        }
        return new ResourceHarvestAction(
          ActionType.MINE_STONE,
          targetId ?? '',
          'stone'
        );
      case ActionType.ATTACK_ENEMY:
        if (!targetId) {
          console.warn('⚔️ Missing targetId for attack_enemy action');
        }
        return new AttackEnemyAction(
          ActionType.ATTACK_ENEMY,
          targetId ?? '',
          weaponType || 'melee',
          characterId,
          options
        );
      case ActionType.THROW_GRENADE: {
        const { ThrowGrenadeAction } = require('./throw-grenade');
        return new ThrowGrenadeAction(payload);
      }
      default:
        // @ts-expect-error exhaustive checking
        const exhaustiveCheck: never = type;
        throw new Error(`Unhandled action type: ${exhaustiveCheck}`);
    }
  }
}
