'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cloneProfile,
  createDefaultProfile,
  getLevelProgress,
  sanitizeProfile,
  type LevelProgress,
  type ProgressionProfile,
} from '../lib/progression';
import { getSupabaseBrowserClient } from '../lib/supabase-client';
import type {
  ProgressionLevelLostMessage,
  ProgressionProfileMessage,
  ProgressionXpAwardMessage,
} from '../types/progression';

export interface UseProgressionResult {
  profile: ProgressionProfile;
  levelProgress: LevelProgress;
  isHydrated: boolean;
  profileVersion: number;
  profileId: string;
  unlockedTiers: string[];
  lickTongueCount: number;
  unlockedCharacters: string[];
  refresh: (payload?: any) => Promise<void>;
  applyServerProfile: (message: ProgressionProfileMessage) => void;
  applyServerXpAward: (message: ProgressionXpAwardMessage) => void;
  applyServerLevelLoss: (message: ProgressionLevelLostMessage) => void;
  updateProfile: (
    updater: (current: ProgressionProfile) => ProgressionProfile
  ) => void;
  saveProfile: (
    profile: ProgressionProfile
  ) => Promise<ProgressionProfile | null>;
  resetProfile: () => Promise<ProgressionProfile | null>;
  deallocateAll: () => Promise<ProgressionProfile | null>;
  unlockDifficulty: (
    tierId: string
  ) => Promise<{ unlockedTiers: string[]; lickTongueCount: number }>;
  unlockCharacter: (
    characterId: string
  ) => Promise<{
    unlockedCharacters: string[];
    lickTongueCount: number;
    selectedCharacterId: string | null;
  }>;
}

