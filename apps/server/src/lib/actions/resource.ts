import type { EntitySchema, PlayerSchema } from '../../schemas';
import type { GameRoom } from '../../rooms/GameRoom';
import { getResourceConfig } from '../resource-config';
import { BaseInteractiveAction } from './interactive';
import type { ResourceActionType } from './types';

export class ResourceHarvestAction extends BaseInteractiveAction {
  private readonly resourceType: string;
  private readonly config: any;

  constructor(
    actionType: ResourceActionType,
    targetId: string,
    resourceType: string
  ) {
    const config = getResourceConfig(resourceType);
    if (!config) throw new Error(`Unknown resource type: ${resourceType}`);
    super(actionType, targetId, {
      interval: config.harvestInterval,
      range: config.harvestRange,
      emoji: config.emoji,
      actionVerb: config.actionVerb,
      animation: 'attack',
    });
    this.resourceType = resourceType;
    this.config = config;
  }

  validateTarget(target: EntitySchema): boolean {
    if (target.kind !== 'obstacle') {
      console.warn(`${this.emoji} Entity ${this.targetId} is not an obstacle`);
      return false;
    }
    const resourceState = JSON.parse(target.state || '{}');
    if (resourceState.type !== this.config.type) {
      console.warn(
        `${this.emoji} Entity ${this.targetId} is not a ${this.config.type}`
      );
      return false;
    }
    return true;
  }

  canStartInteraction(): boolean {
    // Additional checks performed in validateTarget
    return true;
  }

  performInteraction(player: PlayerSchema, gameRoom: GameRoom) {
    const success = gameRoom.performResourceHarvest(
      player.id,
      this.targetId,
      this.resourceType
    );
    if (!success) {
      return {
        result: 'failed',
        message: `${this.config.type} ${this.actionVerb} failed`,
      } as any;
    }
    const resource = (this as any).getTargetEntity(gameRoom);
    if (!resource) {
      return {
        result: 'completed',
        message: `${this.config.type} was ${this.actionVerb}`,
      } as any;
    }
    const resourceState = JSON.parse(resource.state || '{}');
    if (resourceState.health <= 0) {
      return {
        result: 'completed',
        message: `${this.config.type} was ${this.actionVerb}`,
      } as any;
    }
    return { result: 'continue' } as any;
  }
}
