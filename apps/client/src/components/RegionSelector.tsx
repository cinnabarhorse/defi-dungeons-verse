'use client';

import { useState, useImperativeHandle, forwardRef } from 'react';
import { Globe, Wifi, Clock } from 'lucide-react';
import { Button } from './ui/Button';
import { cn } from '../lib/utils';

export interface ServerRegion {
  id: string;
  name: string;
  location: string;
  flag: string;
  serverUrl: string;
  ping?: number;
  status: 'online' | 'offline' | 'checking';
}

interface RegionSelectorProps {
  selectedRegion: string;
  onRegionSelect: (regionId: string) => void;
  regions: ServerRegion[];
  className?: string;
}

export interface RegionSelectorRef {
  checkAllPings: () => Promise<void>;
}

export const RegionSelector = forwardRef<RegionSelectorRef, RegionSelectorProps>(
  ({ selectedRegion, onRegionSelect, regions, className }, ref) => {
  const [pings, setPings] = useState<Record<string, number>>({});
  const [pingStatus, setPingStatus] = useState<
    Record<string, 'checking' | 'done' | 'error'>
  >({});

  const checkPing = async (region: ServerRegion) => {
    setPingStatus((prev) => ({ ...prev, [region.id]: 'checking' }));

    try {
      const startTime = Date.now();
      const response = await fetch(`${region.serverUrl}/health`, {
        method: 'GET',
        mode: 'cors',
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (response.ok) {
        const endTime = Date.now();
        const ping = endTime - startTime;
        setPings((prev) => ({ ...prev, [region.id]: ping }));
        setPingStatus((prev) => ({ ...prev, [region.id]: 'done' }));
      } else {
        setPingStatus((prev) => ({ ...prev, [region.id]: 'error' }));
      }
    } catch (error) {
      console.warn(`Failed to ping ${region.name}:`, error);
      setPingStatus((prev) => ({ ...prev, [region.id]: 'error' }));
    }
  };

  const checkAllPings = async () => {
    const promises = regions.map((region) => checkPing(region));
    await Promise.allSettled(promises);
  };

  useImperativeHandle(ref, () => ({
    checkAllPings,
  }));

  return (
    <div className={cn('space-y-4', className)}>
        <div className="grid gap-3">
          {regions.map((region) => {
            const isSelected = selectedRegion === region.id;
            const ping = pings[region.id];
            const status = pingStatus[region.id];

            return (
              <button
                key={region.id}
                onClick={() => onRegionSelect(region.id)}
                className={cn(
                'w-full p-3 rounded-lg border-2 transition-all duration-200',
                'flex items-center gap-3 group hover:scale-[1.02]',
                isSelected
                  ? 'border-purple-500 bg-purple-500/20 shadow-lg shadow-purple-500/25'
                  : 'border-gray-600 bg-gray-800/50 hover:border-gray-500 hover:bg-gray-800/70'
              )}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span
                  className="text-2xl"
                  role="img"
                  aria-label={region.location}
                >
                  {region.flag}
                </span>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="font-semibold text-white truncate max-w-[12rem]">
                    {region.name}
                  </div>
                  <span className="text-sm text-gray-400 truncate max-w-[10rem]">
                    {region.location}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {status === 'checking' && (
                  <div className="flex items-center gap-1 text-yellow-400">
                    <Clock className="w-4 h-4 animate-spin" />
                    <span className="text-xs">Checking...</span>
                  </div>
                )}

                {status === 'done' && ping !== undefined && (
                  <div className="flex items-center gap-1">
                    <div
                      className={cn(
                        'w-2 h-2 rounded-full',
                        ping < 50
                          ? 'bg-green-500'
                          : ping < 100
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                      )}
                    />
                    <span className="text-xs text-gray-300">{ping}ms</span>
                  </div>
                )}

                {status === 'error' && (
                  <div className="flex items-center gap-1 text-red-400">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-xs">Offline</span>
                  </div>
                )}

                {isSelected && (
                  <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
  }
);
RegionSelector.displayName = 'RegionSelector';