export function useProgression(
  playerId: string | null | undefined,
  options?: { skipInitialFetch?: boolean }
): UseProgressionResult {
  const [profile, setProfile] = useState<ProgressionProfile>(
    createDefaultProfile()
  );
  const [isHydrated, setIsHydrated] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0);
  const [unlockedTiers, setUnlockedTiers] = useState<string[]>(['normal_1']);
  const [lickTongueCount, setLickTongueCount] = useState(0);
  const [unlockedCharacters, setUnlockedCharacters] = useState<string[]>([]);
  const resolvedId = playerId ?? 'guest';
  const baseUrl = useMemo(
    () => (process.env.NEXT_PUBLIC_SERVER_URL || '').replace(/\/$/, ''),
    []
  );

  const progressionEndpoint = useMemo(() => {
    return baseUrl ? `${baseUrl}/api/player` : '/api/player';
  }, [baseUrl]);

  const progressionAllocateEndpoint = useMemo(() => {
    return baseUrl
      ? `${baseUrl}/api/player/progression/allocate`
      : '/api/player/progression/allocate';
  }, [baseUrl]);

  const progressionResetEndpoint = useMemo(() => {
    return baseUrl
      ? `${baseUrl}/api/player/progression/reset`
      : '/api/player/progression/reset';
  }, [baseUrl]);

  const progressionDeallocateEndpoint = useMemo(() => {
    return baseUrl
      ? `${baseUrl}/api/player/progression/deallocate`
      : '/api/player/progression/deallocate';
  }, [baseUrl]);

  const difficultyUnlockEndpoint = useMemo(() => {
    return baseUrl
      ? `${baseUrl}/api/player/unlocks/difficulty`
      : '/api/player/unlocks/difficulty';
  }, [baseUrl]);

  const characterUnlockEndpoint = useMemo(() => {
    return baseUrl
      ? `${baseUrl}/api/player/unlocks/character`
      : '/api/player/unlocks/character';
  }, [baseUrl]);

  const hydrateFromServer = useCallback(async () => {
    if (!playerId) {
      setProfile(createDefaultProfile());
      setIsHydrated(false);
      setUnlockedTiers(['normal_1']);
      setLickTongueCount(0);
      setUnlockedCharacters([]);
      return;
    }

    try {
      const response = await fetch(progressionEndpoint, {
        credentials: 'include',
      });
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      if (!payload?.profile) {
        return;
      }
      const sanitized = sanitizeProfile(payload.profile);
      setProfile(sanitized);
      setProfileVersion((v) => v + 1);
      const unlocked =
        Array.isArray(payload.unlockedTiers) && payload.unlockedTiers.length > 0
          ? (payload.unlockedTiers as string[])
          : ['normal_1'];
      setUnlockedTiers(unlocked);
      setLickTongueCount(Number(payload.lickTongueCount) || 0);
      const unlockedChars =
        Array.isArray(payload.unlockedCharacters)
          ? (payload.unlockedCharacters as string[])
          : [];
      setUnlockedCharacters(unlockedChars);
    } catch (error) {
      console.warn('Failed to load progression from server', error);
    } finally {
      setIsHydrated(true);
    }
  }, [playerId, progressionEndpoint]);

  useEffect(() => {
    if (!playerId) {
      setProfile(createDefaultProfile());
      setIsHydrated(false);
      setUnlockedTiers(['normal_1']);
      setLickTongueCount(0);
      setUnlockedCharacters([]);
      return;
    }
    if (!options?.skipInitialFetch) {
      setIsHydrated(false);
      void hydrateFromServer();
    }
  }, [playerId, hydrateFromServer, options?.skipInitialFetch]);

  // Expose explicit refresh; outer components can drive realtime updates centrally
  const refresh = useCallback(
    async (payload?: any) => {
      if (payload && typeof payload === 'object') {
        try {
          if (payload.profile) {
            const sanitized = sanitizeProfile(payload.profile);
            setProfile(sanitized);
            setProfileVersion((v) => v + 1);
          }
          if (Array.isArray(payload.unlockedTiers)) {
            setUnlockedTiers(payload.unlockedTiers as string[]);
          }
          if (payload.lickTongueCount !== undefined) {
            setLickTongueCount(Number(payload.lickTongueCount) || 0);
          }
          if (Array.isArray(payload.unlockedCharacters)) {
            setUnlockedCharacters(payload.unlockedCharacters as string[]);
          }
          setIsHydrated(true);
          return;
        } catch {
          // fall through to fetch
        }
      }
      await hydrateFromServer();
    },
    [hydrateFromServer]
  );

  const updateProfile = useCallback(
    (updater: (current: ProgressionProfile) => ProgressionProfile) => {
      setProfile((prev) => {
        const updated = sanitizeProfile(updater(prev));
        return updated;
      });
      setProfileVersion((v) => v + 1);
    },
    []
  );

  const applyServerProfile = useCallback(
    (message: ProgressionProfileMessage) => {
      const sanitized = sanitizeProfile(message.profile);
      setProfile(sanitized);
      setProfileVersion((v) => v + 1);
    },
    []
  );

  const applyServerXpAward = useCallback(
    (message: ProgressionXpAwardMessage) => {
      updateProfile((prev) => {
        const next = cloneProfile(prev);
        next.totalXp = Math.max(0, Math.floor(message.totalXp));
        next.level = Math.max(1, Math.floor(message.level));
        next.unspentPoints = Math.max(0, Math.floor(message.unspentPoints));
        if (message.stats) {
          next.stats = { ...message.stats };
        }
        if (Array.isArray(message.allocationHistory)) {
          next.allocationHistory = [...message.allocationHistory];
        }
        return next;
      });
    },
    [updateProfile]
  );

  const applyServerLevelLoss = useCallback(
    (message: ProgressionLevelLostMessage) => {
      updateProfile((prev) => {
        const next = cloneProfile(prev);
        next.totalXp = Math.max(0, Math.floor(message.totalXp));
        next.level = Math.max(1, Math.floor(message.level));
        next.unspentPoints = Math.max(0, Math.floor(message.unspentPoints));
        if (message.stats) {
          next.stats = { ...message.stats };
        }
        if (Array.isArray(message.allocationHistory)) {
          next.allocationHistory = [...message.allocationHistory];
        }
        return next;
      });
    },
    [updateProfile]
  );

  const levelProgress = useMemo(
    () => getLevelProgress(profile.totalXp),
    [profile]
  );

  const saveProfile = useCallback(
    async (nextProfile: ProgressionProfile) => {
      if (!playerId) {
        return null;
      }

      try {
        const response = await fetch(progressionAllocateEndpoint, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            stats: nextProfile.stats,
            allocationHistory: nextProfile.allocationHistory,
          }),
        });

        if (!response.ok) {
          return null;
        }

        const payload = await response.json();
        const sanitized = payload?.profile
          ? sanitizeProfile(payload.profile)
          : sanitizeProfile(nextProfile);
        setProfile(sanitized);
        setProfileVersion((v) => v + 1);
        if (
          Array.isArray(payload?.unlockedTiers) &&
          payload.unlockedTiers.length > 0
        ) {
          setUnlockedTiers(payload.unlockedTiers as string[]);
        }
        if (payload?.lickTongueCount !== undefined) {
          setLickTongueCount(Number(payload.lickTongueCount) || 0);
        }
        return sanitized;
      } catch (error) {
        console.warn('Failed to save progression profile', error);
        return null;
      }
    },
    [playerId, progressionAllocateEndpoint]
  );

  const resetProfile = useCallback(async () => {
    if (!playerId) {
      return null;
    }
    try {
      const response = await fetch(progressionResetEndpoint, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        return null;
      }
      const payload = await response.json();
      const sanitized = payload?.profile
        ? sanitizeProfile(payload.profile)
        : createDefaultProfile();
      setProfile(sanitized);
      setProfileVersion((v) => v + 1);
      if (
        Array.isArray(payload?.unlockedTiers) &&
        payload.unlockedTiers.length > 0
      ) {
        setUnlockedTiers(payload.unlockedTiers as string[]);
      }
      if (payload?.lickTongueCount !== undefined) {
        setLickTongueCount(Number(payload.lickTongueCount) || 0);
      }
      return sanitized;
    } catch (error) {
      console.warn('Failed to reset progression profile', error);
      return null;
    }
  }, [playerId, progressionResetEndpoint]);

  const deallocateAll = useCallback(async () => {
    if (!playerId) {
      return null;
    }
    try {
      const response = await fetch(progressionDeallocateEndpoint, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        return null;
      }
      const payload = await response.json();
      const sanitized = payload?.profile
        ? sanitizeProfile(payload.profile)
        : createDefaultProfile();
      setProfile(sanitized);
      setProfileVersion((v) => v + 1);
      if (
        Array.isArray(payload?.unlockedTiers) &&
        payload.unlockedTiers.length > 0
      ) {
        setUnlockedTiers(payload.unlockedTiers as string[]);
      }
      if (payload?.lickTongueCount !== undefined) {
        setLickTongueCount(Number(payload.lickTongueCount) || 0);
      }
      return sanitized;
    } catch (error) {
      console.warn('Failed to deallocate progression stats', error);
      return null;
    }
  }, [playerId, progressionDeallocateEndpoint]);

  const unlockDifficulty = useCallback(
    async (tierId: string) => {
      if (!playerId) {
        const error = new Error('Player not linked to session');
        (error as any).status = 401;
        throw error;
      }

      try {
        const response = await fetch(difficultyUnlockEndpoint, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tierId }),
        });

        const payload = await response
          .json()
          .catch(() => ({}) as Record<string, unknown>);

        if (Array.isArray(payload?.unlockedTiers)) {
          setUnlockedTiers(payload.unlockedTiers as string[]);
        }
        if (payload?.lickTongueCount !== undefined) {
          setLickTongueCount(Number(payload.lickTongueCount) || 0);
        }

        if (!response.ok) {
          const error = new Error(
            typeof payload?.error === 'string'
              ? payload.error
              : 'Failed to unlock difficulty tier'
          );
          (error as any).status = response.status;
          throw error;
        }

        return {
          unlockedTiers: Array.isArray(payload?.unlockedTiers)
            ? (payload.unlockedTiers as string[])
            : [],
          lickTongueCount: Number(payload?.lickTongueCount) || 0,
        };
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
        throw new Error('Failed to unlock difficulty tier');
      }
    },
    [playerId, difficultyUnlockEndpoint, setUnlockedTiers, setLickTongueCount]
  );

  const unlockCharacter = useCallback(
    async (characterId: string) => {
      if (!playerId) {
        const error = new Error('Player not linked to session');
        (error as any).status = 401;
        throw error;
      }

      try {
        const response = await fetch(characterUnlockEndpoint, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ characterId }),
        });

        const payload = await response
          .json()
          .catch(() => ({}) as Record<string, unknown>);

        if (Array.isArray(payload?.unlockedCharacters)) {
          setUnlockedCharacters(payload.unlockedCharacters as string[]);
        }
        if (payload?.lickTongueCount !== undefined) {
          setLickTongueCount(Number(payload.lickTongueCount) || 0);
        }

        if (!response.ok) {
          const error = new Error(
            typeof payload?.error === 'string'
              ? payload.error
              : 'Failed to unlock character'
          );
          (error as any).status = response.status;
          throw error;
        }

        return {
          unlockedCharacters: Array.isArray(payload?.unlockedCharacters)
            ? (payload.unlockedCharacters as string[])
            : [],
          lickTongueCount: Number(payload?.lickTongueCount) || 0,
          selectedCharacterId:
            typeof payload?.selectedCharacterId === 'string'
              ? (payload.selectedCharacterId as string)
              : null,
        };
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
        throw new Error('Failed to unlock character');
      }
    },
    [playerId, characterUnlockEndpoint]
  );

  return {
    profile,
    levelProgress,
    isHydrated,
    profileVersion,
    profileId: resolvedId,
    unlockedTiers,
    lickTongueCount,
    unlockedCharacters,
    refresh,
    applyServerProfile,
    applyServerXpAward,
    applyServerLevelLoss,
    updateProfile,
    saveProfile,
    resetProfile,
    deallocateAll,
    unlockDifficulty,
    unlockCharacter,
  };
}
