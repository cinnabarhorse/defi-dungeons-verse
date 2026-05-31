'use client';

import { Bell, X, CheckCircle2, Info, AlertCircle } from 'lucide-react';
import type { InventoryItem } from '../types/inventory';
import { ItemThumb } from './item-thumb';
import { formatWearableDisplayName } from '../lib/wearable-utils';
import { useMemo, useEffect, useRef, useState, useCallback } from 'react';

export interface NotificationEntry {
  id: string;
  message: string;
  variant?: 'success' | 'info' | 'error';
  icon?: 'check' | 'info' | 'alert';
  showViewButton?: boolean;
  createdAt: number;
  item?: InventoryItem | null;
  emoji?: string;
}

interface NotificationDockProps {
  items: NotificationEntry[];
  isOpen: boolean;
  onToggle: () => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onViewInventory?: () => void;
}

function getIcon(
  icon: NotificationEntry['icon'],
  variant: NotificationEntry['variant']
) {
  if (icon === 'check' || variant === 'success')
    return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (icon === 'alert' || variant === 'error')
    return <AlertCircle className="h-4 w-4 text-red-400" />;
  return <Info className="h-4 w-4 text-sky-400" />;
}

function getItemClasses(variant: NotificationEntry['variant']): string {
  const base = 'flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs';
  if (variant === 'success')
    return `${base} bg-emerald-900/20 border-emerald-700/40`;
  if (variant === 'error') return `${base} bg-red-900/20 border-red-700/40`;
  return `${base} bg-slate-800/60 border-slate-700/50`;
}

export function NotificationDock({
  items,
  isOpen,
  onToggle,
  onDismiss,
  onClearAll,
  onViewInventory,
}: NotificationDockProps) {
  const count = items.length;
  const title = useMemo(
    () => (count ? `Notifications (${count})` : 'Notifications'),
    [count]
  );

  // Auto-dismiss notifications after 5 seconds
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Track items currently fading out
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());

  const DISMISS_ANIM_MS = 300;

  // Track post-fade removal timers to avoid double-scheduling and leaks
  const removalTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  const startDismiss = useCallback(
    (id: string) => {
      // Clear any pending auto-dismiss timer for this id
      const timers = timersRef.current;
      const existing = timers.get(id);
      if (existing) {
        clearTimeout(existing);
        timers.delete(id);
      }

      setDismissingIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      // Always ensure a removal is scheduled after fade
      const removalTimers = removalTimersRef.current;
      if (!removalTimers.has(id)) {
        const rmId = setTimeout(() => {
          removalTimers.delete(id);
          onDismiss(id);
        }, DISMISS_ANIM_MS);
        removalTimers.set(id, rmId);
      }
    },
    [onDismiss]
  );

  useEffect(() => {
    const timers = timersRef.current;
    const now = Date.now();

    // Schedule timers for any new items
    for (const n of items) {
      if (timers.has(n.id)) continue;
      const elapsed = now - n.createdAt;
      const remaining = Math.max(0, 5000 - elapsed);
      const timeoutId = setTimeout(() => {
        timers.delete(n.id);
        startDismiss(n.id);
      }, remaining);
      timers.set(n.id, timeoutId);
    }

    // Clear timers for items that were removed (e.g., dismissed/cleared)
    for (const [id, timeoutId] of Array.from(timers.entries())) {
      if (!items.some((n) => n.id === id)) {
        clearTimeout(timeoutId);
        timers.delete(id);
      }
    }

    // Also clear any pending post-fade removal timers for ids that no longer exist
    const removalTimers = removalTimersRef.current;
    for (const [id, timeoutId] of Array.from(removalTimers.entries())) {
      if (!items.some((n) => n.id === id)) {
        clearTimeout(timeoutId);
        removalTimers.delete(id);
      }
    }
  }, [items, onDismiss, startDismiss]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      const timers = timersRef.current;
      for (const [, timeoutId] of timers) clearTimeout(timeoutId);
      timers.clear();

      const removalTimers = removalTimersRef.current;
      for (const [, timeoutId] of removalTimers) clearTimeout(timeoutId);
      removalTimers.clear();
    };
  }, []);

  // Prune dismissingIds for any items that no longer exist
  useEffect(() => {
    setDismissingIds((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(items.map((i) => i.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [items]);

  const handleClearAll = useCallback(() => {
    // Mark all current items as dismissing and clear any timers
    const timers = timersRef.current;
    for (const n of items) {
      const t = timers.get(n.id);
      if (t) clearTimeout(t);
      timers.delete(n.id);
    }
    setDismissingIds((prev) => {
      const next = new Set(prev);
      for (const n of items) next.add(n.id);
      return next;
    });
    // Clear any pending removal timers; we'll clear in bulk
    const removalTimers = removalTimersRef.current;
    for (const [id, timeoutId] of Array.from(removalTimers.entries())) {
      clearTimeout(timeoutId);
      removalTimers.delete(id);
    }
    setTimeout(() => {
      onClearAll();
    }, DISMISS_ANIM_MS);
  }, [items, onClearAll]);

  return (
    <>
      {(!isOpen || items.length === 0) && (
        <button
          onClick={onToggle}
          aria-label="Open notifications"
          className="fixed top-20 right-4 z-[60] h-9 rounded-md bg-slate-900/80 border border-slate-700/60 px-3 text-slate-200 hover:bg-slate-800/80 shadow"
        >
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            <span className="text-xs">{count}</span>
          </div>
        </button>
      )}

      {isOpen && items.length > 0 && (
        <div className="fixed top-24 right-4 z-[60] w-80 max-w-[85vw] bg-slate-900/90 border border-slate-700/60 rounded-lg shadow-xl text-slate-100 backdrop-blur-sm">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Bell className="h-4 w-4" />
              <span>{title}</span>
            </div>
            <div className="flex items-center gap-2">
              {count > 0 && (
                <button
                  className="text-xs text-slate-300 hover:text-slate-100"
                  onClick={handleClearAll}
                >
                  Clear all
                </button>
              )}
              <button
                aria-label="Close notifications"
                onClick={onToggle}
                className="rounded-md p-1 hover:bg-slate-800/70"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-2 space-y-2">
            {items.length === 0 ? (
              <div className="text-xs text-slate-400 px-1 py-4 text-center">
                No notifications yet.
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={
                    `${getItemClasses(n.variant)} transition-opacity duration-300 ease-out ` +
                    (dismissingIds.has(n.id) ? 'opacity-0' : 'opacity-100')
                  }
                >
                  {n.item ? (
                    <ItemThumb item={n.item} size="xs" />
                  ) : n.emoji ? (
                    <div className="mt-[2px]" aria-hidden="true">
                      <span className="text-base leading-none">{n.emoji}</span>
                    </div>
                  ) : (
                    <div className="mt-[2px]">{getIcon(n.icon, n.variant)}</div>
                  )}
                  <div className="flex-1 leading-snug">
                    <div>
                      {n.item && n.item.type === 'wearable'
                        ? formatWearableDisplayName({
                            quality: n.item.quality,
                            wearableId: n.item.wearableId,
                            wearableSlug: n.item.wearableSlug,
                            fallbackName: n.message,
                          })
                        : n.message}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    {onViewInventory && n.showViewButton && (
                      <button
                        onClick={onViewInventory}
                        className="rounded bg-slate-800/80 hover:bg-slate-800 px-2 py-1 text-[10px] border border-slate-700/60"
                      >
                        View
                      </button>
                    )}
                    <button
                      onClick={() => startDismiss(n.id)}
                      aria-label="Dismiss notification"
                      className="rounded p-1 hover:bg-slate-800/70"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
