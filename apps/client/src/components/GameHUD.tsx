import { useState, useEffect, useMemo } from 'react';
import {
  Volume2,
  VolumeX,
  Settings,
  Users,
  MessageCircle,
  Package,
  Download,
  Share,
  Smartphone,
  Coins,
  User,
  GaugeIcon,
  Zap,
  Flame,
  Layers,
  Trophy,
} from 'lucide-react';
import { Button } from './ui/Button';
import { Slider } from './ui/Slider';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/Dialog';
import { cn } from '../lib/utils';
import { RUN_ARCHETYPES_BY_ID } from '../data/archetypes';
import { formatKillStreakTrait } from '../lib/traits';
import {
  initializePWA,
  getPWAStatus,
  handlePWAAction as handlePWAActionUtil,
  hideSafariToolbar,
  type PWAStatus,
} from '../lib/pwa-utils';
import type { InventoryItem } from '../types/inventory';
import type { SpellHudState } from '../game/GameScene';
import type { GrenadeHudState, WeaponHudState } from '../game/GameScene';
import type { LeverageStatePayload } from '../types/messages';
import { AbilityBar } from './AbilityBar';
import type { AudioSettings } from '../types/preferences';
import { useCurrentPlayerHp } from '../hooks/useCurrentPlayerHp';
import { useCurrentPlayerMana } from '../hooks/useCurrentPlayerMana';
import { getGameScene } from '../lib/getGameScene';

interface GameHUDProps {
  onSendChat?: (message: string) => void;
  onWalletConnect?: () => void;
  onInventoryToggle?: () => void;
  isWalletConnected?: boolean;
  walletAddress?: string;
  playerCount?: number;
  maxPlayers?: number | null;
  roomId?: string;
  inviteUrl?: string;
  isHost?: boolean;
  inventoryItems?: InventoryItem[];
  grenadeState?: GrenadeHudState;
  onGrenadeSelect?: (slug: string | null) => void;
  weaponState?: WeaponHudState;
  onWeaponSelect?: (index: number) => void;
  spellState?: SpellHudState;
  onSpellCast?: (spellId: string) => void;
  onSpellAutocastToggle?: (spellId: string, enabled: boolean) => void;

  // Connection diagnostics
  ping?: number;
  connectionStatus?: 'connected' | 'disconnected' | 'reconnecting';
  packetLoss?: number;
  serverRegion?: string;
  roomPhase?: 'staging' | 'countdown' | 'in_game' | 'ended';
  countdownEndsAt?: number;
  autoCloseAt?: number;
  portalQuestLabel?: string;
  portalCountdownLabel?: string | null;
  // Timed-spawn HUD
  enemyCount?: number;
  nextTimedSpawnAt?: number; // Unix ms (0 = paused)
  enemyDifficultyLevel?: number;
  enemyDifficultyNextAt?: number;
  enemyDifficultyEnabled?: boolean;
  huntedIntensityLevel?: number;
  huntedNextSpawnAt?: number;
  huntedEnabled?: boolean;

  // Progression data
  level?: number;
  xpIntoLevel?: number;
  xpForNextLevel?: number;
  unspentPoints?: number;
  killStreakUnits?: number;
  killStreakActive?: boolean;
  killStreakArchetypeId?: string;

  // Victory state
  victoryAvailable?: boolean;
  onLeaveMatch?: () => void;

  // Credits
  creditsBalance?: number;
  onCreditTopUp?: (amount?: number) => void | Promise<void>;
  creditTopUpAmount?: number;
  score?: number;
  scoreEligible?: boolean;
  dailyQuestRequiredScore?: number | null;
  audioSettings: AudioSettings;
  onAudioSettingsChange: (settings: AudioSettings) => void;
  floorIndex?: number;
  leverageState?: LeverageStatePayload;
  dailyQuestActive?: boolean;
}

