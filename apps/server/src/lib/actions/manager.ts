import type { PlayerSchema } from '../../schemas';
import type { GameRoom } from '../../rooms/GameRoom';
import { BaseAction } from './base';
import { ActionResult, type ActionUpdateResult } from './types';
import { isEntityStunned } from '../systems/StatusSystem';

export class ActionManager {
  private activeActions = new Map<string, BaseAction>();

  startAction(
    player: PlayerSchema,
    action: BaseAction,
    gameRoom: GameRoom
  ): boolean {
    this.cancelAction(player, gameRoom, 'Starting new action');
    if (isEntityStunned(player, Date.now())) {
      console.warn(
        `⏳ Action ${action.type} blocked for player ${player.name} (stunned)`
      );
      return false;
    }
    if (!action.canStart(player, gameRoom)) {
      console.warn(
        `❌ Action ${action.type} cannot start for player ${player.name}`
      );
      return false;
    }
    player.currentAction = action.type;
    player.actionTarget = action.targetId;
    player.actionStartTime = action.startTime;
    player.actionAnimation = action.animation;
    this.activeActions.set(player.id, action);
    action.onStart(player, gameRoom);

    return true;
  }

  private clearPlayerActionState(player: PlayerSchema): void {
    player.currentAction = '';
    player.actionTarget = '';
    player.actionStartTime = 0;
    player.actionAnimation = '';
  }

  cancelAction(
    player: PlayerSchema,
    gameRoom: GameRoom,
    reason?: string
  ): boolean {
    const action = this.activeActions.get(player.id);
    if (!action) return false;
    this.activeActions.delete(player.id);
    action.onCancel(player, gameRoom, reason);
    return true;
  }

  updateActions(gameRoom: GameRoom): void {
    for (const [sessionId, action] of this.activeActions) {
      const player = gameRoom.state.players.get(sessionId);
      if (!player) {
        this.activeActions.delete(sessionId);
        continue;
      }
      if (isEntityStunned(player, Date.now())) {
        this.activeActions.delete(sessionId);
        this.clearPlayerActionState(player);
        action.onCancel(player, gameRoom, 'Stunned');
        continue;
      }
      const result = action.update(player, gameRoom);
      switch (result.result) {
        case ActionResult.COMPLETED:
          this.activeActions.delete(sessionId);
          this.clearPlayerActionState(player);
          action.onComplete(player, gameRoom);
          break;
        case ActionResult.CANCELLED:
        case ActionResult.FAILED:
          this.activeActions.delete(sessionId);
          this.clearPlayerActionState(player);
          action.onCancel(player, gameRoom, result.message);
          break;
        case ActionResult.CONTINUE:
          break;
      }
    }
  }

  getPlayerAction(player: PlayerSchema): BaseAction | null {
    return this.activeActions.get(player.id) || null;
  }

  hasActiveAction(player: PlayerSchema): boolean {
    return this.activeActions.has(player.id);
  }
}
