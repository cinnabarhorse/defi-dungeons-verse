import type { PlayerSchema, EntitySchema } from '../../schemas';
import type { GameRoom } from '../../rooms/GameRoom';
import {
  ActionResult,
  type ActionUpdateResult,
  type ActionTypeString,
} from './types';

const DEBUG = process.env.DEBUG === '1';

export abstract class BaseAction {
  public readonly type: ActionTypeString;
  public readonly targetId: string;
  public readonly startTime: number;
  public readonly animation: string;
  protected lastExecuteTime: number = 0;

  constructor(
    type: ActionTypeString,
    targetId: string,
    animation: string = 'idle'
  ) {
    this.type = type;
    this.targetId = targetId;
    this.startTime = Date.now();
    this.animation = animation;
  }

  abstract update(player: PlayerSchema, gameRoom: GameRoom): ActionUpdateResult;
  abstract canStart(player: PlayerSchema, gameRoom: GameRoom): boolean;

  onStart(player: PlayerSchema, gameRoom: GameRoom): void {}

  onComplete(player: PlayerSchema, gameRoom: GameRoom): void {
    gameRoom.msg.broadcast('player_action_complete', {
      sessionId: player.id,
      timestamp: Date.now(),
      actionType: this.type,
    });
    console.log(
      `✅ Action ${this.type} completed for player ${player.name} - broadcasted to all clients`
    );
    this.clearPlayerAction(player);
  }

  onCancel(player: PlayerSchema, gameRoom: GameRoom, reason?: string): void {
    this.clearPlayerAction(player);
  }

  protected clearPlayerAction(player: PlayerSchema): void {
    player.currentAction = '';
    player.actionTarget = '';
    player.actionStartTime = 0;
    player.actionAnimation = '';
    player.anim = 'idle';
  }

  protected getTargetEntity(gameRoom: GameRoom): EntitySchema | null {
    const entity = gameRoom.state.entities.get(this.targetId);
    if (entity) return entity;
    const enemy = gameRoom.state.enemies.get(this.targetId);
    if (enemy) {
      return {
        id: enemy.id,
        kind: 'enemy' as any,
        x: enemy.x,
        y: enemy.y,
        state: JSON.stringify({
          health: enemy.hp,
          maxHealth: enemy.maxHp,
          name: enemy.name,
          attackType: enemy.attackType,
        }),
      } as EntitySchema;
    }
    return null;
  }

  protected calculateDistance(
    entity1: { x: number; y: number },
    entity2: { x: number; y: number }
  ): number {
    return Math.sqrt(
      Math.pow(entity2.x - entity1.x, 2) + Math.pow(entity2.y - entity1.y, 2)
    );
  }

  protected getDistanceToTarget(
    player: PlayerSchema,
    gameRoom: GameRoom
  ): number {
    const target = this.getTargetEntity(gameRoom);
    if (!target) return Infinity;
    return this.calculateDistance(player, target);
  }

  protected createResult(
    result: ActionResult,
    message: string
  ): ActionUpdateResult {
    return { result, message };
  }

  protected isInRange(
    player: PlayerSchema,
    gameRoom: GameRoom,
    maxDistance: number
  ): boolean {
    return this.getDistanceToTarget(player, gameRoom) <= maxDistance;
  }
}
