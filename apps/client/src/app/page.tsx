'use client';

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type SetStateAction,
} from 'react';
import { GameHUD } from '../components/GameHUD';
import { MobileGameHUD } from '../components/MobileGameHUD';
import { Lobby, type LobbyProps } from '../components/Lobby';
import { WalletConnectControl } from '../components/WalletConnectControl';
import { Inventory } from '../components/Inventory';
import { DialogueBox, useDialogueKeyboard } from '../components/DialogueBox';
import { Button } from '../components/ui/Button';
import { Slider } from '../components/ui/Slider';
import { RunSummary, type RunSummaryData } from '../components/RunSummary';
// Tabs are rendered globally in RootLayout
import { GAME_CONFIG } from '../lib/constants';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';

import type { InventoryItem } from '../types/inventory';
import { useGameState } from '../hooks/useGameState';
import { useSession } from '../components/providers/SessionProvider';
import { useRoomManagement } from '../hooks/useRoomManagement';
import { useInventory } from '../hooks/useInventory';
import { useDialogue } from '../hooks/useDialogue';
import { useEntryCost } from '../hooks/useEntryCost';
import { useEquipment } from '../hooks/useEquipment';
import type {
  GrenadeHudState,
  WeaponHudState,
  SpellHudState,
} from '../game/GameScene';
import type { LeverageStatePayload } from '../types/messages';
import {
  getDefaultCharacter,
  getCharacterStats,
  setCharacterSpriteOverride,
} from '../lib/character-registry';
import { getDifficultyTier } from '../data/difficulty-tiers';
import { usePlayer } from '../components/providers/PlayerProvider';
import type {
  ProgressionLevelLostMessage,
  ProgressionProfileMessage,
  ProgressionXpAwardMessage,
} from '../types/progression';
import type {
  KillStreakProfileMessage,
  KillStreakUpdatedMessage,
  KillStreakResetMessage,
} from '../types/kill-streak';
import {
  applyXp as applyXpToProgression,
  cloneProfile as cloneProgressionProfile,
  createDefaultProfile,
  type ProgressionProfile,
} from '../lib/progression';
import { SERVER_REGIONS, getDefaultRegion } from '../lib/server-regions';
import {
  handlePWAAction as handlePWAActionUtil,
  isIOSSafari,
} from '../lib/pwa-utils';
import { getAppServerBaseUrl } from '../lib/server-url';
import { getGameScene } from '../lib/getGameScene';
import {
  initPhaser,
  type InitPhaserOptions,
  type JoinTarget,
  type ToastNotification,
  type ScoreHudState,
} from './initPhaser';
import { usePlayerStream } from '../hooks/usePlayerStream';
import { computeQuestText } from '../game/systems/QuestSystem';
import type {
  AudioSettings,
  PlayerPreferencesSnapshot,
} from '../types/preferences';
import {
  NotificationDock,
  type NotificationEntry,
} from '../components/NotificationDock';

const CREDIT_COMPARISON_BUFFER = 1e-4;
const CREDITS_TOP_UP_INCREMENT = 100;
const LEVERAGE_MIN = 1;
const LEVERAGE_MAX = 10;
const formatLeverageDisplay = (value: number) => {
  if (!Number.isFinite(value)) {
    return '1';
  }
  return Number.isInteger(value)
    ? Number(value).toFixed(0)
    : Number(value).toFixed(1);
};
const DEV_MODE = process.env.NODE_ENV !== 'production';

