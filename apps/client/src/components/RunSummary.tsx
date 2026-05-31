'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/Dialog';
import { Button } from './ui/Button';
import { ItemThumb } from './item-thumb';
import { formatWearableDisplayName } from '../lib/wearable-utils';
import type { InventoryItem } from '../types/inventory';

export interface RunSummaryData {
  durationMs: number;
  kills: number;
  score: number;
  floorReached: number;
  itemsPickedUp: InventoryItem[];
  leverageTotal: number;
}

interface RunSummaryProps {
  isOpen: boolean;
  data: RunSummaryData | null;
  onClose: () => void;
  onConfirm: () => void;
  onShare?: () => void;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatLeverage(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '1.0x';
  return `${n.toFixed(1)}x`;
}

function getItemDisplayName(item: InventoryItem): string {
  if (item.type === 'wearable') {
    return formatWearableDisplayName({
      quality: item.quality,
      wearableId: item.wearableId,
      wearableSlug: item.wearableSlug,
      fallbackName: item.name,
    });
  }
  return item.name || item.type || 'Unknown Item';
}

function groupItemsByType(
  items: InventoryItem[]
): Map<string, InventoryItem[]> {
  const grouped = new Map<string, InventoryItem[]>();

  for (const item of items) {
    // For wearables, include quality in the key so different qualities are separate
    const key =
      item.type === 'wearable'
        ? `${item.type}:${item.name || 'unknown'}:${item.quality || 'average'}`
        : `${item.type}:${item.name || 'unknown'}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(item);
  }

  return grouped;
}

export function RunSummary({
  isOpen,
  data,
  onClose,
  onConfirm,
  onShare,
}: RunSummaryProps) {
  const [duration, setDuration] = useState<string>('0:00');

  useEffect(() => {
    if (data && isOpen) {
      setDuration(formatDuration(data.durationMs));
    }
  }, [data, isOpen]);

  if (!data && !isOpen) {
    return null;
  }

  if (!data) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="max-w-md"
          style={{
            bottom: 'auto',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold uppercase tracking-wider text-center">
              Run Summary
            </DialogTitle>
          </DialogHeader>
          <div className="py-8 text-center text-white/70">
            Loading run data...
          </div>
          <div className="flex gap-3 pt-4">
            <Button
              variant="secondary"
              onClick={onClose}
              className="flex-1 bg-white/10 hover:bg-white/20 text-white"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const groupedItems = groupItemsByType(data.itemsPickedUp);
  const itemsArray = Array.from(groupedItems.entries()).map(([key, items]) => {
    const totalQuantity = items.reduce(
      (sum, item) => sum + (item.quantity || 1),
      0
    );
    return {
      key,
      item: items[0],
      quantity: totalQuantity,
    };
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-md"
        style={{
          bottom: 'auto',
          top: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold uppercase tracking-wider text-center">
            Run Summary
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Stats Row */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 border-b border-white/10 pb-3">
            <div className="flex flex-col items-center text-center">
              <span className="text-xs font-medium text-white/70 uppercase tracking-wider mb-1">
                Duration
              </span>
              <span className="text-lg font-bold text-white">{duration}</span>
            </div>
            <div className="flex flex-col items-center text-center">
              <span className="text-xs font-medium text-white/70 uppercase tracking-wider mb-1">
                Enemies Killed
              </span>
              <span className="text-lg font-bold text-white">
                {data.kills.toLocaleString()}
              </span>
            </div>
            <div className="flex flex-col items-center text-center">
              <span className="text-xs font-medium text-white/70 uppercase tracking-wider mb-1">
                Score
              </span>
              <span className="text-lg font-bold text-white">
                {data.score.toLocaleString()}
              </span>
            </div>
            <div className="flex flex-col items-center text-center">
              <span className="text-xs font-medium text-white/70 uppercase tracking-wider mb-1">
                Floor Reached
              </span>
              <span className="text-lg font-bold text-white">
                {data.floorReached.toLocaleString()}
              </span>
            </div>
            <div className="flex flex-col items-center text-center">
              <span className="text-xs font-medium text-white/70 uppercase tracking-wider mb-1">
                Leverage
              </span>
              <span className="text-lg font-bold text-white">
                {formatLeverage(data.leverageTotal)}
              </span>
            </div>
          </div>

          {/* Items Picked Up */}
          <div className="border-b border-white/10 pb-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-white/70 uppercase tracking-wider">
                Items Picked Up
              </span>
              <span className="text-sm font-medium text-white/70">
                {itemsArray.length}
              </span>
            </div>
            {itemsArray.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                {itemsArray.map(({ key, item, quantity }) => (
                  <div
                    key={key}
                    className="relative flex flex-col items-center justify-center text-sm bg-white/5 rounded px-2 py-2 text-center"
                  >
                    <div className="absolute top-1 right-1 bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold z-10">
                      {quantity}
                    </div>
                    <div className="mb-1">
                      <ItemThumb item={item} size="sm" />
                    </div>
                    <span className="text-white/90 text-xs truncate w-full">
                      {getItemDisplayName(item)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-white/50 italic text-center py-2">
                No items collected
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-row gap-3 pt-4">
          {onShare && (
            <Button
              variant="secondary"
              onClick={onShare}
              className="flex-1 bg-blue-500 hover:bg-blue-400 text-white font-bold"
            >
              Share Run
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={onConfirm}
            className="flex-1 bg-green-500 hover:bg-green-400 text-black font-bold"
          >
            Exit Match
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
