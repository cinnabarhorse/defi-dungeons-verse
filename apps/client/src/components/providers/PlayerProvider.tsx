'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSession } from './SessionProvider';
import { useProgression } from '../../hooks/useProgression';
import { useKillStreak } from '../../hooks/useKillStreak';
import { usePlayerStream } from '../../hooks/usePlayerStream';
import { getAppServerBaseUrl } from '../../lib/server-url';
import type {
  AudioSettings,
  PlayerPreferencesSnapshot,
} from '../../types/preferences';
import { useCredits } from '../../hooks/useCredits';

interface PlayerContextValue {
  // Preferences
  preferenceDefaults: PlayerPreferencesSnapshot;
  effectivePreferences: PlayerPreferencesSnapshot;
  arePreferencesHydrated: boolean;
  isAuthorized: boolean;
  isProgressionHydrated: ReturnType<typeof useProgression>['isHydrated'];
  unlockDifficulty: ReturnType<typeof useProgression>['unlockDifficulty'];
  unlockCharacter: ReturnType<typeof useProgression>['unlockCharacter'];
  updatePlayerPreferences: (
    patch: Partial<PlayerPreferencesSnapshot> & {
      audioSettings?: Partial<AudioSettings>;
    }
  ) => Promise<boolean>;

  // Progression
  progressionProfile: ReturnType<typeof useProgression>['profile'];
  progressionLevelProgress: ReturnType<typeof useProgression>['levelProgress'];
  unlockedDifficultyTiers: ReturnType<typeof useProgression>['unlockedTiers'];
  unlockedCharacters: ReturnType<typeof useProgression>['unlockedCharacters'];
  lickTongueCount: ReturnType<typeof useProgression>['lickTongueCount'];

  applyServerProfile: ReturnType<typeof useProgression>['applyServerProfile'];
  applyServerXpAward: ReturnType<typeof useProgression>['applyServerXpAward'];
  applyServerLevelLoss: ReturnType<
    typeof useProgression
  >['applyServerLevelLoss'];
  updateProgressionProfile: ReturnType<typeof useProgression>['updateProfile'];
  saveProgressionProfile: ReturnType<typeof useProgression>['saveProfile'];
  resetProgressionProfile: ReturnType<typeof useProgression>['resetProfile'];
  deallocateAllStats: ReturnType<typeof useProgression>['deallocateAll'];
  refreshProgression: ReturnType<typeof useProgression>['refresh'];
  killStreakState: ReturnType<typeof useKillStreak>['state'];
  isKillStreakHydrated: ReturnType<typeof useKillStreak>['isHydrated'];
  applyKillStreakProfile: ReturnType<typeof useKillStreak>['applyProfile'];
  applyKillStreakUpdate: ReturnType<typeof useKillStreak>['applyUpdate'];
  applyKillStreakReset: ReturnType<typeof useKillStreak>['applyReset'];

  // Credits
  creditsBalance: number;
  topUpCredits: (amount: number) => Promise<boolean>;
  consumeCredits: (amount: number) => boolean;
  refundCredits: (amount: number) => void;
  refreshCredits: () => Promise<void>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  masterVolume: 70,
  sfxVolume: 80,
  musicVolume: 60,
  muted: false,
};

const DEFAULT_PREF_SNAPSHOT: PlayerPreferencesSnapshot = {
  selectedCharacterId: 'coderdan',
  selectedDifficultyTier: 'normal_1',
  gotchiSpriteUrl: null,
  avatarId: null,
  audioSettings: { ...DEFAULT_AUDIO_SETTINGS },
};