export function GameHUD({
  onSendChat,
  onInventoryToggle,
  playerCount = 0,
  maxPlayers = null,
  roomId = '',
  inviteUrl = '',
  isHost = false,
  inventoryItems = [],
  ping,
  connectionStatus = 'connected',
  packetLoss = 0,
  serverRegion = 'EU-Helsinki',
  roomPhase = 'in_game',
  countdownEndsAt = 0,
  autoCloseAt = 0,
  portalQuestLabel = '',
  portalCountdownLabel = null,
  enemyDifficultyLevel = 0,
  huntedIntensityLevel = 0,
  huntedNextSpawnAt = 0,
  huntedEnabled = false,
  grenadeState,
  onGrenadeSelect,
  weaponState,
  onWeaponSelect,
  spellState,
  onSpellCast,
  onSpellAutocastToggle,
  level = 1,
  xpIntoLevel = 0,
  xpForNextLevel = 0,
  killStreakUnits = 0,
  killStreakActive = false,
  killStreakArchetypeId,
  victoryAvailable = false,
  onLeaveMatch = () => {},
  score,
  scoreEligible = true,
  dailyQuestRequiredScore = null,
  audioSettings,
  onAudioSettingsChange,
  floorIndex,
  leverageState,
  dailyQuestActive = false,
}: GameHUDProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [showPlayerList, setShowPlayerList] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [pwaStatus, setPWAStatus] = useState<PWAStatus>({
    isInstalled: false,
    canInstall: false,
    isIOSSafari: false,
    isAndroidChrome: false,
    message: '',
  });
  const [chatMessage, setChatMessage] = useState('');
  const [chatMessages, setChatMessages] = useState<
    Array<{
      id: string;
      playerName: string;
      text: string;
      timestamp: number;
    }>
  >([]);

  const [inviteCopied, setInviteCopied] = useState(false);

  useEffect(() => {
    setInviteCopied(false);
  }, [inviteUrl]);

  useEffect(() => {
    if (!isHost) {
      setInviteCopied(false);
    }
  }, [isHost]);

  useEffect(() => {
    const gameScene = getGameScene();
    if (gameScene && typeof gameScene.refreshAudioSettings === 'function') {
      gameScene.refreshAudioSettings(audioSettings);
    }
  }, [audioSettings]);

  // Initialize PWA functionality
  useEffect(() => {
    // Initialize PWA event listeners
    const cleanup = initializePWA();

    // Set initial PWA status
    setPWAStatus(getPWAStatus());

    // Hide Safari toolbar if on iOS Safari
    hideSafariToolbar();

    // Update PWA status periodically (in case install prompt becomes available)
    const statusInterval = setInterval(() => {
      setPWAStatus(getPWAStatus());
    }, 5000);

    return () => {
      cleanup();
      clearInterval(statusInterval);
    };
  }, []);

  const updateAudioSetting = (
    key: keyof AudioSettings,
    value: number | boolean
  ) => {
    onAudioSettingsChange({ ...audioSettings, [key]: value });
  };

  const handlePWAAction = async () => {
    try {
      const result = await handlePWAActionUtil();
      console.log('PWA action result:', result);

      // Update PWA status after action
      setPWAStatus(getPWAStatus());
    } catch (error) {
      console.error('Failed to handle PWA action:', error);
    }
  };

  const handleSendChat = () => {
    if (chatMessage.trim() && onSendChat) {
      onSendChat(chatMessage.trim());
      setChatMessage('');
    }
  };

  // Helper function to count potions
  const getPotionCounts = () => {
    const hpPotions = inventoryItems
      .filter(
        (item) =>
          item.type === 'potion' &&
          (item.name === 'Health Potion' ||
            item.name.toLowerCase().includes('health'))
      )
      .reduce((total, item) => total + item.quantity, 0);

    const manaPotions = inventoryItems
      .filter(
        (item) =>
          item.type === 'potion' &&
          (item.name === 'Mana Potion' ||
            item.name.toLowerCase().includes('mana'))
      )
      .reduce((total, item) => total + item.quantity, 0);

    return { hpPotions, manaPotions };
  };

  // Helper function to count lick tongues
  const getLickTongueCount = () => {
    return inventoryItems
      .filter((item) => item.type === 'material' && item.name === 'Lick Tongue')
      .reduce((total, item) => total + item.quantity, 0);
  };

  const isGoldCurrency = (item: InventoryItem) => {
    const type = String(item.type ?? '').toLowerCase();
    if (type !== 'coin' && type !== 'gold_coin' && type !== 'gold') {
      return false;
    }
    const name = String(item.name ?? '').toLowerCase();
    return name === 'gold' || name === 'gold coin';
  };

  // Helper function to count Gold
  const getGoldCoinCount = () => {
    return inventoryItems
      .filter(isGoldCurrency)
      .reduce((total, item) => total + item.quantity, 0);
  };

  const { hpPotions, manaPotions } = getPotionCounts();
  const goldCoins = getGoldCoinCount();
  const levelValue = Math.max(1, Math.floor(level));
  const sanitizedXpInto = Math.max(0, Math.floor(xpIntoLevel));
  const sanitizedXpForNext = Math.max(0, Math.floor(xpForNextLevel));
  const xpRatio =
    sanitizedXpForNext > 0
      ? Math.min(1, sanitizedXpInto / sanitizedXpForNext)
      : 1;
  const killStreakUnitValue = Math.max(0, killStreakUnits ?? 0);
  const isKillStreakActive = Boolean(
    killStreakActive && killStreakUnitValue > 0
  );

  console.log('archetype id', killStreakArchetypeId);

  const killStreakTraitInfo = useMemo(() => {
    if (!killStreakArchetypeId) return null;
    const archetype = RUN_ARCHETYPES_BY_ID[killStreakArchetypeId];
    return formatKillStreakTrait(
      archetype?.levelTrait,
      Math.floor(killStreakUnitValue)
    );
  }, [killStreakArchetypeId, killStreakUnitValue]);

  console.log('kill streak trait info', killStreakTraitInfo);

  const showScore = typeof score === 'number';
  const formattedScore = useMemo(() => {
    if (!showScore || typeof score !== 'number') {
      return null;
    }
    const clamped = Math.max(0, Math.floor(score));
    return clamped.toLocaleString('en-US');
  }, [score, showScore]);
  const isScoreEligible = scoreEligible !== false;
  const formattedRequiredScore = useMemo(() => {
    if (
      !dailyQuestActive ||
      !showScore ||
      dailyQuestRequiredScore == null ||
      !Number.isFinite(dailyQuestRequiredScore)
    ) {
      return null;
    }
    const clamped = Math.max(0, Math.floor(dailyQuestRequiredScore));
    return clamped.toLocaleString('en-US');
  }, [dailyQuestActive, dailyQuestRequiredScore, showScore]);
  const formatLeverageValue = (value: number) => {
    if (!Number.isFinite(value)) {
      return '1';
    }
    return Number.isInteger(value)
      ? Number(value).toFixed(0)
      : Number(value).toFixed(1);
  };
  const leverageTotalValue = leverageState?.total ?? 1;
  const leverageRoomLocked = leverageState?.roomLocked ?? true;

  const [countdownRemainingMs, setCountdownRemainingMs] = useState(0);
  const [huntedCountdownLabel, setHuntedCountdownLabel] = useState('--:--');

  const intensityLevelDisplay = Math.max(
    0,
    Math.floor(enemyDifficultyLevel ?? 0)
  );
  const showIntensityHud = roomPhase === 'in_game';
  const showHuntedHud = roomPhase === 'in_game';

  useEffect(() => {
    if (!huntedEnabled) {
      setHuntedCountdownLabel('--:--');
      return;
    }
    if (!huntedNextSpawnAt || huntedNextSpawnAt <= 0) {
      setHuntedCountdownLabel('READY');
      return;
    }
    const update = () => {
      if (!huntedEnabled) {
        setHuntedCountdownLabel('--:--');
        return;
      }
      const remaining = huntedNextSpawnAt - Date.now();
      if (remaining <= 0) {
        setHuntedCountdownLabel('READY');
        return;
      }
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      setHuntedCountdownLabel(
        `${minutes}:${seconds.toString().padStart(2, '0')}`
      );
    };
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [huntedEnabled, huntedNextSpawnAt]);

  const huntedStatus = useMemo<
    'disabled' | 'safe' | 'warming' | 'active' | 'dire'
  >(() => {
    if (!huntedEnabled) return 'disabled';
    if (huntedIntensityLevel <= 0) {
      if (huntedNextSpawnAt > 0 && huntedNextSpawnAt - Date.now() <= 30_000) {
        return 'warming';
      }
      return 'safe';
    }
    if (huntedIntensityLevel >= 4) return 'dire';
    return 'active';
  }, [huntedEnabled, huntedIntensityLevel, huntedNextSpawnAt]);

  const huntedTone =
    huntedStatus === 'dire'
      ? { dot: 'bg-red-500 animate-pulse', text: 'text-red-200' }
      : huntedStatus === 'active'
        ? { dot: 'bg-red-400', text: 'text-red-200' }
        : huntedStatus === 'warming'
          ? { dot: 'bg-amber-300 animate-pulse', text: 'text-amber-200' }
          : huntedStatus === 'safe'
            ? { dot: 'bg-emerald-400', text: 'text-emerald-200' }
            : { dot: 'bg-white/30', text: 'text-white/50' };

  const huntedLabel = useMemo(() => {
    switch (huntedStatus) {
      case 'warming':
        return 'WARMING';
      case 'active':
      case 'dire':
        return `HUNTED L${Math.max(1, Math.floor(huntedIntensityLevel || 1))}`;
      case 'disabled':
        return 'OFFLINE';
      default:
        return 'SAFE';
    }
  }, [huntedIntensityLevel, huntedStatus]);

  useEffect(() => {
    if (!countdownEndsAt || roomPhase !== 'countdown') {
      setCountdownRemainingMs(0);
      return;
    }
    const update = () => {
      setCountdownRemainingMs(Math.max(0, countdownEndsAt - Date.now()));
    };
    update();
    const id = setInterval(update, 200);
    return () => clearInterval(id);
  }, [countdownEndsAt, roomPhase]);

  // Current player HP
  const { hp: currentHp, maxHp, devInvincible } = useCurrentPlayerHp();
  const { mana: currentMana, maxMana } = useCurrentPlayerMana();
  const hpDisplay = `${Math.max(0, Math.floor(currentHp))}/${Math.max(1, Math.floor(maxHp))}`;
  const hpRatio = Math.max(
    0,
    Math.min(
      1,
      (Math.floor(currentHp) || 0) / Math.max(1, Math.floor(maxHp) || 1)
    )
  );
  const manaDisplay = `${Math.max(0, Math.floor(currentMana))}/${Math.max(
    0,
    Math.floor(maxMana)
  )}`;
  const manaRatio =
    maxMana > 0
      ? Math.max(
          0,
          Math.min(1, (Math.floor(currentMana) || 0) / Math.max(1, maxMana))
        )
      : 0;

  const countdownSeconds =
    countdownRemainingMs > 0 ? Math.ceil(countdownRemainingMs / 1000) : 0;

  const questTextRaw = (portalCountdownLabel ?? portalQuestLabel) || '';
  const questTextDisplay = useMemo(
    () => questTextRaw.replace(/^\s*quest\b\s*:?\s*/i, ''),
    [questTextRaw]
  );
  const questParts = useMemo(
    () => questTextDisplay.split(/\s+—\s+/).filter(Boolean),
    [questTextDisplay]
  );
  const shouldShowQuest = roomPhase !== 'staging' && !!questTextRaw;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 font-hud font-black">
      {/* Global XP bar at very top */}
      <div className="absolute top-0 left-0 right-0 space-y-1">
        <div className="w-full h-4 bg-black/60 border-b border-white/10">
          <div
            className="h-full bg-gradient-to-r from-purple-400 to-pink-500"
            style={{ width: `${Math.round(xpRatio * 100)}%` }}
          />
        </div>
      </div>

      <div
        className={cn(
          'absolute right-4',
          isKillStreakActive ? 'top-6' : 'top-5'
        )}
      >
        <div className="bg-black/70 backdrop-blur-sm rounded-md px-3 py-2 border border-white/10 flex flex-row items-center gap-2">
          {killStreakActive && killStreakArchetypeId !== 'unknown' && (
            <div className="flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-emerald-400" />
              <span className="text-white/90 font-hud">
                {killStreakTraitInfo?.valueText}
              </span>
            </div>
          )}

          {showIntensityHud && <div className="h-4 w-px bg-white/10 mx-2" />}

          {showIntensityHud && (
            <div className="flex flex-row items-center">
              <span className="text-white font-hud flex flex-row items-center gap-2">
                <Flame className="w-4 h-4" /> {intensityLevelDisplay}
              </span>
            </div>
          )}

          {showHuntedHud && <div className="h-4 w-px bg-white/10 mx-2" />}

          {showHuntedHud && (
            <div className="flex items-center gap-2">
              <div
                className={cn('h-3 w-3 rounded-full shadow-sm', huntedTone.dot)}
              />
              <div className="flex flex-col leading-tight">
                <span
                  className={cn(
                    'text-[11px] font-hud uppercase tracking-[0.08em]',
                    huntedTone.text
                  )}
                >
                  {huntedLabel}
                </span>
                <span className="text-[10px] text-white/60 font-mono">
                  {huntedCountdownLabel}
                </span>
              </div>
            </div>
          )}

          <div className="h-4 w-px bg-white/10 mx-2" />

          <div className="flex items-center gap-2">
            <GaugeIcon
              className={cn(
                'w-4 h-4',
                leverageRoomLocked ? 'text-white/60' : 'text-emerald-400'
              )}
            />
            <span className="text-white font-hud">
              {`${formatLeverageValue(leverageTotalValue)}`}
            </span>
          </div>

          <div className="h-4 w-px bg-white/10 mx-2" />

          <div className="flex items-center gap-2 text-white" title="Level">
            <User className="w-4 h-4 text-white/60" />
            <span className="font-hud">{levelValue}</span>
          </div>
        </div>
      </div>

      {/* Dev-only invincibility indicator (desktop HUD) */}
      {process.env.NODE_ENV !== 'production' && devInvincible && (
        <div className="absolute top-14 right-4 pointer-events-none">
          <div className="inline-flex items-center gap-2 bg-emerald-600/80 border border-emerald-300/80 rounded-md px-3 py-1 shadow-lg">
            <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
            <span className="text-xs font-hud tracking-[0.18em] text-emerald-50">
              INVINCIBLE
            </span>
          </div>
        </div>
      )}

      <div
        className={cn(
          'absolute left-4 pointer-events-auto',
          isKillStreakActive ? 'top-8' : 'top-6'
        )}
      >
        <div className="inline-flex w-fit items-center min-h-[48px] bg-black/70 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/10">
          {/* Player Count & Staging Status */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-white" />
              <span className="text-white">{playerCount}</span>
            </div>

            {roomPhase === 'countdown' && countdownSeconds > 0 && (
              <span className="text-[11px] text-amber-300 uppercase tracking-wide mt-0.5">
                Starting in {countdownSeconds}s
              </span>
            )}
          </div>

          <div className="flex flex-row items-center gap-2 border-l border-white/10">
            <div className="h-4 w-px bg-white/10 mx-2" />

            <Layers className="w-4 h-4" />

            {roomPhase !== 'staging' ? (
              <span className="text-white font-hud">
                {Math.floor(Number(floorIndex))}
              </span>
            ) : (
              <span className="text-white font-hud">World</span>
            )}
          </div>

          {showScore && formattedScore && (
            <div className="flex flex-row items-center gap-2 border-l border-white/10">
              <div className="h-4 w-px bg-white/10 mx-2" />

              <span
                title={dailyQuestActive ? 'Daily Quest attuned' : 'Score'}
                className="inline-flex"
              >
                <Trophy
                  className={cn(
                    'w-4 h-4',
                    dailyQuestActive ? 'text-amber-300' : undefined
                  )}
                />
              </span>
              <span
                className={cn(
                  'text-white text-lg font-hud tracking-[0.15em]',
                  !isScoreEligible && 'text-white/40'
                )}
              >
                {formattedRequiredScore
                  ? `${formattedScore} / ${formattedRequiredScore}`
                  : formattedScore}
              </span>
            </div>
          )}

          {roomId && (
            <div className="flex items-center gap-2 border-l border-white/10">
              <div className="h-4 w-px bg-white/10 mx-2" />

              {isHost && inviteUrl && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(inviteUrl);
                    setInviteCopied(true);
                    setTimeout(() => setInviteCopied(false), 1500);
                  }}
                  className="flex items-center gap-1 text-gray-300 hover:text-white transition-colors px-1 py-0.5 rounded hover:bg-white/10"
                  title="Copy invite link"
                >
                  <Share className="w-3 h-3" />
                  {inviteCopied ? 'Copied!' : 'Invite'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quest Bar */}
      {shouldShowQuest && (
        <div className="absolute top-20 left-4 right-4 pointer-events-none">
          <div className="mt-2 flex flex-col items-start gap-1">
            {questParts.map((part, idx) => (
              <div
                key={`quest_part_${idx}`}
                className="inline-flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10"
              >
                <div className="w-4 h-4 rounded border border-white/70 bg-transparent" />
                <span className="text-white text-sm font-hud tracking-[0.12em]">
                  {part}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {victoryAvailable && (
        <div className="absolute top-32 left-1/2 -translate-x-1/2 pointer-events-auto flex flex-col items-center gap-2 z-30">
          <div className="px-4 py-1.5 text-white text-shadow-lg text-2xl font-bold uppercase tracking-widest">
            Victory!
          </div>
          <Button
            variant="secondary"
            className="bg-green-500 text-black hover:bg-green-400 text-sm px-4 py-2"
            onClick={onLeaveMatch}
          >
            Leave Match
          </Button>
        </div>
      )}

      {/* Bottom-right diagnostics bar (ping/debug) */}
      <div className="pointer-events-auto absolute bottom-4 right-4 flex flex-col items-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          className={cn(
            'w-32 bg-black/70 text-white hover:bg-black/80',
            showDebugPanel && 'bg-purple-600/80'
          )}
          onClick={() => setShowDebugPanel((prev) => !prev)}
          title={showDebugPanel ? 'Hide debug stats' : 'Show debug stats'}
        >
          {showDebugPanel ? 'Hide Debug' : 'Show Debug'}
        </Button>

        {showDebugPanel && (
          <div className="bg-black/80 backdrop-blur-sm rounded-lg px-4 py-3 border border-white/10 shadow-xl">
            <div className="flex items-center gap-3 text-xs">
              <div
                className={cn(
                  'w-2 h-2 rounded-full',
                  connectionStatus === 'connected'
                    ? 'bg-green-500'
                    : connectionStatus === 'reconnecting'
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                )}
              />
              <span
                className={cn(
                  'font-hud',
                  ping !== undefined && ping < 50
                    ? 'text-green-400'
                    : ping !== undefined && ping < 100
                      ? 'text-yellow-400'
                      : ping !== undefined && ping < 200
                        ? 'text-orange-400'
                        : ping !== undefined
                          ? 'text-red-400'
                          : 'text-gray-500'
                )}
              >
                RTT:{' '}
                {ping !== undefined ? `${Math.round(ping)}ms` : 'MEASURING...'}
              </span>
              <span className="text-gray-300 font-hud">{serverRegion}</span>
              <span className="text-blue-400 font-hud">
                {connectionStatus.toUpperCase()}
              </span>
              <span className="text-red-400 font-hud">
                LOSS: {packetLoss.toFixed(1)}%
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs">
              <span className="text-gray-400 font-hud">
                FPS: {typeof window !== 'undefined' ? '60' : '--'}
              </span>
              <span className="text-gray-400 font-hud">
                NET:{' '}
                {ping !== undefined
                  ? Math.round(1000 / Math.max(ping, 16))
                  : '--'}{' '}
                Hz
              </span>
              <span className="text-gray-400 font-hud">
                BW:{' '}
                {ping !== undefined
                  ? `${Math.round((8 * 1024) / Math.max(ping, 1))} kbps`
                  : '-- kbps'}
              </span>
              {/* Server perf from registry (populated by GameScene on server_perf) */}
              {typeof window !== 'undefined' && (window as any).phaserGame && (
                <span className="text-gray-300 font-hud">
                  {(window as any).phaserGame?.scene
                    ?.getScene?.('GameScene')
                    ?.registry?.get?.('serverPerfText') || ''}
                </span>
              )}
              <span className="text-purple-400 font-hud">
                DEBUG: ping={ping?.toString() || 'undefined'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Left side controls */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 pointer-events-auto">
        {/* Settings */}
        <Dialog open={showSettings} onOpenChange={setShowSettings}>
          <DialogTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className="bg-black/70 backdrop-blur-sm border-0 text-white hover:bg-black/80"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-gray-900 border-gray-700 text-white">
            <DialogHeader>
              <DialogTitle>Game Settings</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">Master Volume</label>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      updateAudioSetting('muted', !audioSettings.muted)
                    }
                  >
                    {audioSettings.muted ? (
                      <VolumeX className="w-4 h-4" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <Slider
                  value={[audioSettings.masterVolume]}
                  onValueChange={([value]) =>
                    updateAudioSetting('masterVolume', value)
                  }
                  max={100}
                  step={1}
                  disabled={audioSettings.muted}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">
                  SFX Volume
                </label>
                <Slider
                  value={[audioSettings.sfxVolume]}
                  onValueChange={([value]) =>
                    updateAudioSetting('sfxVolume', value)
                  }
                  max={100}
                  step={1}
                  disabled={audioSettings.muted}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">
                  Music Volume
                </label>
                <Slider
                  value={[audioSettings.musicVolume]}
                  onValueChange={([value]) =>
                    updateAudioSetting('musicVolume', value)
                  }
                  max={100}
                  step={1}
                  disabled={audioSettings.muted}
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Chat Toggle */}
        {/* <Button
          variant="secondary"
          size="icon"
          onClick={() => setShowChat(!showChat)}
          className="bg-black/70 backdrop-blur-sm border-0 text-white hover:bg-black/80"
        >
          <MessageCircle className="w-4 h-4" />
        </Button> */}

        {/* Inventory */}
        <Button
          variant="secondary"
          size="icon"
          onClick={onInventoryToggle}
          className="bg-black/70 backdrop-blur-sm border-0 text-white hover:bg-black/80"
          title="Open Inventory (I)"
        >
          <Package className="w-4 h-4" />
        </Button>
      </div>

      {/* Bottom Right: Ability Bar */}
      {(weaponState?.weapons?.length ||
        grenadeState?.grenades?.length ||
        spellState?.spells?.length) && (
        <div className="absolute bottom-10 right-4 pointer-events-auto">
          <AbilityBar
            grenades={grenadeState}
            weapons={weaponState}
            onGrenadeSelect={onGrenadeSelect}
            onWeaponSelect={onWeaponSelect}
            spells={spellState}
            onSpellCast={onSpellCast}
            onSpellAutocastToggle={onSpellAutocastToggle}
            orientation="horizontal"
            size="large"
          />
        </div>
      )}

      {/* Bottom Center Row: HP bar */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 pointer-events-auto">
        <div className="bg-black/70 backdrop-blur-sm rounded-lg px-4 py-2 min-w-[240px]">
          <div className="flex items-center gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-red-400 text-sm uppercase tracking-wide">
                  HP
                </span>
                <div className="w-28 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-300"
                    style={{ width: `${Math.round(hpRatio * 100)}%` }}
                  />
                </div>
                <span className="text-white text-sm font-hud">{hpDisplay}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sky-400 text-sm uppercase tracking-wide">
                  Mana
                </span>
                <div className="w-28 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 to-blue-300 transition-all duration-300"
                    style={{ width: `${Math.round(manaRatio * 100)}%` }}
                  />
                </div>
                <span className="text-white text-sm font-hud">
                  {manaDisplay}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (hpPotions <= 0) return;
                  const scene = getGameScene();
                  const item = inventoryItems.find(
                    (i) =>
                      i.type === 'potion' &&
                      i.quantity > 0 &&
                      i.name.toLowerCase().includes('health')
                  );
                  if (
                    scene &&
                    typeof (scene as any).useItem === 'function' &&
                    item
                  ) {
                    (scene as any).useItem(item);
                  }
                }}
                className={cn(
                  'flex items-center gap-1',
                  hpPotions > 0
                    ? 'cursor-pointer hover:opacity-90'
                    : 'opacity-50 cursor-not-allowed'
                )}
                title="Use Health Potion"
                aria-label="Use Health Potion"
              >
                <img
                  src="/wearables/126.svg"
                  alt="Health Potion"
                  className="w-4 h-4 object-contain"
                />
                <span className="text-white text-sm font-hud">{hpPotions}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (manaPotions <= 0) return;
                  const scene = getGameScene();
                  const item = inventoryItems.find(
                    (i) =>
                      i.type === 'potion' &&
                      i.quantity > 0 &&
                      i.name.toLowerCase().includes('mana')
                  );
                  if (
                    scene &&
                    typeof (scene as any).useItem === 'function' &&
                    item
                  ) {
                    (scene as any).useItem(item);
                  }
                }}
                className={cn(
                  'flex items-center gap-1',
                  manaPotions > 0
                    ? 'cursor-pointer hover:opacity-90'
                    : 'opacity-50 cursor-not-allowed'
                )}
                title="Use Mana Potion"
                aria-label="Use Mana Potion"
              >
                <img
                  src="/wearables/128.svg"
                  alt="Mana Potion"
                  className="w-4 h-4 object-contain"
                />
                <span className="text-white text-sm font-hud">
                  {manaPotions}
                </span>
              </button>
              <div className="flex items-center gap-1">
                <Coins className="w-4 h-4 text-yellow-400" />
                <span className="text-white text-sm font-hud">{goldCoins}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Panel */}
      {showChat && (
        <div className="absolute bottom-4 left-4 w-80 bg-black/80 backdrop-blur-sm rounded-lg p-4 pointer-events-auto">
          <div className="h-40 overflow-y-auto mb-4 space-y-2">
            {chatMessages.map((msg) => (
              <div key={msg.id} className="text-sm">
                <span className="text-blue-400 font-medium">
                  {msg.playerName}:
                </span>
                <span className="text-white ml-2">{msg.text}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
              placeholder="Type a message..."
              className="flex-1 px-3 py-1 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 text-sm"
              maxLength={200}
            />
            <Button size="sm" onClick={handleSendChat}>
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