function formatWalletLabel(address: string | null | undefined) {
  if (!address) {
    return null;
  }
  const trimmed = address.trim();
  if (trimmed.length <= 10) {
    return trimmed;
  }
  const normalized = trimmed.toLowerCase();
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

export default function HomePage() {
  const {
    gameStarted,
    setGameStarted,
    isStarting,
    setIsStarting,
    placeholderName,
    playerName,
    setPlayerName,
    error,
    setError,
  } = useGameState();

  const {
    isWalletConnected,
    walletAddress,
    hasActiveWallet,
    hasValidSession,

    isSessionVerified,
    isSessionSynced,
    playerId,
    lastKnownWalletAddress,
    ensName,
  } = useSession();

  const hasEffectiveWallet = Boolean(hasActiveWallet);
  const canLoadPlayerData = Boolean(hasValidSession && hasEffectiveWallet);
  const scopedPlayerId = canLoadPlayerData ? playerId : null;

  const welcomeWalletLabel = useMemo(() => {
    return formatWalletLabel(lastKnownWalletAddress || walletAddress);
  }, [lastKnownWalletAddress, walletAddress]);

  // Prefer ENS name from session (if available) for playerName
  useEffect(() => {
    if (ensName && ensName !== playerName) {
      setPlayerName(ensName);
    }
  }, [ensName, playerName, setPlayerName]);

  const {
    currentRoomId,
    setCurrentRoomId,
    hostSessionId,
    setHostSessionId,
    playerCount,
    setPlayerCount,
    maxPlayers,
    setMaxPlayers,
    ping,
    setPing,
    connectionStatus,
    setConnectionStatus,
    packetLoss,
    setPacketLoss,
    serverRegion,
    setServerRegion,
    roomPhase,
    setRoomPhase,
    countdownEndsAt,
    setCountdownEndsAt,
    autoCloseAt,
    setAutoCloseAt,
    setLateJoinCutoffAt,
    runStartedAt,
    setRunStartedAt,
    setStartedByPlayerId,
  } = useRoomManagement();

  const {
    isInventoryOpen,
    setIsInventoryOpen,
    inventoryItems,
    setInventoryItems,
    droppedItems,
    setDroppedItems,
    toastItem,
    setToastItem,
    addItemToInventory,
    removeItemFromInventory,
    useItem,
  } = useInventory(scopedPlayerId);

  const {
    creditsBalance,
    topUpCredits,
    consumeCredits,
    refundCredits,
    progressionProfile,
    progressionLevelProgress,
    applyServerProfile,
    applyServerXpAward,
    applyServerLevelLoss,
    updateProgressionProfile,
    saveProgressionProfile,
    resetProgressionProfile,
    deallocateAllStats,
    unlockedDifficultyTiers,
    unlockedCharacters,
    lickTongueCount,
    refreshProgression,
    preferenceDefaults,
    effectivePreferences,
    arePreferencesHydrated,
    unlockDifficulty,
    unlockCharacter,
    updatePlayerPreferences,
    killStreakState,
    applyKillStreakProfile,
    applyKillStreakUpdate,
    applyKillStreakReset,
  } = usePlayer();

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Separate state for toast notifications (non-inventory)
  const [toastNotification, setToastNotification] =
    useState<ToastNotification | null>(null);
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
  const [isDockOpen, setIsDockOpen] = useState(false);
  const [dailyQuestActive, setDailyQuestActive] = useState(false);

  // Rank tab state

  const [hasVictory, setHasVictory] = useState(false);
  const [runEndedAt, setRunEndedAt] = useState<number | null>(null);
  const [usdcTotal, setUsdcTotal] = useState<number | null>(null);
  const [isEconomyLoading, setIsEconomyLoading] = useState<boolean>(false);
  const [economyError, setEconomyError] = useState<string | null>(null);

  const handleAdjustStats = useCallback(() => {
    router.push('/me/allocate-stats');
  }, [router]);

  const handleNavigateToTopUp = useCallback(() => {
    router.push('/me/topup');
  }, [router]);

  // Listen for global toasts (e.g., owned Aavegotchis fetched)
  useEffect(() => {
    function handleToast(ev: Event) {
      const e = ev as CustomEvent<{
        type:
          | 'portal_guardian_spawn'
          | 'portals_opened'
          | 'error'
          | 'success'
          | 'info';
        message: string;
      }>;
      setToastNotification({
        id: crypto.randomUUID(),
        type: e.detail.type,
        message: e.detail.message,
      });
      setTimeout(() => setToastNotification(null), 4000);
    }

    window.addEventListener('dd-toast', handleToast as EventListener);
    return () =>
      window.removeEventListener('dd-toast', handleToast as EventListener);
  }, []);

  useEffect(() => {
    if (!gameStarted) {
      setHasVictory(false);
      setRunEndedAt(null);
    }
  }, [gameStarted]);

  const previousRunStartedAtRef = useRef<number>(0);
  useEffect(() => {
    if (roomPhase === 'in_game' && runStartedAt > 0) {
      if (runStartedAt !== previousRunStartedAtRef.current) {
        setRunKills(0);
        setRunItemsPickedUp([]);
        previousRunStartedAtRef.current = runStartedAt;
        setRunEndedAt(null);
      }
    } else {
      previousRunStartedAtRef.current = 0;
    }
  }, [roomPhase, runStartedAt]);

  // Freeze run duration when victory is achieved (e.g., boss defeated/treasure room)
  useEffect(() => {
    if (hasVictory && runEndedAt == null && runStartedAt > 0) {
      setRunEndedAt(Date.now());
    }
  }, [hasVictory, runEndedAt, runStartedAt]);

  useEffect(() => {
    if (roomPhase === 'staging' || roomPhase === 'ended') {
      setDailyQuestActive(false);
    }
  }, [roomPhase]);

  useEffect(() => {
    if (!gameStarted) return;

    let cancelled = false;
    const checkScene = () => {
      const scene = getGameScene();
      return scene?.room;
    };

    const room = checkScene();
    if (!room) return;

    const handleItemPickup = (data: any) => {
      if (cancelled) return;
      if (data?.item && roomPhase === 'in_game') {
        setRunItemsPickedUp((prev) => [...prev, data.item]);
      }
    };

    room.onMessage('item_pickup', handleItemPickup);

    return () => {
      cancelled = true;
    };
  }, [gameStarted, roomPhase]);

  const {
    dialogueState,
    startDialogue,
    selectResponse,
    resolveAction,
    closeDialogue,
    isDialogueOpen,
  } = useDialogue();

  // Enable keyboard navigation for dialogue
  useDialogueKeyboard(
    isDialogueOpen,
    dialogueState.dialogueData?.responses,
    selectResponse,
    closeDialogue,
    dialogueState.isProcessingAction
  );

  // Global keyboard shortcuts
  useEffect(() => {
    const isEditableTarget = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select')
        return true;
      const contentEditable = (node as HTMLElement).isContentEditable;
      return !!contentEditable;
    };

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      // Ignore if typing in editable elements
      if (isEditableTarget(event.target)) {
        return;
      }

      // F11 for PWA install (on mobile Safari, otherwise does nothing special)
      if (event.key === 'F11') {
        event.preventDefault(); // Prevent browser's default F11 behavior
        if (isIOSSafari()) {
          handlePWAActionUtil().catch((error) => {
            console.error('Failed to handle PWA action:', error);
          });
        }
      }

      if (
        DEV_MODE &&
        event.key.toLowerCase() === 'r' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.altKey
      ) {
        if (gameStarted && roomPhase === 'in_game' && runStartedAt > 0) {
          event.preventDefault();
          event.stopPropagation();
          setShowRunSummary(true);
        }
      }

      if (
        DEV_MODE &&
        event.key.toLowerCase() === 'q' &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setDailyQuestActive((prev) => {
          const next = !prev;
          handleShowToast({
            id: `daily-quest-toggle-${Date.now()}`,
            type: 'info',
            message: next
              ? 'Daily Quest attunement: ON'
              : 'Daily Quest attunement: OFF',
          });
          return next;
        });
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  }, []);

  useEffect(() => {
    const handleShowRunSummary = () => {
      if (gameStarted && roomPhase === 'in_game' && runStartedAt > 0) {
        setShowRunSummary(true);
      }
    };

    if (DEV_MODE) {
      (window as any).toggleDailyQuest = () => {
        setDailyQuestActive((prev) => {
          const next = !prev;
          handleShowToast({
            id: `daily-quest-toggle-${Date.now()}`,
            type: 'info',
            message: next
              ? 'Daily Quest attunement: ON'
              : 'Daily Quest attunement: OFF',
          });
          return next;
        });
      };
    }

    window.addEventListener(
      'show-run-summary',
      handleShowRunSummary as EventListener
    );
    return () => {
      window.removeEventListener(
        'show-run-summary',
        handleShowRunSummary as EventListener
      );
      if (DEV_MODE) {
        (window as any).toggleDailyQuest = undefined;
      }
    };
  }, [gameStarted, roomPhase, runStartedAt]);

  // Mobile detection and control state
  const [isMobile, setIsMobile] = useState(false);
  const [isMobileLandscape, setIsMobileLandscape] = useState(false);
  const [grenadeState, setGrenadeState] = useState<GrenadeHudState>({
    grenades: [],
    armedGrenadeSlug: null,
  });
  const [weaponHudState, setWeaponHudState] = useState<WeaponHudState>({
    weapons: [],
    activeIndex: -1,
  });
  const [spellHudState, setSpellHudState] = useState<SpellHudState>({
    spells: [],
  });
  const [scoreState, setScoreState] = useState<ScoreHudState>({
    score: 0,
    eligible: true,
  });
  const [dailyQuestThresholdScore, setDailyQuestThresholdScore] = useState<
    number | null
  >(null);
  const [leverageState, setLeverageState] = useState<LeverageStatePayload>({
    floor: 1,
    room: 1,
    total: 1,
    floorLocked: true,
    roomLocked: true,
    staniActive: false,
  });
  const [leverageError, setLeverageError] = useState<string | null>(null);
  const [pendingFloorLeverage, setPendingFloorLeverage] =
    useState<number>(LEVERAGE_MIN);
  const [pendingRoomLeverage, setPendingRoomLeverage] =
    useState<number>(LEVERAGE_MIN);

  // Run summary state
  const [runKills, setRunKills] = useState<number>(0);
  const [runItemsPickedUp, setRunItemsPickedUp] = useState<InventoryItem[]>([]);
  const [showRunSummary, setShowRunSummary] = useState<boolean>(false);

  // Character selection state with proper hydration handling
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    null
  );
  // Quest HUD state
  const [portalQuestLabel, setPortalQuestLabel] = useState<string>('');
  const [portalCountdownLabel, setPortalCountdownLabel] = useState<
    string | null
  >(null);
  // Region selection state
  const [selectedRegionId, setSelectedRegionId] = useState<string>(
    getDefaultRegion().id
  );

  // Timed spawn HUD state
  const [nextTimedSpawnAt, setNextTimedSpawnAt] = useState<number>(0);
  const [enemyCount, setEnemyCount] = useState<number>(0);
  const [enemyDifficultyLevel, setEnemyDifficultyLevel] = useState<number>(0);
  const [enemyDifficultyNextAt, setEnemyDifficultyNextAt] = useState<number>(0);
  const [enemyDifficultyEnabled, setEnemyDifficultyEnabled] =
    useState<boolean>(false);
  const [huntedIntensityLevel, setHuntedIntensityLevel] = useState<number>(0);
  const [huntedNextSpawnAt, setHuntedNextSpawnAt] = useState<number>(0);
  const [huntedEnabled, setHuntedEnabled] = useState<boolean>(false);

  // Difficulty tier selection state
  const [selectedDifficultyTier, setSelectedDifficultyTier] = useState<
    string | null
  >(null);

  const [joinTarget, setJoinTarget] = useState<JoinTarget | null>(null);
  const [isJoinMetadataLoading, setIsJoinMetadataLoading] = useState(false);
  const [clientSessionId, setClientSessionId] = useState('');
  const previousDifficultyRef = useRef<string | null>(null);
  const previousRegionRef = useRef<string | null>(null);
  const selectedRegionIdRef = useRef(selectedRegionId);
  const pendingCreditsRef = useRef<{
    amount: number;
    timeoutId: number | null;
  } | null>(null);
  const roomIdFromQuery = searchParams.get('roomId');

  const isCharacterHydrated = canLoadPlayerData && arePreferencesHydrated;

  const fallbackCharacterId =
    preferenceDefaults.selectedCharacterId ?? getDefaultCharacter().id;
  const fallbackDifficultyTier =
    preferenceDefaults.selectedDifficultyTier ?? 'normal_1';

  const fallbackUnlockedCharacterId = useMemo(() => {
    return unlockedCharacters.length > 0 ? unlockedCharacters[0] : null;
  }, [unlockedCharacters]);

  const unlockedCharacterSet = useMemo(
    () => new Set(unlockedCharacters),
    [unlockedCharacters]
  );

  const resolvedCharacterId = useMemo(() => {
    const candidate =
      selectedCharacterId ??
      effectivePreferences.selectedCharacterId ??
      fallbackCharacterId;
    if (candidate) {
      if (candidate.startsWith('gotchi:')) {
        return candidate;
      }
      if (unlockedCharacterSet.has(candidate)) {
        return candidate;
      }
    }
    return fallbackUnlockedCharacterId;
  }, [
    selectedCharacterId,
    effectivePreferences.selectedCharacterId,
    fallbackCharacterId,
    fallbackUnlockedCharacterId,
    unlockedCharacterSet,
  ]);
  const resolvedDifficultyTier =
    joinTarget?.difficultyTier ??
    selectedDifficultyTier ??
    effectivePreferences.selectedDifficultyTier ??
    fallbackDifficultyTier;

  useEffect(() => {
    return () => {
      if (pendingCreditsRef.current?.timeoutId != null) {
        window.clearTimeout(pendingCreditsRef.current.timeoutId);
      }
      pendingCreditsRef.current = null;
    };
  }, []);

  // Fetch join-room metadata when a roomId query param is present
  useEffect(() => {
    if (!roomIdFromQuery) {
      setJoinTarget(null);
      setIsJoinMetadataLoading(false);
      return;
    }

    let cancelled = false;
    setIsJoinMetadataLoading(true);

    const fetchMetadata = async () => {
      try {
        // Try all region servers to locate the room, since invite links are region-agnostic
        const candidateServers = Array.from(
          new Set(SERVER_REGIONS.map((r) => r.serverUrl.replace(/\/$/, '')))
        );

        const results = await Promise.allSettled(
          candidateServers.map(async (baseUrl) => {
            const res = await fetch(`${baseUrl}/api/rooms/${roomIdFromQuery}`);
            if (!res.ok) {
              throw new Error(String(res.status));
            }
            const payload = (await res.json()) as any;
            return { data: payload, baseUrl };
          })
        );

        const success = results.find(
          (r): r is PromiseFulfilledResult<{ data: any; baseUrl: string }> =>
            r.status === 'fulfilled'
        );

        if (!success) {
          if (!cancelled) {
            setError('This room is no longer available.');
            setJoinTarget(null);
            setIsJoinMetadataLoading(false);
          }
          return;
        }

        const { data, baseUrl } = success.value;
        if (cancelled) return;

        const metadata = data.metadata ?? {};
        const metadataRoomId =
          typeof metadata.roomId === 'string'
            ? metadata.roomId
            : roomIdFromQuery;
        const regionId =
          typeof metadata.region === 'string'
            ? metadata.region
            : (() => {
                // Fallback: infer from the responding baseUrl
                const match = SERVER_REGIONS.find(
                  (r) => r.serverUrl.replace(/\/$/, '') === baseUrl
                );
                return match?.id || selectedRegionIdRef.current;
              })();
        const region =
          SERVER_REGIONS.find((r) => r.id === regionId) || getDefaultRegion();

        const metadataPlayerCount = Array.isArray(metadata.playerCount)
          ? metadata.playerCount.length
          : typeof metadata.playerCount === 'number'
            ? metadata.playerCount
            : 0;

        const playerCountValue =
          typeof data.clients === 'number'
            ? data.clients
            : Array.isArray(data.clients)
              ? data.clients.length
              : metadataPlayerCount;

        const maxPlayersValue = Number(
          typeof data.maxClients === 'number'
            ? data.maxClients
            : typeof metadata.maxPlayers === 'number'
              ? metadata.maxPlayers
              : GAME_CONFIG.MAX_PLAYERS
        );

        const target: JoinTarget = {
          roomId: metadataRoomId,
          colyseusRoomId:
            typeof data.roomId === 'string'
              ? data.roomId
              : metadata.colyseusRoomId,
          regionId: region.id,
          regionName: region.name,
          playerCount: playerCountValue,
          maxPlayers: maxPlayersValue,
          difficultyTier:
            typeof metadata.difficultyTier === 'string'
              ? metadata.difficultyTier
              : undefined,
          hostSessionId:
            typeof metadata.hostSessionId === 'string'
              ? metadata.hostSessionId
              : undefined,
          isFull: Boolean(data.isFull),
        };

        if (!target.colyseusRoomId) {
          setError('Unable to connect to this room at the moment.');
          setJoinTarget(null);
          setIsJoinMetadataLoading(false);
          return;
        }

        if (target.isFull) {
          setError('This room is currently full. Returning to the lobby.');
          setJoinTarget(null);
          setIsJoinMetadataLoading(false);
          router.replace(pathname);
          return;
        }

        setJoinTarget(target);
        setError(null);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load room metadata', error);
          setError('Failed to load room details.');
          setJoinTarget(null);
        }
      } finally {
        if (!cancelled) {
          setIsJoinMetadataLoading(false);
        }
      }
    };

    fetchMetadata();

    return () => {
      cancelled = true;
    };
  }, [roomIdFromQuery, setError, router, pathname]);

  useEffect(() => {
    selectedRegionIdRef.current = selectedRegionId;
  }, [selectedRegionId]);

  useEffect(() => {
    if (joinTarget?.difficultyTier) {
      if (previousDifficultyRef.current === null) {
        previousDifficultyRef.current =
          selectedDifficultyTier ?? fallbackDifficultyTier;
      }
      if (selectedDifficultyTier !== joinTarget.difficultyTier) {
        setSelectedDifficultyTier(joinTarget.difficultyTier);
      }
    } else if (previousDifficultyRef.current !== null) {
      if (selectedDifficultyTier !== previousDifficultyRef.current) {
        setSelectedDifficultyTier(previousDifficultyRef.current);
      }
      previousDifficultyRef.current = null;
    }
  }, [joinTarget, selectedDifficultyTier, fallbackDifficultyTier]);

  useEffect(() => {
    if (joinTarget?.regionId) {
      if (previousRegionRef.current === null) {
        previousRegionRef.current = selectedRegionId;
      }
      if (selectedRegionId !== joinTarget.regionId) {
        setSelectedRegionId(joinTarget.regionId);
      }
    } else if (previousRegionRef.current !== null) {
      if (selectedRegionId !== previousRegionRef.current) {
        setSelectedRegionId(previousRegionRef.current);
      }
      previousRegionRef.current = null;
    }
  }, [joinTarget, selectedRegionId]);

  useEffect(() => {
    if (!canLoadPlayerData) {
      setSelectedCharacterId(fallbackCharacterId);
      return;
    }
    if (!arePreferencesHydrated) {
      return;
    }
    const nextCandidate =
      effectivePreferences.selectedCharacterId ?? fallbackCharacterId;
    if (
      nextCandidate &&
      (nextCandidate.startsWith('gotchi:') ||
        unlockedCharacterSet.has(nextCandidate))
    ) {
      setSelectedCharacterId(nextCandidate);
    } else {
      setSelectedCharacterId(fallbackUnlockedCharacterId ?? null);
    }
  }, [
    canLoadPlayerData,
    arePreferencesHydrated,
    effectivePreferences.selectedCharacterId,
    fallbackCharacterId,
    fallbackUnlockedCharacterId,
    unlockedCharacterSet,
  ]);

  useEffect(() => {
    if (!canLoadPlayerData) {
      setSelectedDifficultyTier(fallbackDifficultyTier);
      return;
    }
    if (!arePreferencesHydrated) {
      return;
    }
    const nextDifficultyTier =
      effectivePreferences.selectedDifficultyTier ?? fallbackDifficultyTier;
    setSelectedDifficultyTier(nextDifficultyTier);
  }, [
    canLoadPlayerData,
    arePreferencesHydrated,
    effectivePreferences.selectedDifficultyTier,
    fallbackDifficultyTier,
  ]);

  // Load player's economy summary (USDC total) when in lobby
  useEffect(() => {
    if (!canLoadPlayerData || gameStarted) {
      return;
    }
    let cancelled = false;
    const loadEconomy = async () => {
      setIsEconomyLoading(true);
      setEconomyError(null);
      try {
        const baseUrl = getAppServerBaseUrl();
        const endpoint = baseUrl
          ? `${baseUrl}/api/player/economy?limit=200`
          : '/api/player/economy?limit=200';
        const res = await fetch(endpoint, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        const payload = (await res.json()) as {
          summary?: Record<string, number>;
        } | null;
        const total = Number(payload?.summary?.USDC) || 0;
        if (!cancelled) {
          setUsdcTotal(Math.max(0, total));
        }
      } catch {
        if (!cancelled) {
          setEconomyError('Failed to load earnings');
          setUsdcTotal(0);
        }
      } finally {
        if (!cancelled) {
          setIsEconomyLoading(false);
        }
      }
    };
    void loadEconomy();
    return () => {
      cancelled = true;
    };
  }, [canLoadPlayerData, gameStarted]);

  useEffect(() => {
    if (!canLoadPlayerData) {
      setPlayerAvatarIdState(null);
      return;
    }
    if (!arePreferencesHydrated) {
      return;
    }
    setPlayerAvatarIdState(effectivePreferences.avatarId ?? null);
  }, [
    canLoadPlayerData,
    arePreferencesHydrated,
    effectivePreferences.avatarId,
  ]);

  const {
    credits: requiredCredits,
    isLoading: isEntryCostLoading,
    error: entryCostError,
    refresh: refreshEntryCost,
  } = useEntryCost(scopedPlayerId, selectedCharacterId);

  const { state: equipmentState } = useEquipment(scopedPlayerId);
  const equipmentSignatureRef = useRef<string>('');
  useEffect(() => {
    if (!scopedPlayerId || !equipmentState || !selectedCharacterId) return;
    if (equipmentState.characterId !== selectedCharacterId) return;

    const signature = JSON.stringify(
      equipmentState.equippedWearablesWithQuality || []
    );
    const equipmentChanged = signature !== equipmentSignatureRef.current;

    if (equipmentChanged) {
      equipmentSignatureRef.current = signature;
      void refreshEntryCost();
    }
  }, [
    equipmentState?.characterId,
    equipmentState?.equippedWearablesWithQuality,
    selectedCharacterId,
    scopedPlayerId,
    refreshEntryCost,
  ]);

  const activeDifficultyId = resolvedDifficultyTier;
  const activeDifficulty = useMemo(
    () => getDifficultyTier(activeDifficultyId),
    [activeDifficultyId]
  );
  const hasSufficientCredits =
    requiredCredits <= 0 ||
    creditsBalance + CREDIT_COMPARISON_BUFFER >= requiredCredits;
  const creditShortfall =
    requiredCredits > 0 &&
    creditsBalance + CREDIT_COMPARISON_BUFFER < requiredCredits;

  const ctaDisabledReason = useMemo(() => {
    if (isJoinMetadataLoading) return 'Loading room details...';
    if (joinTarget?.isFull) return 'Room is currently full.';
    if (!isSessionVerified) return 'Checking authentication...';
    if (!hasActiveWallet) return 'Connect your wallet to continue.';
    if (!hasValidSession) return 'Please sign the login message to continue.';
    if (isEntryCostLoading) return 'Calculating entry cost...';
    if (entryCostError) return 'Failed to load entry cost';
    if (creditShortfall) return 'Insufficient credits';
    const hasSelectableHero =
      resolvedCharacterId &&
      (resolvedCharacterId.startsWith('gotchi:') ||
        unlockedCharacterSet.has(resolvedCharacterId));
    if (!hasSelectableHero) return 'Unlock a hero to continue.';
    return null;
  }, [
    isJoinMetadataLoading,
    joinTarget,
    isSessionVerified,
    hasActiveWallet,
    hasValidSession,
    isEntryCostLoading,
    entryCostError,
    creditShortfall,
    resolvedCharacterId,
    unlockedCharacterSet,
  ]);

  const ctaDisabled = isJoinMetadataLoading || Boolean(ctaDisabledReason);
  const ctaLabel = joinTarget ? 'Join Room' : 'Play Now';

  useEffect(() => {
    if (!error || !pendingCreditsRef.current) return;

    const { amount, timeoutId } = pendingCreditsRef.current;
    if (amount > 0) {
      refundCredits(amount);
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    pendingCreditsRef.current = null;
  }, [error, refundCredits]);

  const joinInfo = useMemo(
    () =>
      joinTarget
        ? {
            roomId: joinTarget.roomId,
            regionName: joinTarget.regionName,
            playerCount: joinTarget.playerCount,
            maxPlayers: joinTarget.maxPlayers,
          }
        : null,
    [joinTarget]
  );

  const inviteUrl = useMemo(() => {
    if (!currentRoomId) return '';
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/?roomId=${currentRoomId}`;
    }
    const fallback = process.env.NEXT_PUBLIC_CLIENT_URL || 'http://localhost:3001';
    return `${fallback}/?roomId=${currentRoomId}`;
  }, [currentRoomId]);

  const isHostClient = Boolean(
    hostSessionId && clientSessionId && hostSessionId === clientSessionId
  );

  const [phaserGame, setPhaserGame] = useState<any>(null);

  const showInGameUI = Boolean(phaserGame && currentRoomId);
  const shouldShowFloorLeveragePrompt =
    showInGameUI &&
    isDialogueOpen &&
    (dialogueState.npcCharacterId || '').toLowerCase() === 'stani' &&
    isHostClient &&
    !leverageState.floorLocked &&
    leverageState.staniActive;
  const shouldShowRoomLeveragePrompt =
    showInGameUI &&
    isHostClient &&
    roomPhase === 'in_game' &&
    !leverageState.roomLocked &&
    !shouldShowFloorLeveragePrompt;

  const sendLeverageCommand = useCallback(
    (type: 'floor' | 'room', value: number) => {
      const scene = getGameScene();
      const room = scene?.room;
      if (!room) {
        return false;
      }
      const normalized = Math.max(
        LEVERAGE_MIN,
        Math.min(LEVERAGE_MAX, Number(value) || LEVERAGE_MIN)
      );
      try {
        room.send(
          type === 'floor' ? 'leverage:set_floor' : 'leverage:set_room',
          { value: normalized }
        );
        return true;
      } catch (error) {
        console.error('Failed to send leverage update', {
          type,
          value: normalized,
          error,
        });
        return false;
      }
    },
    []
  );

  const handleFloorLeverageConfirm = useCallback(() => {
    const submitted = sendLeverageCommand('floor', pendingFloorLeverage);
    if (submitted) {
      closeDialogue();
    }
    return submitted;
  }, [pendingFloorLeverage, sendLeverageCommand, closeDialogue]);

  const handleFloorLeverageSkip = useCallback(() => {
    const submitted = sendLeverageCommand('floor', LEVERAGE_MIN);
    if (submitted) {
      closeDialogue();
    }
  }, [sendLeverageCommand, closeDialogue]);

  const handleRoomLeverageConfirm = useCallback(() => {
    sendLeverageCommand('room', pendingRoomLeverage);
  }, [pendingRoomLeverage, sendLeverageCommand]);

  const handleRoomLeverageReset = useCallback(() => {
    sendLeverageCommand('room', LEVERAGE_MIN);
  }, [sendLeverageCommand]);

  const handleDialogueClose = useCallback(() => {
    if (shouldShowFloorLeveragePrompt) {
      const submitted = handleFloorLeverageConfirm();
      if (!submitted) {
        closeDialogue();
      }
      return;
    }
    closeDialogue();
  }, [
    shouldShowFloorLeveragePrompt,
    handleFloorLeverageConfirm,
    closeDialogue,
  ]);

  const handleDialogueResponse = useCallback(
    (nextDialogue: string) => {
      if (shouldShowFloorLeveragePrompt && nextDialogue === 'end') {
        const submitted = handleFloorLeverageConfirm();
        if (!submitted) {
          selectResponse(nextDialogue);
        }
        return;
      }

      if (nextDialogue === 'daily_quest') {
        const difficultyId = resolvedDifficultyTier;
        if (!difficultyId) {
          // No difficulty selected; fall back to default dialogue flow.
          selectResponse(nextDialogue);
          return;
        }

        const baseUrl = getAppServerBaseUrl();
        const endpoint = baseUrl
          ? `${baseUrl}/api/daily-runs/preview?difficultyId=${encodeURIComponent(
              difficultyId
            )}`
          : `/api/daily-runs/preview?difficultyId=${encodeURIComponent(
              difficultyId
            )}`;

        void (async () => {
          try {
            const res = await fetch(endpoint, {
              method: 'GET',
              credentials: 'include',
            });

            if (!res.ok) {
              selectResponse(nextDialogue);
              return;
            }

            const data = (await res.json()) as {
              remainingAttunements?: number;
              thresholdScore?: number;
            };

            const threshold = Number.isFinite(
              Number(data?.thresholdScore ?? NaN)
            )
              ? Math.max(0, Math.floor(Number(data!.thresholdScore)))
              : null;
            setDailyQuestThresholdScore(threshold);

            if (
              typeof data?.remainingAttunements === 'number' &&
              data.remainingAttunements <= 0
            ) {
              // No Daily Quest attunements remaining today — show Nyx's warning line instead.
              setDailyQuestActive(false);
              selectResponse('daily_quest_unavailable');
            } else {
              // Attunement still available; proceed to the regular Daily Quest dialogue.
              setDailyQuestActive(false);
              selectResponse(nextDialogue);
            }
          } catch {
            // On network errors, fall back to the regular dialogue so the flow doesn't break.
            selectResponse(nextDialogue);
          }
        })();

        // Defer dialogue transition until after we know the attunement state.
        return;
      }

      if (nextDialogue === 'daily_quest_confirm') {
        const difficultyId = resolvedDifficultyTier;
        if (!difficultyId) {
          handleShowToast({
            id: `daily-quest-error-${Date.now()}`,
            type: 'error',
            message:
              'Unable to attune Daily Quest run: no difficulty selected.',
          });
          setDailyQuestActive(false);
          return;
        }

        const baseUrl = getAppServerBaseUrl();
        const endpoint = baseUrl
          ? `${baseUrl}/api/daily-runs/attune`
          : '/api/daily-runs/attune';

        void (async () => {
          try {
            const res = await fetch(endpoint, {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ difficultyId }),
            });

            if (!res.ok) {
              let errorMessage = 'Failed to attune Daily Quest run.';
              let errorCode: string | null = null;
              try {
                const data = (await res.json()) as {
                  error?: string;
                  thresholdScore?: number;
                } | null;
                if (data?.error) {
                  errorMessage = data.error;
                  errorCode = data.error;
                }

                const threshold = Number.isFinite(
                  Number(data?.thresholdScore ?? NaN)
                )
                  ? Math.max(0, Math.floor(Number(data!.thresholdScore)))
                  : null;
                setDailyQuestThresholdScore(threshold);
              } catch {
                // ignore JSON parse errors
              }

              handleShowToast({
                id: `daily-quest-error-${Date.now()}`,
                type: 'error',
                message: errorMessage,
              });
              setDailyQuestActive(false);

              if (errorCode === 'No attunements remaining today') {
                selectResponse('daily_quest_unavailable');
              }
            } else {
              try {
                const data = (await res.json()) as {
                  thresholdScore?: number;
                } | null;
                const threshold = Number.isFinite(
                  Number(data?.thresholdScore ?? NaN)
                )
                  ? Math.max(0, Math.floor(Number(data!.thresholdScore)))
                  : null;
                setDailyQuestThresholdScore(threshold);
              } catch {
                // ignore JSON parse errors
              }

              setDailyQuestActive(true);
              handleShowToast({
                id: `daily-quest-attuned-${Date.now()}`,
                type: 'info',
                message:
                  'Daily Quest run attuned. Defeat the boss and beat the target score for a payout.',
              });
              selectResponse('daily_quest_confirm');
            }
          } catch {
            handleShowToast({
              id: `daily-quest-error-${Date.now()}`,
              type: 'error',
              message: 'Network error while attuning Daily Quest run.',
            });
            setDailyQuestActive(false);
          }
        })();

        // Do not advance dialogue immediately; wait for attunement result.
        return;
      }

      selectResponse(nextDialogue);
    },
    [
      shouldShowFloorLeveragePrompt,
      handleFloorLeverageConfirm,
      selectResponse,
      resolvedDifficultyTier,
      handleShowToast,
    ]
  );

  // After hydration, if a dynamic gotchi is selected, apply the stored sprite override
  useEffect(() => {
    if (!isCharacterHydrated) return;
    if (!resolvedCharacterId || !resolvedCharacterId.startsWith('gotchi:'))
      return;

    const selectedId: string = resolvedCharacterId;
    const storedUrl = effectivePreferences.gotchiSpriteUrl;
    if (storedUrl) {
      setCharacterSpriteOverride(selectedId, {
        imagePath: storedUrl,
        frameWidth: 100,
        frameHeight: 100,
      });
      return;
    }

    const SERVER_BASE_URL =
      process.env.NEXT_PUBLIC_APP_SERVER_URL || 'http://localhost:1999';
    const gotchiId = selectedId.split(':')[1];
    let cancelled = false;

    async function hydrateSprite() {
      try {
        const res = await fetch(`${SERVER_BASE_URL}/api/gotchis`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data: {
          sprites?: Array<{ id: number; url: string; hash: string }>;
        } = await res.json();
        const meta = (data.sprites || []).find(
          (m) => String(m.id) === String(gotchiId)
        );
        if (!meta || cancelled) return;
        const finalUrl = `${SERVER_BASE_URL}${meta.url}`;
        setCharacterSpriteOverride(selectedId, {
          imagePath: finalUrl,
          frameWidth: 100,
          frameHeight: 100,
        });
        void updatePlayerPreferences({ gotchiSpriteUrl: finalUrl });
      } catch (error) {
        console.warn('Failed to hydrate gotchi sprite', error);
      }
    }

    hydrateSprite();
    return () => {
      cancelled = true;
    };
  }, [
    effectivePreferences.gotchiSpriteUrl,
    isCharacterHydrated,
    resolvedCharacterId,
    updatePlayerPreferences,
  ]);

  // Store player avatar ID for consistency across room transitions
  const [playerAvatarId, setPlayerAvatarIdState] = useState<string | null>(
    null
  );

  const persistPlayerAvatarId = useCallback(
    (nextValue: SetStateAction<string | null>) => {
      setPlayerAvatarIdState((current) => {
        const resolved =
          typeof nextValue === 'function'
            ? (nextValue as (prev: string | null) => string | null)(current)
            : nextValue;

        if (current === resolved) {
          return current;
        }

        if (canLoadPlayerData) {
          void updatePlayerPreferences({ avatarId: resolved ?? null });
        }
        return resolved ?? null;
      });
    },
    [canLoadPlayerData, updatePlayerPreferences]
  );

  // Use ref to access current avatar ID during room transitions
  const playerAvatarIdRef = useRef<string | null>(playerAvatarId);

  // Update ref when state changes
  useEffect(() => {
    playerAvatarIdRef.current = playerAvatarId;
  }, [playerAvatarId]);

  const handleCharacterSelect = useCallback(
    async (
      characterId: string,
      options?: {
        gotchiSpriteUrl?: string | null;
      }
    ) => {
      setSelectedCharacterId(characterId);
      const payload: Partial<PlayerPreferencesSnapshot> = {
        selectedCharacterId: characterId,
      };
      if (options && 'gotchiSpriteUrl' in options) {
        payload.gotchiSpriteUrl = options.gotchiSpriteUrl ?? null;
      }
      if (canLoadPlayerData) {
        await updatePlayerPreferences(payload);
      }
    },
    [canLoadPlayerData, updatePlayerPreferences]
  );

  const handleUnlockCharacter = useCallback(
    async (characterId: string) => {
      try {
        const result = await unlockCharacter(characterId);
        setSelectedCharacterId(result.selectedCharacterId ?? characterId);
        await refreshProgression().catch(() => undefined);
      } catch (error) {
        throw error;
      }
    },
    [unlockCharacter, refreshProgression]
  );

  const handleDifficultySelect = useCallback(
    (tierId: string) => {
      setSelectedDifficultyTier(tierId);
      if (canLoadPlayerData) {
        void updatePlayerPreferences({ selectedDifficultyTier: tierId });
      }
    },
    [canLoadPlayerData, updatePlayerPreferences]
  );

  const handleAudioSettingsChange = useCallback(
    (settings: AudioSettings) => {
      if (canLoadPlayerData) {
        void updatePlayerPreferences({ audioSettings: settings });
      }
    },
    [canLoadPlayerData, updatePlayerPreferences]
  );

  const [forceTreasureRoom, setForceTreasureRoom] = useState(false);
  const [floorIndex, setFloorIndex] = useState<number>(1);
  const [portalsOpened, setPortalsOpened] = useState<boolean>(false);
  const [tonguesCollectedThisRun, setTonguesCollectedThisRun] =
    useState<number>(0);

  const syncProgressionWithGame = useCallback(
    (nextProfile: ProgressionProfile) => {
      const scene = getGameScene();
      if (scene?.updateProgressionProfile) {
        scene.updateProgressionProfile(nextProfile);
      }
    },
    []
  );

  // Note: Inventory is now client-side only - no need to send to server
  // Server handles its own inventory tracking for auto-healing

  // Initialize Phaser game directly when game starts
  useEffect(() => {
    if (gameStarted && typeof window !== 'undefined' && !phaserGame) {
      if (process.env.NEXT_PUBLIC_DEBUG === '1') {
        console.log(
          'Initializing Phaser game following Colyseus tutorial pattern...'
        );
      }

      const bootPhaser = async () => {
        if (!resolvedCharacterId) {
          setError('Select a hero to play.');
          setIsStarting(false);
          setGameStarted(false);
          return;
        }
        const options: InitPhaserOptions = {
          playerName,
          joinTarget,
          selectedRegionId,
          selectedDifficultyTier: resolvedDifficultyTier,
          isWalletConnected,
          walletAddress,
          isMobile,
          playerAvatarId,
          selectedCharacterId: resolvedCharacterId,
          debugTreasureRoom: forceTreasureRoom,
          audioSettings: effectivePreferences.audioSettings,
          progressionProfile,
          handleServerProfileMessage,
          handleServerXpAward,
          handleServerLevelLoss,
          handleKillStreakProfile,
          handleKillStreakUpdate,
          handleKillStreakReset,
          setCurrentRoomId,
          setHostSessionId,
          setPlayerCount,
          setMaxPlayers,
          setRoomPhase,
          setCountdownEndsAt,
          setAutoCloseAt,
          setLateJoinCutoffAt,
          setStartedByPlayerId,
          setRunStartedAt,
          requiredCredits,
          consumeCredits,
          pendingCreditsRef,
          setError,
          setIsStarting,
          setGameStarted,
          handleDisconnect,
          setConnectionStatus,
          setPing,
          setPacketLoss,
          setServerRegion,
          setNextTimedSpawnAt,
          setEnemyCount,
          setEnemyDifficultyLevel,
          setEnemyDifficultyNextAt,
          setEnemyDifficultyEnabled,
          setHuntedIntensityLevel,
          setHuntedNextSpawnAt,
          setHuntedEnabled,
          setPortalQuestLabel,
          setFloorIndex,
          setPortalsOpened,
          // callback invoked by scene when a Lick Tongue is picked up
          incrementRunTongues: (amount: number) =>
            setTonguesCollectedThisRun((v) =>
              Math.max(0, Math.floor(v + Math.max(1, Math.floor(amount || 1))))
            ),
          setPlayerAvatarId: persistPlayerAvatarId,
          addItemToInventory,
          showPickupToast,
          setDroppedItems,
          startDialogue,
          resolveDialogueAction: resolveAction,
          setToastNotification,
          setToastItem,
          setGrenadeState,
          setScoreState,
          setWeaponHudState,
          setSpellState: setSpellHudState,
          setLeverageState,
          setLeverageError,
          setRunKills,
          setClientSessionId,
          setInventoryItems,
          setHasVictory,
          handleInventoryToggle,
          handleShopToggle,
          setPhaserGame,
        };

        try {
          await initPhaser(options);
        } catch (err) {
          console.error('Failed to initialize Phaser game:', err);
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to initialize game client'
          );
          setGameStarted(false);
        } finally {
          setForceTreasureRoom(false);
        }
      };

      setTimeout(bootPhaser, 100);
    }
  }, [
    gameStarted,
    phaserGame,
    playerName,
    isWalletConnected,
    walletAddress,
    forceTreasureRoom,
  ]);

  // Mobile detection
  useEffect(() => {
    const checkMobileAndOrientation = () => {
      const isMobileDevice = () => {
        return (
          /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent
          ) || window.innerWidth <= 768
        );
      };

      const mobile = isMobileDevice();
      const landscape =
        window.innerHeight <= 768 && window.innerWidth > window.innerHeight;

      setIsMobile(mobile);
      setIsMobileLandscape(mobile && landscape);
    };

    checkMobileAndOrientation();

    const handleResize = () => {
      checkMobileAndOrientation();
    };

    const handleOrientationChange = () => {
      // Small delay to ensure dimensions are updated
      setTimeout(checkMobileAndOrientation, 100);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, []);

  useEffect(() => {
    if (!leverageError) {
      return;
    }
    const reason = leverageError;
    const message =
      reason === 'not_host'
        ? 'Only the host can adjust leverage.'
        : reason === 'floor_locked'
          ? 'Floor leverage is already locked.'
          : reason === 'room_locked'
            ? 'Room leverage is already locked.'
            : reason === 'leverage_disabled'
              ? 'Leverage is disabled in this room.'
              : 'Unable to update leverage.';
    setToastNotification({
      id: `leverage-${Date.now()}`,
      type: 'error',
      message,
    });
    const timeoutId = window.setTimeout(() => {
      setToastNotification(null);
    }, 3000);
    setLeverageError(null);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [leverageError, setToastNotification]);

  useEffect(() => {
    const next = leverageState.floor ?? LEVERAGE_MIN;
    if (!Number.isFinite(next)) {
      return;
    }
    setPendingFloorLeverage(
      Math.max(LEVERAGE_MIN, Math.min(LEVERAGE_MAX, Number(next)))
    );
  }, [leverageState.floor]);

  useEffect(() => {
    const next = leverageState.room ?? LEVERAGE_MIN;
    if (!Number.isFinite(next)) {
      return;
    }
    setPendingRoomLeverage(
      Math.max(LEVERAGE_MIN, Math.min(LEVERAGE_MAX, Number(next)))
    );
  }, [leverageState.room]);

  // UI handlers for inventory

  const handleInventoryToggle = useCallback(() => {
    setIsInventoryOpen((prev) => !prev);
  }, []);

  const handleShopToggle = useCallback(() => {
    setToastNotification({
      id: `shop_hint_${Date.now()}`,
      type: 'info',
      message: 'Talk to Nyx in Staging to trade items.',
    });
    setTimeout(() => setToastNotification(null), 3600);
  }, []);

  const showPickupToast = (item: InventoryItem) => {
    setToastItem(item);
  };

  const hideToast = () => {
    setToastItem(null);
    setToastNotification(null);
  };

  const handleViewInventoryFromToast = () => {
    setIsInventoryOpen(true);
  };

  function handleShowToast(notification: {
    id: string;
    type: string;
    message: string;
  }) {
    setToastNotification({
      id: notification.id,
      type: notification.type as
        | 'portal_guardian_spawn'
        | 'portals_opened'
        | 'error'
        | 'info',
      message: notification.message,
    });

    // Auto-hide toast after duration
    setTimeout(() => setToastNotification(null), 4000);
  }

  // Add inventory item messages into dock
  useEffect(() => {
    if (!toastItem) return;
    const id = `item_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let message =
      `+${toastItem.quantity} ${toastItem.type === 'wearable' ? '' : toastItem.name}`.trim();
    const usdcAmount = (toastItem as any)?.usdcAmount;
    if (
      toastItem.type === 'coin' &&
      typeof usdcAmount === 'number' &&
      Number.isFinite(usdcAmount)
    ) {
      message = `+$${usdcAmount.toFixed(2)} USDC`;
    }

    const entry: NotificationEntry = {
      id,
      message,
      variant: 'success',
      icon: 'check',
      showViewButton: true,
      createdAt: Date.now(),
      item: toastItem,
    };

    setNotifications((prev) => [entry, ...prev].slice(0, 100));
    setIsDockOpen(true);
  }, [toastItem]);

  // Add global toasts into dock as status entries
  useEffect(() => {
    if (!toastNotification) return;
    const id = toastNotification.id || `notif_${Date.now()}`;
    const variant: NotificationEntry['variant'] =
      toastNotification.type === 'error'
        ? 'error'
        : toastNotification.type === 'success'
          ? 'success'
          : 'info';
    const icon: NotificationEntry['icon'] =
      variant === 'error' ? 'alert' : variant === 'success' ? 'check' : 'info';
    const entry: NotificationEntry = {
      id,
      message: toastNotification.message,
      variant,
      icon,
      createdAt: Date.now(),
    };
    setNotifications((prev) => [entry, ...prev].slice(0, 100));
    setIsDockOpen(true);
  }, [toastNotification]);

  const handleDismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handleClearAllNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  // Compute dynamic quest label via QuestSystem (top-level effect)
  useEffect(() => {
    if (roomPhase !== 'in_game') {
      setPortalQuestLabel('');
      setTonguesCollectedThisRun(0);
      return;
    }
    const label = computeQuestText({
      roomPhase,
      floorIndex,
      portalsOpened,
      tonguesCollectedThisRun,
    });
    setPortalQuestLabel(label);
  }, [roomPhase, floorIndex, portalsOpened, tonguesCollectedThisRun]);

  const handleServerProfileMessage = useCallback(
    (message: ProgressionProfileMessage) => {
      if (message?.profile) {
        applyServerProfile(message);
      }
    },
    [applyServerProfile]
  );

  const handleServerXpAward = useCallback(
    (message: ProgressionXpAwardMessage) => {
      applyServerXpAward(message);
    },
    [applyServerXpAward]
  );

  const handleServerLevelLoss = useCallback(
    (message: ProgressionLevelLostMessage) => {
      applyServerLevelLoss(message);
    },
    [applyServerLevelLoss]
  );

  const handleKillStreakProfile = useCallback(
    (message: KillStreakProfileMessage) => {
      if (message) {
        applyKillStreakProfile(message);
      }
    },
    [applyKillStreakProfile]
  );

  const handleKillStreakUpdate = useCallback(
    (message: KillStreakUpdatedMessage) => {
      if (message) {
        applyKillStreakUpdate(message);
      }
    },
    [applyKillStreakUpdate]
  );

  const handleKillStreakReset = useCallback(
    (message: KillStreakResetMessage) => {
      applyKillStreakReset(message);
    },
    [applyKillStreakReset]
  );

  const {
    units: killStreakUnits,
    archetypeId: killStreakArchetypeId,
    isActive: killStreakActive,
  } = killStreakState;

  // Track previous levels to trigger dock notifications on level-up
  const prevMetaLevelRef = useRef<number>(
    Math.max(1, Math.floor(progressionProfile.level))
  );
  const prevKillStreakUnitsRef = useRef<number>(killStreakUnits);

  // Add a dock notification when meta level increases
  useEffect(() => {
    const current = Math.max(1, Math.floor(progressionProfile.level));
    const prev = Math.max(1, Math.floor(prevMetaLevelRef.current));
    if (current > prev) {
      const entry: NotificationEntry = {
        id: `level_${Date.now()}`,
        message: `Level Up! Level ${current}`,
        variant: 'success',
        emoji: '🎉',
        createdAt: Date.now(),
      };
      setNotifications((prevList) => [entry, ...prevList].slice(0, 100));
      setIsDockOpen(true);
    }
    prevMetaLevelRef.current = current;
  }, [progressionProfile.level]);

  // Add a dock notification when kill streak crosses notable thresholds
  useEffect(() => {
    const currentUnits = killStreakUnits;
    const previousUnits = prevKillStreakUnitsRef.current;
    const thresholds = [50, 100, 200];
    const crossedThreshold = thresholds.find(
      (value) => previousUnits < value && currentUnits >= value
    );

    if (crossedThreshold !== undefined) {
      const entry: NotificationEntry = {
        id: `kill_streak_${crossedThreshold}_${Date.now()}`,
        message: `Kill Streak ${Math.floor(currentUnits)}!`,
        variant: 'success',
        emoji: '🔥',
        createdAt: Date.now(),
      };
      setNotifications((prevList) => [entry, ...prevList].slice(0, 100));
      setIsDockOpen(true);
    }

    if (currentUnits === 0 && previousUnits > 0) {
      const entry: NotificationEntry = {
        id: `kill_streak_reset_${Date.now()}`,
        message: 'Kill Streak reset',
        variant: 'info',
        emoji: '💀',
        createdAt: Date.now(),
      };
      setNotifications((prevList) => [entry, ...prevList].slice(0, 100));
    }

    prevKillStreakUnitsRef.current = currentUnits;
  }, [killStreakUnits]);

  const handleProfileCommit = useCallback(
    (nextProfile: ProgressionProfile) => {
      void (async () => {
        const copy = cloneProgressionProfile(nextProfile);
        const saved = await saveProgressionProfile(copy);
        if (saved) {
          if (gameStarted) {
            syncProgressionWithGame(saved);
          }
          const id = crypto.randomUUID();
          setToastNotification({
            id,
            type: 'success',
            message: 'Stats updated successfully.',
          });
          setTimeout(() => setToastNotification(null), 4000);
        } else {
          const id = crypto.randomUUID();
          setToastNotification({
            id,
            type: 'error',
            message: 'Failed to save stats. Please try again.',
          });
          setTimeout(() => setToastNotification(null), 4000);
        }
      })();
    },
    [saveProgressionProfile, gameStarted, syncProgressionWithGame]
  );

  const handleAddXp = useCallback(
    (amount: number) => {
      const result = applyXpToProgression(progressionProfile, amount);
      const nextProfile = cloneProgressionProfile(result.profile);
      updateProgressionProfile(() => nextProfile);
      if (gameStarted) {
        syncProgressionWithGame(nextProfile);
      }
    },
    [
      progressionProfile,
      updateProgressionProfile,
      gameStarted,
      syncProgressionWithGame,
    ]
  );

  const handleResetProgression = useCallback(() => {
    void (async () => {
      const saved = await resetProgressionProfile();
      const next = saved ?? createDefaultProfile();
      updateProgressionProfile(() => next);
      if (gameStarted) {
        syncProgressionWithGame(next);
      }
      const id = crypto.randomUUID();
      setToastNotification({
        id,
        type: 'success',
        message: 'Profile reset to level 1.',
      });
      setTimeout(() => setToastNotification(null), 3000);
    })();
  }, [
    resetProgressionProfile,
    updateProgressionProfile,
    gameStarted,
    syncProgressionWithGame,
  ]);

  const handleUseItem = (itemId: string) => {
    const item = inventoryItems.find((i) => i.id === itemId);
    if (!item) return;

    // Use the ItemSystem through the Phaser game scene
    if (phaserGame) {
      const scene = getGameScene();
      if (scene.useItem) {
        scene.useItem(item, (itemId: string, quantity: number) => {
          removeItemFromInventory(itemId, quantity);
        });
      } else {
        console.log('ItemSystem not available on game scene');
      }
    } else {
      console.log('Cannot use item - game not available');
    }
  };

  const handleTopUpCredits = useCallback(async () => {
    const success = await topUpCredits(CREDITS_TOP_UP_INCREMENT);
    const id = crypto.randomUUID();

    if (success) {
      setToastNotification({
        id,
        type: 'success',
        message: `Added ${CREDITS_TOP_UP_INCREMENT} credits.`,
      });
    } else {
      setToastNotification({
        id,
        type: 'error',
        message: 'Failed to top up credits. Please try again.',
      });
    }

    setTimeout(() => setToastNotification(null), 4000);
  }, [topUpCredits]);

  const handleStartGame = async () => {
    if (isStarting) return;
    if (ctaDisabled) {
      if (
        ctaDisabledReason &&
        ctaDisabledReason !== 'Loading room details...'
      ) {
        setError(ctaDisabledReason);
      }
      return;
    }

    setIsStarting(true);
    setError(null);
    setHasVictory(false);

    try {
      // Just start the game - Phaser will initialize after gameStarted becomes true
      setGameStarted(true);
    } catch (err) {
      console.error('Failed to start game:', err);
      setError(err instanceof Error ? err.message : 'Failed to start game');
    } finally {
      setIsStarting(false);
    }
  };

  const handleStartTreasureRoom = async () => {
    if (isStarting) return;
    setIsStarting(true);
    setError(null);
    setHasVictory(false);
    setForceTreasureRoom(true);

    try {
      setGameStarted(true);
    } catch (err) {
      console.error('Failed to start debug treasure room:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to start debug treasure room'
      );
      setForceTreasureRoom(false);
    } finally {
      setIsStarting(false);
    }
  };

  const handleDisconnect = () => {
    if (roomPhase === 'in_game' && runStartedAt > 0) {
      setShowRunSummary(true);
    } else {
      performDisconnect();
    }
  };

  const performDisconnect = () => {
    if (phaserGame) {
      try {
        const scene = getGameScene();
        scene?.room?.leave?.();
      } catch (error) {
        console.warn('Failed to leave Colyseus room cleanly', error);
      }
      phaserGame.destroy(true);
      setPhaserGame(null);
    }
    setGameStarted(false);
    setError(null);
    setCurrentRoomId('');
    setHostSessionId('');
    setClientSessionId('');
    setPlayerCount(0);
    setGrenadeState({ grenades: [], armedGrenadeSlug: null });
    setScoreState({ score: 0, eligible: true });
    setHasVictory(false);
    setForceTreasureRoom(false);
    setRunKills(0);
    setRunItemsPickedUp([]);
    setShowRunSummary(false);
    setRunEndedAt(null);
    // Return to Play view
  };

  const handleRunSummaryClose = () => {
    setShowRunSummary(false);
  };

  const handleRunSummaryConfirm = () => {
    setShowRunSummary(false);
    performDisconnect();
  };

  const handleRunSummaryShare = () => {
    const summaryData = getRunSummaryData();
    if (summaryData) {
      const text = `Run Summary:\nDuration: ${formatDuration(summaryData.durationMs)}\nKills: ${summaryData.kills}\nScore: ${summaryData.score.toLocaleString()}\nFloor: ${summaryData.floorReached}\nLeverage: ${formatLeverageDisplay(summaryData.leverageTotal)}\nItems: ${summaryData.itemsPickedUp.length}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setToastNotification({
              id: crypto.randomUUID(),
              type: 'success',
              message: 'Run summary copied to clipboard!',
            });
            setTimeout(() => setToastNotification(null), 3000);
          })
          .catch(() => {});
      } else {
        // no clipboard available
      }
    }
  };

  const formatDuration = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const getRunSummaryData = (): RunSummaryData | null => {
    if (roomPhase !== 'in_game' || runStartedAt <= 0) {
      return null;
    }

    const endTs = runEndedAt ?? Date.now();
    const durationMs = Math.max(0, endTs - runStartedAt);
    const score = scoreState.score || 0;

    return {
      durationMs,
      kills: runKills,
      score,
      floorReached: floorIndex,
      itemsPickedUp: runItemsPickedUp,
      leverageTotal: Number(leverageState.total || 1),
    };
  };

  // Mobile control handlers
  const handleMobileMove = (direction: {
    x: number;
    y: number;
    isMoving: boolean;
  }) => {
    if (phaserGame) {
      const scene = getGameScene();
      if (scene.handleMobileInput) {
        scene.handleMobileInput({
          left: direction.x < -0.1,
          right: direction.x > 0.1,
          up: direction.y < -0.1,
          down: direction.y > 0.1,
          sprint: false,
        });
      }
    }
  };

  const handleWeaponCycle = () => {
    if (phaserGame) {
      const scene = getGameScene();
      if (scene.switchWeapon) {
        scene.switchWeapon();
      }
    }
  };

  const handleGrenadeSelection = (slug: string | null) => {
    if (phaserGame) {
      const scene = getGameScene();
      if (scene.armGrenade) {
        scene.armGrenade(slug);
      }
    }
  };

  const handleWeaponSelect = (index: number) => {
    if (phaserGame) {
      const scene = getGameScene();
      if (scene.setActiveWeaponIndex) {
        scene.setActiveWeaponIndex(index);
      }
    }
  };

  const handleSpellCast = (spellId: string) => {
    if (!spellId) return;
    const scene = getGameScene();
    if (scene?.castSpell) {
      scene.castSpell(spellId);
    }
  };

  const handleSpellAutocastToggle = (spellId: string, enabled: boolean) => {
    const scene = getGameScene();
    if (scene?.setSpellAutocast) {
      scene.setSpellAutocast(spellId, enabled);
    }
  };

  // Keyboard handler for Quick Join button (Enter key)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle Enter key when lobby is visible and Quick Join button is available
      if (
        event.key === 'Enter' &&
        !gameStarted &&
        !ctaDisabled &&
        !isStarting &&
        !event.repeat
      ) {
        // Prevent default to avoid form submission if any
        event.preventDefault();
        handleStartGame();
      }
    };

    // Add event listener when lobby is visible
    if (!gameStarted) {
      document.addEventListener('keydown', handleKeyDown);
    }

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [gameStarted, ctaDisabled, isStarting, handleStartGame]);

  const isPreferencesReady =
    isSessionVerified && (!canLoadPlayerData || arePreferencesHydrated);

  // Central players realtime updates (initial + subsequent)
  usePlayerStream(
    scopedPlayerId,
    walletAddress,
    async () => {
      if (!hasActiveWallet || !hasValidSession || !isSessionSynced) {
        return;
      }

      const baseUrl = (process.env.NEXT_PUBLIC_SERVER_URL || '').replace(
        /\/$/,
        ''
      );
      const endpoint = baseUrl ? `${baseUrl}/api/player` : '/api/player';
      try {
        const res = await fetch(endpoint, {
          credentials: 'include',
          cache: 'no-store',
        });

        if (!res.ok) return;
        const payload = await res.json();

        // Apply preferences from payload
        const nextDefaults = {
          ...preferenceDefaults,
          ...(payload?.defaults || {}),
        } as PlayerPreferencesSnapshot;
        const nextEffective = {
          ...nextDefaults,
          ...(payload?.effective || {}),
        } as PlayerPreferencesSnapshot;

        // Apply progression from payload
        if (payload?.profile && gameStarted) {
          const incomingTotalXp = Math.max(
            0,
            Number(payload.profile.totalXp) || 0
          );
          const currentTotalXp = Math.max(
            0,
            Number(progressionProfile.totalXp) || 0
          );
          const incomingLevel = Math.max(1, Number(payload.profile.level) || 1);
          const currentLevel = Math.max(
            1,
            Number(progressionProfile.level) || 1
          );
          const isStale =
            incomingTotalXp < currentTotalXp ||
            (incomingTotalXp === currentTotalXp &&
              incomingLevel < currentLevel);
          if (!isStale) {
            await refreshProgression(payload);
          }
        } else {
          await refreshProgression(payload);
        }
      } catch {
        // ignore
      }
    },
    scopedPlayerId
  );

  const handleDeallocateAll = useCallback(() => {
    void (async () => {
      const saved = await deallocateAllStats();
      if (!saved) {
        const id = crypto.randomUUID();
        setToastNotification({
          id,
          type: 'error',
          message: 'Failed to deallocate stats. Please try again.',
        });
        setTimeout(() => setToastNotification(null), 3000);
        return;
      }
      updateProgressionProfile(() => saved);
      if (gameStarted) {
        syncProgressionWithGame(saved);
      }
      const id = crypto.randomUUID();
      setToastNotification({
        id,
        type: 'success',
        message: 'All stat points refunded.',
      });
      setTimeout(() => setToastNotification(null), 3000);
    })();
  }, [
    deallocateAllStats,
    updateProgressionProfile,
    gameStarted,
    syncProgressionWithGame,
  ]);

  if (!canLoadPlayerData) {
    const landingMessage = () => {
      if (!isWalletConnected) {
        return 'Survive and earn yield.';
      }

      if (!isSessionVerified) {
        return 'Loading session...';
      }

      if (!isPreferencesReady) {
        return 'Loading player settings...';
      }
      return welcomeWalletLabel
        ? `Welcome back, ${welcomeWalletLabel}`
        : 'Survive and earn yield.';
    };

    return (
      <div
        className="min-h-screen bg-fixed bg-center bg-cover bg-no-repeat flex flex-col items-center justify-center gap-6 text-white text-center px-6"
        style={{ backgroundImage: 'url(/images/splash.png)' }}
      >
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-4xl font-bold uppercase tracking-[0.4em]">
            DeFi Dungeon
          </h1>
          {landingMessage() ? (
            <p className="text-sm mt-2 text-white/70 uppercase tracking-[0.3em]">
              {landingMessage()}
            </p>
          ) : null}
        </div>
        <WalletConnectControl variant="landing" />
      </div>
    );
  }

  if (!gameStarted) {
    const lobbyProps: LobbyProps = {
      selectedCharacterId: resolvedCharacterId,
      isCharacterHydrated,
      onCharacterSelect: handleCharacterSelect,
      onUnlockCharacter: handleUnlockCharacter,
      unlockedCharacters,
      selectedRegionId,
      onRegionSelect: setSelectedRegionId,
      selectedDifficultyTier: resolvedDifficultyTier,
      onDifficultySelect: handleDifficultySelect,
      onUnlockDifficulty: async (tierId: string) => {
        try {
          await unlockDifficulty(tierId);
          await refreshProgression();
        } catch {}
      },
      isWalletConnected,
      ctaLabel,
      ctaDisabled,
      ctaDisabledReason,
      joinInfo,
      isDifficultyLocked: Boolean(joinTarget),
      isRegionLocked: Boolean(joinTarget),
      isStarting,
      gameStarted,
      error,
      onStartGame: handleStartGame,
      onError: setError,
      onStartTreasureRoom: DEV_MODE ? handleStartTreasureRoom : undefined,
      unlockedTiers: unlockedDifficultyTiers,
      lickTongueCount,
      creditsBalance,
      creditsRequired: requiredCredits,
      hasSufficientCredits,
      onCreditTopUp: handleNavigateToTopUp,
      creditTopUpAmount: CREDITS_TOP_UP_INCREMENT,
      progressionProfile,
      onAdjustStats: handleAdjustStats,
    };

    return <Lobby {...lobbyProps} />;
  }

  const staniLeverageContent = shouldShowFloorLeveragePrompt ? (
    <div className="bg-slate-800/70 border border-white/10 rounded-2xl p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-white/50">
          Floor Leverage
        </p>
        <p className="text-lg font-hud tracking-[0.2em] text-white">
          Choose once per floor
        </p>
        <p className="text-sm text-white/60">
          Everyone on this floor shares the same multiplier.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-white/50">1x</span>
        <Slider
          min={LEVERAGE_MIN}
          max={LEVERAGE_MAX}
          step={0.5}
          value={[pendingFloorLeverage]}
          onValueChange={(values) => {
            const next = values[0];
            if (Number.isFinite(next)) {
              setPendingFloorLeverage(
                Math.max(LEVERAGE_MIN, Math.min(LEVERAGE_MAX, Number(next)))
              );
            }
          }}
        />
        <span className="text-xs text-white/50">10x</span>
      </div>
      <div className="text-center text-2xl font-hud tracking-[0.2em] text-emerald-300">
        {`Lx${pendingFloorLeverage.toFixed(1)}`}
      </div>
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={handleFloorLeverageSkip}
        >
          Keep 1x
        </Button>
        <Button className="flex-1" onClick={handleFloorLeverageConfirm}>
          Lock Floor
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <div className="game-container">
      <div id="game-container" className="w-full h-full relative">
        {/* SSR/early client overlay to prevent gray flash before Phaser mounts */}
        <div
          id="react-splash-overlay"
          className="absolute inset-0"
          style={{
            backgroundImage: 'url(/images/splash.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            zIndex: 1,
            opacity: 1,
            transition: 'opacity 180ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <div
            id="react-splash-text"
            className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/90 font-mono text-[14px] tracking-[0.25em] uppercase"
            style={{ textShadow: '0 2px 6px rgba(0,0,0,0.6)' }}
          >
            Initializing…
          </div>
          <div
            id="react-splash-scrim"
            className="absolute inset-0 bg-black"
            style={{ opacity: 0.0, transition: 'opacity 260ms ease-out' }}
          />
        </div>
      </div>

      {showInGameUI &&
        (isMobile ? (
          <MobileGameHUD
            onMove={handleMobileMove}
            // onSprint={handleMobileSprint}
            onWeaponCycle={handleWeaponCycle}
            onInventoryToggle={handleInventoryToggle}
            onChatToggle={() => {
              // TODO: Implement mobile chat interface
            }}
            onShowToast={handleShowToast}
            isWalletConnected={false}
            walletAddress={undefined}
            playerCount={playerCount}
            roomId={currentRoomId}
            inviteUrl={inviteUrl}
            isHost={isHostClient}
            weaponState={weaponHudState ?? undefined}
            onWeaponSelect={handleWeaponSelect}
            isConnected={!!phaserGame}
            inventoryItems={inventoryItems}
            spellState={spellHudState}
            onSpellCast={handleSpellCast}
            onSpellAutocastToggle={handleSpellAutocastToggle}
            ping={ping}
            connectionStatus={connectionStatus}
            packetLoss={packetLoss}
            serverRegion={
              SERVER_REGIONS.find((r) => r.id === selectedRegionId)?.name ||
              'Unknown'
            }
            roomPhase={roomPhase}
            countdownEndsAt={countdownEndsAt}
            autoCloseAt={autoCloseAt}
            portalQuestLabel={portalQuestLabel}
            portalCountdownLabel={portalCountdownLabel}
            enemyCount={enemyCount}
            nextTimedSpawnAt={nextTimedSpawnAt}
            enemyDifficultyLevel={enemyDifficultyLevel}
            enemyDifficultyNextAt={enemyDifficultyNextAt}
            enemyDifficultyEnabled={enemyDifficultyEnabled}
            huntedIntensityLevel={huntedIntensityLevel}
            huntedNextSpawnAt={huntedNextSpawnAt}
            huntedEnabled={huntedEnabled}
            grenadeState={grenadeState}
            onGrenadeSelect={handleGrenadeSelection}
            level={progressionProfile.level}
            xpIntoLevel={progressionLevelProgress.xpIntoLevel}
            xpForNextLevel={progressionLevelProgress.xpForNextLevel}
            unspentPoints={progressionProfile.unspentPoints}
            killStreakUnits={killStreakUnits}
            killStreakActive={killStreakActive && roomPhase === 'in_game'}
            killStreakArchetypeId={killStreakArchetypeId ?? undefined}
            victoryAvailable={hasVictory}
            onLeaveMatch={handleDisconnect}
            creditsBalance={creditsBalance}
            onCreditTopUp={handleNavigateToTopUp}
            creditTopUpAmount={CREDITS_TOP_UP_INCREMENT}
            score={roomPhase === 'in_game' ? scoreState.score : undefined}
            scoreEligible={scoreState.eligible}
            audioSettings={effectivePreferences.audioSettings}
            onAudioSettingsChange={handleAudioSettingsChange}
            floorIndex={floorIndex}
            leverageState={leverageState}
            dailyQuestActive={dailyQuestActive}
            dailyQuestRequiredScore={dailyQuestThresholdScore}
          />
        ) : (
          <GameHUD
            onSendChat={(text: string) => {
              // TODO: Implement chat via Phaser game scene
            }}
            onWeaponSelect={handleWeaponSelect}
            onInventoryToggle={handleInventoryToggle}
            isWalletConnected={false}
            walletAddress={undefined}
            playerCount={playerCount}
            maxPlayers={typeof maxPlayers === 'number' ? maxPlayers : undefined}
            roomId={currentRoomId}
            inviteUrl={inviteUrl}
            isHost={isHostClient}
            weaponState={weaponHudState ?? undefined}
            inventoryItems={inventoryItems}
            spellState={spellHudState}
            onSpellCast={handleSpellCast}
            onSpellAutocastToggle={handleSpellAutocastToggle}
            ping={ping}
            connectionStatus={connectionStatus}
            packetLoss={packetLoss}
            serverRegion={
              SERVER_REGIONS.find((r) => r.id === selectedRegionId)?.name ||
              'Unknown'
            }
            roomPhase={roomPhase}
            countdownEndsAt={countdownEndsAt}
            autoCloseAt={autoCloseAt}
            portalQuestLabel={portalQuestLabel}
            portalCountdownLabel={portalCountdownLabel}
            enemyCount={enemyCount}
            nextTimedSpawnAt={nextTimedSpawnAt}
            enemyDifficultyLevel={enemyDifficultyLevel}
            enemyDifficultyNextAt={enemyDifficultyNextAt}
            enemyDifficultyEnabled={enemyDifficultyEnabled}
            huntedIntensityLevel={huntedIntensityLevel}
            huntedNextSpawnAt={huntedNextSpawnAt}
            huntedEnabled={huntedEnabled}
            grenadeState={grenadeState}
            onGrenadeSelect={handleGrenadeSelection}
            level={progressionProfile.level}
            xpIntoLevel={progressionLevelProgress.xpIntoLevel}
            xpForNextLevel={progressionLevelProgress.xpForNextLevel}
            unspentPoints={progressionProfile.unspentPoints}
            killStreakUnits={killStreakUnits}
            killStreakActive={killStreakActive && roomPhase === 'in_game'}
            killStreakArchetypeId={killStreakArchetypeId ?? undefined}
            victoryAvailable={hasVictory}
            onLeaveMatch={handleDisconnect}
            creditsBalance={creditsBalance}
            onCreditTopUp={handleNavigateToTopUp}
            creditTopUpAmount={CREDITS_TOP_UP_INCREMENT}
            score={roomPhase === 'in_game' ? scoreState.score : undefined}
            scoreEligible={scoreState.eligible}
            leverageState={leverageState}
            audioSettings={effectivePreferences.audioSettings}
            onAudioSettingsChange={handleAudioSettingsChange}
            floorIndex={floorIndex}
            dailyQuestActive={dailyQuestActive}
            dailyQuestRequiredScore={dailyQuestThresholdScore}
          />
        ))}

      {/* Inventory Modal */}
      {showInGameUI && (
        <Inventory
          isOpen={isInventoryOpen}
          onClose={() => setIsInventoryOpen(false)}
          items={inventoryItems}
          onUseItem={handleUseItem}
        />
      )}

      {/* Right-side notification dock (disabled on mobile for now) */}
      {showInGameUI && !isMobile && (
        <NotificationDock
          items={notifications}
          isOpen={isDockOpen}
          onToggle={() => setIsDockOpen((v) => !v)}
          onDismiss={handleDismissNotification}
          onClearAll={handleClearAllNotifications}
          onViewInventory={handleViewInventoryFromToast}
        />
      )}

      {/* NPC Dialogue Box */}
      {showInGameUI && (
        <DialogueBox
          isOpen={isDialogueOpen}
          npcName={dialogueState.npcName || ''}
          npcCharacterId={dialogueState.npcCharacterId || ''}
          dialogueData={dialogueState.dialogueData}
          isProcessingAction={dialogueState.isProcessingAction}
          onResponseSelect={handleDialogueResponse}
          onClose={handleDialogueClose}
          extraContent={staniLeverageContent}
          dailyQuestDifficultyId={selectedDifficultyTier}
        />
      )}

      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-4 py-2 rounded-lg z-50">
          {error}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDisconnect}
            className="ml-2 text-white hover:text-gray-200"
          >
            Disconnect
          </Button>
        </div>
      )}

      {/* Debug info in development */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed bottom-4 left-4 bg-black/80 text-white p-2 rounded text-xs font-hud">
          <div>Game: {phaserGame ? '✅' : '❌'}</div>
          <div>Started: {gameStarted ? '✅' : '❌'}</div>
          <div>Room: {phaserGame ? 'Connected' : 'None'}</div>
        </div>
      )}

      {/* Run Summary Dialog */}
      <RunSummary
        isOpen={showRunSummary}
        data={getRunSummaryData()}
        onClose={handleRunSummaryClose}
        onConfirm={handleRunSummaryConfirm}
        onShare={handleRunSummaryShare}
      />
    </div>
  );
}
