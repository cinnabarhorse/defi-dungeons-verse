import type { PlayerSchema, EntitySchema } from '../../schemas';
import type { GameRoom } from '../../rooms/GameRoom';
import { BaseAction } from './base';
import {
  ActionResult,
  type ActionUpdateResult,
  type ActionTypeString,
} from './types';
import type { Animation } from '../../types';

const DEBUG = process.env.DEBUG === '1';

export abstract class BaseInteractiveAction extends BaseAction {
  protected lastInteractionTime: number = 0;
  protected readonly interactionInterval: number;
  protected readonly interactionRange: number;
  protected readonly emoji: string;
  protected readonly actionVerb: string;
  protected interactionCount: number = 0;
  protected lastTargetX: number = 0;
  protected lastTargetY: number = 0;
  protected lastPathfindTime: number = 0;

  constructor(
    actionType: ActionTypeString,
    targetId: string,
    config: {
      interval: number;
      range: number;
      emoji: string;
      actionVerb: string;
      animation?: string;
    }
  ) {
    super(actionType, targetId, config.animation || 'idle');
    this.interactionInterval = config.interval;
    this.interactionRange = config.range;
    this.emoji = config.emoji;
    this.actionVerb = config.actionVerb;
  }

  // Default effective approach range equals configured interactionRange.
  // Subclasses may override to add a small buffer or other constraints.
  protected getEffectiveRange(
    _player: PlayerSchema,
    _gameRoom: GameRoom
  ): number {
    return this.interactionRange;
  }

  abstract canStartInteraction(
    player: PlayerSchema,
    gameRoom: GameRoom
  ): boolean;
  abstract performInteraction(
    player: PlayerSchema,
    gameRoom: GameRoom
  ): ActionUpdateResult;
  abstract validateTarget(target: EntitySchema): boolean;

  canStart(player: PlayerSchema, gameRoom: GameRoom): boolean {
    const target = this.getTargetEntity(gameRoom);
    if (!target) {
      console.warn(`${this.emoji} Target ${this.targetId} not found`);
      return false;
    }
    if (!this.validateTarget(target)) return false;
    return this.canStartInteraction(player, gameRoom);
  }

  onStart(player: PlayerSchema, gameRoom: GameRoom): void {
    super.onStart(player, gameRoom);
    this.lastInteractionTime = 0;
    const effectiveRange = this.getEffectiveRange(player, gameRoom);
    if (!this.isInRange(player, gameRoom, effectiveRange)) {
      this.startPathfindingToTarget(player, gameRoom);
    }
  }

  update(player: PlayerSchema, gameRoom: GameRoom): ActionUpdateResult {
    const target = this.getTargetEntity(gameRoom);
    if (!target) {
      return this.createResult(ActionResult.COMPLETED, 'Target was destroyed');
    }
    // If the target has health metadata and is already dead, complete the action immediately
    try {
      const targetState = target.state ? JSON.parse(target.state) : {};
      if (typeof targetState.health === 'number' && targetState.health <= 0) {
        return this.createResult(ActionResult.COMPLETED, 'Target is dead');
      }
    } catch {}
    const effectiveRange = this.getEffectiveRange(player, gameRoom);
    const playerDistance = this.getDistanceToTarget(player, gameRoom);

    if (playerDistance > effectiveRange && !player.isAutoWalking) {
      // Target is out of range and we're not currently auto-walking → re-path to target
      this.startPathfindingToTarget(player, gameRoom);
      return this.createResult(ActionResult.CONTINUE, '');
    }
    if (player.isAutoWalking) {
      const now = Date.now();
      const repathInterval = 1000;
      if (now - this.lastPathfindTime > repathInterval) {
        const targetMovedDistance = Math.sqrt(
          Math.pow(target.x - this.lastTargetX, 2) +
            Math.pow(target.y - this.lastTargetY, 2)
        );
        if (targetMovedDistance > 32) {
          console.log(
            `🎯 Target ${this.targetId} moved ${targetMovedDistance.toFixed(1)} pixels, re-pathing...`
          );
          this.startPathfindingToTarget(player, gameRoom);
          return { result: ActionResult.CONTINUE };
        }
      }
      if (this.isInRange(player, gameRoom, effectiveRange)) {
        player.isAutoWalking = false;
        player.currentPath = '';
        player.targetX = -1;
        player.targetY = -1;
        console.log(
          `${this.emoji} Player ${player.name} reached target ${this.targetId}, starting to ${this.actionVerb}`
        );
      }
      return this.createResult(ActionResult.CONTINUE, '');
    }
    if (this.isInRange(player, gameRoom, effectiveRange)) {
      return this.performTimedInteraction(player, gameRoom);
    }
    const followDistance = this.getDistanceToTarget(player, gameRoom);
    if (followDistance > effectiveRange) {
      console.log(
        `🏃 Target ${this.targetId} is ${followDistance.toFixed(1)} pixels away (effectiveRange=${effectiveRange}), starting to follow...`
      );
      this.startPathfindingToTarget(player, gameRoom);
      return this.createResult(ActionResult.CONTINUE, '');
    }
    return this.createResult(
      ActionResult.CANCELLED,
      'Player out of range and unable to path'
    );
  }

