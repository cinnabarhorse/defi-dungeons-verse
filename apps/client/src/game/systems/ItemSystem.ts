import type { InventoryItem } from '../../types/inventory';

export class ItemSystem {
  private scene: any;

  constructor(scene: any) {
    this.scene = scene;
  }

  // NOTE: This ItemSystem is responsible for:
  // 1. Item usage/consumption (useItem method)
  // 2. Item pickup handling (pickupItem method)
  // 3. Item-related utilities and management
  //
  // Items and treasure chests are SPAWNED BY THE SERVER ONLY
  // and rendered when received via Colyseus room.state.entities

  spawnInitialItems() {
    console.log(
      'ItemSystem: Items and treasure chests are server-managed only'
    );
    console.log(
      'ItemSystem: Waiting for server entities via room.state.entities...'
    );

    // NO client-side spawning. All items and treasure chests come from the server.
    // Server entities are handled in the room.state.entities.onAdd listener
    // in the LocalGameScene (see page.tsx around line 1672 for treasure chests)
  }

  // Client-side spawning methods removed - all items and treasure chests are now server-managed
  // Server spawns via MapGenerator.ts and sends entities via room.state.entities
  // Client renders received entities in page.tsx room.state.entities.onAdd listener

  // Method to handle item pickup (called from GameScene)
  pickupItem(itemId: string): InventoryItem | null {
    const item = this.scene.droppedItemEntities[itemId];
    if (!item) return null;

    console.log(`Picking up item ${itemId} of type ${item.type}`);

    // Remove sprite (and star indicator if it exists)
    if (item.sprite) {
      const starIndicator = item.sprite.getData('starIndicator');
      if (starIndicator) starIndicator.destroy();
      item.sprite.destroy();
    }

    // Remove from tracking
    delete this.scene.droppedItemEntities[itemId];

    // Return the prepared item data that was created in renderCollectible
    return item.itemData;
  }

  // Method to handle item usage (called from UI)
  useItem(
    item: InventoryItem,
    onItemUsed?: (itemId: string, quantity: number) => void
  ): boolean {
    console.log(`ItemSystem: Using item ${item.name} of type ${item.type}`);

    // Handle different item types
    switch (item.type) {
      case 'potion':
        // Send heal message to server via scene room
        if (this.scene.room) {
          const name = String(item.name ?? '').toLowerCase();
          if (name.includes('mana')) {
            this.scene.room.send('use_mana_potion');
            console.log('🔮 Used mana potion - sent mana restore request');
          } else {
            this.scene.room.send('use_health_potion');
            console.log('🍷 Used health potion - sent health potion request');
          }

          // Notify caller to remove item from inventory
          if (onItemUsed) {
            onItemUsed(item.id, 1);
          }
          return true;
        } else {
          console.log('Cannot use potion - not connected to game room');
          return false;
        }

      case 'weapon':
        // TODO: Implement weapon equipping logic
        console.log('🗡️ Equipping weapon logic not yet implemented');
        return false;

      case 'material':
        if (item.name.toLowerCase().includes('gem')) {
          // TODO: Implement gem usage (crafting, enhancement, etc.)
          console.log('💎 Gem usage logic not yet implemented');
          return false;
        } else if (item.name.toLowerCase().includes('wood')) {
          // TODO: Implement wood usage (crafting, building, etc.)
          console.log('🪵 Wood usage logic not yet implemented');
          return false;
        } else if (item.name.toLowerCase().includes('stone')) {
          // TODO: Implement stone usage (crafting, building, etc.)
          console.log('🪨 Stone usage logic not yet implemented');
          return false;
        }
        break;

      case 'coin':
        // Coins are typically not "used" directly, they're currency
        console.log('💰 Coins cannot be used directly');
        return false;

      default:
        console.log(`Cannot use item of type: ${item.type}`);
        return false;
    }

    return false;
  }

  // Cleanup method
  destroy() {
    console.log('ItemSystem: Cleaning up items...');

    // Clean up all spawned items
    Object.values(this.scene.droppedItemEntities).forEach((item: any) => {
      if (item.sprite) {
        item.sprite.destroy();
      }
    });

    Object.values(this.scene.treasureChestEntities).forEach((chest: any) => {
      if (chest.sprite) {
        chest.sprite.destroy();
      }
    });

    this.scene.droppedItemEntities = {};
    this.scene.treasureChestEntities = {};
  }
}