export function PlayerProvider({ children }: { children: ReactNode }) {
  const {
    hasActiveWallet,
    hasValidSession,
    isSessionVerified,
    isSessionSynced,
    playerId,
    walletAddress,
  } = useSession();

  const canLoadPlayerData = Boolean(
    hasValidSession && hasActiveWallet && isSessionSynced
  );
  const scopedPlayerId = canLoadPlayerData ? playerId : null;

  const [effectivePreferences, setEffectivePreferences] =
    useState<PlayerPreferencesSnapshot>({ ...DEFAULT_PREF_SNAPSHOT });
  const [preferenceDefaults, setPreferenceDefaults] =
    useState<PlayerPreferencesSnapshot>({ ...DEFAULT_PREF_SNAPSHOT });
  const [arePreferencesHydrated, setArePreferencesHydrated] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);

  const baseUrl = useMemo(() => getAppServerBaseUrl(), []);
  const preferencesEndpoint = useMemo(
    () => `${baseUrl}/api/player/preferences`,
    [baseUrl]
  );
  const characterSelectEndpoint = useMemo(
    () => `${baseUrl}/api/player/character/select`,
    [baseUrl]
  );

  const {
    profile: progressionProfile,
    levelProgress: progressionLevelProgress,
    isHydrated: isProgressionHydrated,
    applyServerProfile,
    applyServerXpAward,
    applyServerLevelLoss,
    updateProfile: updateProgressionProfile,
    saveProfile: saveProgressionProfile,
    resetProfile: resetProgressionProfile,
    deallocateAll: deallocateAllStats,
    unlockedTiers: unlockedDifficultyTiers,
    unlockedCharacters,
    lickTongueCount,
    refresh: refreshProgression,
    unlockDifficulty,
    unlockCharacter,
  } = useProgression(scopedPlayerId, { skipInitialFetch: true });
  const {
    state: killStreakState,
    isHydrated: isKillStreakHydrated,
    applyProfile: applyKillStreakProfile,
    applyUpdate: applyKillStreakUpdate,
    applyReset: applyKillStreakReset,
    reset: resetKillStreakState,
  } = useKillStreak();

  // Credits state
  const {
    balance: creditsBalance,
    topUp: topUpCredits,
    consume: consumeCredits,
    refund: refundCredits,
    setBalance: setCreditsBalance,
    refresh: refreshCredits,
  } = useCredits(scopedPlayerId);

  const updatePlayerPreferences = useCallback(
    async (
      patch: Partial<PlayerPreferencesSnapshot> & {
        audioSettings?: Partial<AudioSettings>;
      }
    ) => {
      if (!scopedPlayerId) return false;
      const hasCharacterUpdate = Object.prototype.hasOwnProperty.call(
        patch,
        'selectedCharacterId'
      );
      const hasSpriteUpdate = Object.prototype.hasOwnProperty.call(
        patch,
        'gotchiSpriteUrl'
      );

      const characterValue = hasCharacterUpdate
        ? (patch.selectedCharacterId ?? null)
        : undefined;

      if (hasCharacterUpdate && characterValue !== null) {
        const payload: Record<string, unknown> = {
          characterId: characterValue,
        };
        if (hasSpriteUpdate)
          payload.gotchiSpriteUrl = patch.gotchiSpriteUrl ?? null;

        try {
          const res = await fetch(characterSelectEndpoint, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) return false;
          const data = await res.json();
          const nextDefaults = {
            ...DEFAULT_PREF_SNAPSHOT,
            ...(data?.defaults || {}),
          } as PlayerPreferencesSnapshot;
          const nextEffective = {
            ...nextDefaults,
            ...(data?.effective || {}),
          } as PlayerPreferencesSnapshot;
          setPreferenceDefaults(nextDefaults);
          setEffectivePreferences(nextEffective);
          setArePreferencesHydrated(true);
          if (Array.isArray(data?.unlockedCharacters)) {
            void refreshProgression({
              unlockedCharacters: data.unlockedCharacters,
            });
          }
          return true;
        } catch {
          return false;
        }
      }

      const payload: Record<string, unknown> = {};
      if (hasCharacterUpdate) payload.selectedCharacterId = null;
      if (Object.prototype.hasOwnProperty.call(patch, 'selectedDifficultyTier'))
        payload.selectedDifficultyTier = patch.selectedDifficultyTier ?? null;
      if (hasSpriteUpdate)
        payload.gotchiSpriteUrl = patch.gotchiSpriteUrl ?? null;
      if (Object.prototype.hasOwnProperty.call(patch, 'avatarId'))
        payload.avatarId = patch.avatarId ?? null;
      if (Object.prototype.hasOwnProperty.call(patch, 'audioSettings'))
        payload.audioSettings = { ...(patch.audioSettings ?? {}) };

      if (Object.keys(payload).length === 0) return true;
      try {
        const res = await fetch(preferencesEndpoint, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) return false;
        const data = await res.json();
        const nextDefaults = {
          ...DEFAULT_PREF_SNAPSHOT,
          ...(data?.defaults || {}),
        } as PlayerPreferencesSnapshot;
        const nextEffective = {
          ...nextDefaults,
          ...(data?.effective || {}),
        } as PlayerPreferencesSnapshot;
        setPreferenceDefaults(nextDefaults);
        setEffectivePreferences(nextEffective);
        setArePreferencesHydrated(true);
        if (Array.isArray(data?.unlockedCharacters)) {
          void refreshProgression({
            unlockedCharacters: data.unlockedCharacters,
          });
        }
        return true;
      } catch {
        return false;
      }
    },
    [
      characterSelectEndpoint,
      preferencesEndpoint,
      refreshProgression,
      scopedPlayerId,
    ]
  );

  // Central realtime bootstrap of player data
  usePlayerStream(
    scopedPlayerId,
    walletAddress,
    async () => {
      if (!hasActiveWallet || !hasValidSession || !isSessionSynced) {
        return;
      }

      try {
        const endpoint = `${baseUrl}/api/player`;
        const res = await fetch(endpoint, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) return;
        const payload = await res.json();

        setIsAuthorized(Boolean(payload?.isAuthorized));

        const nextDefaults = {
          ...DEFAULT_PREF_SNAPSHOT,
          ...(payload?.defaults || {}),
        } as PlayerPreferencesSnapshot;
        const nextEffective = {
          ...nextDefaults,
          ...(payload?.effective || {}),
        } as PlayerPreferencesSnapshot;
        setPreferenceDefaults(nextDefaults);
        setEffectivePreferences(nextEffective);
        setArePreferencesHydrated(true);

        // Apply progression from payload, respecting in-run stale checks
        if (payload?.profile) {
          await refreshProgression(payload);
        }

        // Apply credits if present
        if (typeof payload?.balance === 'number') {
          setCreditsBalance(payload.balance);
        }
      } catch {
        // ignore
      }
    },
    scopedPlayerId
  );

  // Ensure preferences clear when session absent
  useEffect(() => {
    if (!scopedPlayerId || !isSessionVerified) {
      setPreferenceDefaults({ ...DEFAULT_PREF_SNAPSHOT });
      setEffectivePreferences({ ...DEFAULT_PREF_SNAPSHOT });
      setArePreferencesHydrated(false);
      setIsAuthorized(false);
      setCreditsBalance(0);
      resetKillStreakState();
    }
  }, [scopedPlayerId, isSessionVerified, resetKillStreakState]);

  const value: PlayerContextValue = {
    preferenceDefaults,
    effectivePreferences,
    arePreferencesHydrated,
    isAuthorized,
    isProgressionHydrated,
    unlockDifficulty,
    unlockCharacter,
    updatePlayerPreferences,
    progressionProfile,
    progressionLevelProgress,
    unlockedDifficultyTiers,
    unlockedCharacters,
    lickTongueCount,
    applyServerProfile,
    applyServerXpAward,
    applyServerLevelLoss,
    updateProgressionProfile,
    saveProgressionProfile,
    resetProgressionProfile,
    deallocateAllStats,
    refreshProgression,
    killStreakState,
    isKillStreakHydrated,
    applyKillStreakProfile,
    applyKillStreakUpdate,
    applyKillStreakReset,

    creditsBalance,
    topUpCredits,
    consumeCredits,
    refundCredits,
    refreshCredits,
  };

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return ctx;
}