  protected performTimedInteraction(
    player: PlayerSchema,
    gameRoom: GameRoom
  ): ActionUpdateResult {
    const now = Date.now();
    if (now - this.lastInteractionTime < this.interactionInterval) {
      return this.createResult(ActionResult.CONTINUE, '');
    }
    const target = this.getTargetEntity(gameRoom);
    if (target) {
      const dx = target.x - player.x;
      const dy = target.y - player.y;
      if (Math.abs(dx) > Math.abs(dy)) {
        player.dir = dx > 0 ? 'right' : 'left';
      } else {
        player.dir = dy > 0 ? 'down' : 'up';
      }
    }
    try {
      this.lastInteractionTime = now;
      this.interactionCount++;
      player.anim = this.animation as Animation;

      if (this.type !== 'attack_enemy') {
        gameRoom.msg.broadcast('player_action_animation', {
          sessionId: player.id,
          timestamp: now,
          direction: player.dir,
          actionType: this.type,
          animation: this.animation,
          targetId: this.targetId,
          interval: this.interactionInterval,
          weaponType: (this as any).weaponType || 'melee',
          characterId: player.characterId,
        });
      }
      if (DEBUG) {
        console.log(
          `${this.emoji} BaseInteractiveAction: Player ${player.name} ${this.actionVerb} target ${this.targetId} (${this.actionVerb} #${this.interactionCount})`
        );
      }
      return this.performInteraction(player, gameRoom);
    } catch (error) {
      console.error(`❌ Error during ${this.actionVerb}:`, error);
      return {
        result: ActionResult.FAILED,
        message: `${this.actionVerb} failed due to error`,
      };
    }
  }

  onCancel(player: PlayerSchema, gameRoom: GameRoom, reason?: string): void {
    super.onCancel(player, gameRoom, reason);
    if (player.isAutoWalking) {
      player.isAutoWalking = false;
      player.currentPath = '';
      player.targetX = -1;
      player.targetY = -1;
    }
    if (DEBUG) {
      console.log(
        `${this.emoji} BaseInteractiveAction cancelled: Player ${player.name} stopped ${this.actionVerb} after ${this.interactionCount} attempts`
      );
    }
  }

  protected startPathfindingToTarget(
    player: PlayerSchema,
    gameRoom: GameRoom
  ): void {
    const target = this.getTargetEntity(gameRoom);
    if (!target) return;
    this.lastTargetX = target.x;
    this.lastTargetY = target.y;
    this.lastPathfindTime = Date.now();
    if (DEBUG) {
      console.log(
        `🗺️ Starting pathfinding for player ${player.name} to ${this.actionVerb} target ${this.targetId} at (${target.x}, ${target.y})`
      );
    }
    gameRoom.movePlayerTo?.(player.id, { x: target.x, y: target.y }, true);
  }
}
