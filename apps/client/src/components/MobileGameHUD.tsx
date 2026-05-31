'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Volume2,
  Settings,
  Users,
  User,
  Package,
  MessageCircle,
  Download,
  Share,
  Smartphone,
  Wallet,
  Coins,
  Layers,
  Trophy,
  Flame,
  Star,
  Zap,
  TrendingUp,
  Gauge,
} from 'lucide-react';
import { Button } from './ui/Button';
import { cn } from '../lib/utils';
import {
  initializePWA,
  getPWAStatus,
  handlePWAAction as handlePWAActionUtil,
  hideSafariToolbar,
  type PWAStatus,
} from '../lib/pwa-utils';
import type { InventoryItem } from '../types/inventory';
import type { LeverageStatePayload } from '../types/messages';
import type { GrenadeHudState, WeaponHudState } from '../game/GameScene';
import type { AudioSettings } from '../types/preferences';
import { AbilityBar } from './AbilityBar';
import { useCurrentPlayerHp } from '../hooks/useCurrentPlayerHp';
import type { SpellHudState } from '../game/GameScene';
import { useCurrentPlayerMana } from '../hooks/useCurrentPlayerMana';
import { RUN_ARCHETYPES_BY_ID } from '../data/archetypes';
import { getGameScene } from '../lib/getGameScene';

interface MobileGameHUDProps {
  onSendChat?: (message: string) => void;
  onWalletConnect?: () => void;
  onInventoryToggle?: () => void;
  onChatToggle?: () => void;
  onMove?: (direction: { x: number; y: number; isMoving: boolean }) => void;
  onShowToast?: (notification: {
    id: string;
    type: string;
    message: string;
  }) => void;
  isWalletConnected?: boolean;
  walletAddress?: string;
  playerCount?: number;
  maxPlayers?: number | null;
  roomId?: string;
  inviteUrl?: string;
  isHost?: boolean;
  isConnected?: boolean;
  inventoryItems?: InventoryItem[];
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
  grenadeState?: GrenadeHudState;
  onGrenadeSelect?: (slug: string | null) => void;
  weaponState?: WeaponHudState;
  onWeaponSelect?: (index: number) => void;
  onWeaponCycle?: () => void;
  spellState?: SpellHudState;
  onSpellCast?: (spellId: string) => void;
  onSpellAutocastToggle?: (spellId: string, enabled: boolean) => void;

  // Progression data
  level?: number;
  xpIntoLevel?: number;
  xpForNextLevel?: number;
  unspentPoints?: number;
  killStreakUnits?: number;
  killStreakActive?: boolean;
  killStreakArchetypeId?: string;

  victoryAvailable?: boolean;
  onLeaveMatch?: () => void;

  // Credits
  creditsBalance?: number;
  onCreditTopUp?: (amount?: number) => void | Promise<void>;
  creditTopUpAmount?: number;
  score?: number;
  scoreEligible?: boolean;
  dailyQuestActive?: boolean;
  dailyQuestRequiredScore?: number | null;
  audioSettings: AudioSettings;
  onAudioSettingsChange: (settings: AudioSettings) => void;
  floorIndex?: number;
  leverageState?: LeverageStatePayload;
}

export function MobileGameHUD({
  onSendChat,
  onWalletConnect,
  onInventoryToggle,
  onChatToggle,
  onMove,
  onShowToast,
  isWalletConnected = false,
  walletAddress,
  playerCount = 0,
  maxPlayers = null,
  roomId = '',
  inviteUrl = '',
  isHost = false,
  isConnected = true,
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
  enemyCount = 0,
  nextTimedSpawnAt = 0,
  enemyDifficultyLevel = 0,
  enemyDifficultyNextAt = 0,
  enemyDifficultyEnabled = false,
  huntedIntensityLevel = 0,
  huntedNextSpawnAt = 0,
  huntedEnabled = false,
  grenadeState,
  onGrenadeSelect,
  weaponState,
  onWeaponSelect,
  onWeaponCycle,
  spellState,
  onSpellCast,
  onSpellAutocastToggle,
  level = 1,
  xpIntoLevel = 0,
  xpForNextLevel = 0,
  unspentPoints = 0,
  killStreakUnits = 0,
  killStreakActive = false,
  killStreakArchetypeId,
  victoryAvailable = false,
  onLeaveMatch = () => {},
  score,
  scoreEligible = true,
  dailyQuestRequiredScore = null,
  audioSettings,
  onAudioSettingsChange: _onAudioSettingsChange,
  floorIndex,
  leverageState,
  dailyQuestActive = false,
}: MobileGameHUDProps) {
  void _onAudioSettingsChange;
  const [showSettings, setShowSettings] = useState(false);
  const [pwaStatus, setPWAStatus] = useState<PWAStatus>({
    isInstalled: false,
    canInstall: false,
    isIOSSafari: false,
    isAndroidChrome: false,
    message: '',
  });
  const [sharePopupOpen, setSharePopupOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [intensityCountdown, setIntensityCountdown] = useState('--:--');
  const [huntedCountdown, setHuntedCountdown] = useState('--:--');

  const intensityLevelDisplay = Math.max(
    0,
    Math.floor(enemyDifficultyLevel ?? 0)
  );
  const showIntensityHud = roomPhase === 'in_game';
  const showHuntedHud = roomPhase === 'in_game';
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

  const handlePWAAction = async () => {
    try {
      const result = await handlePWAActionUtil();

      // Show appropriate toast based on the result
      onShowToast?.({
        id: 'pwa-action',
        type: result.success ? 'success' : 'info',
        message: result.message,
      });

      // Update PWA status after action
      setPWAStatus(getPWAStatus());
    } catch (error) {
      console.error('Failed to handle PWA action:', error);
      onShowToast?.({
        id: 'pwa-failed',
        type: 'error',
        message: 'Failed to install app',
      });
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

  // Helper function to count GHST tokens
  const getGhstCount = () => {
    return inventoryItems
      .filter((item) => item.type === 'coin' && item.name === 'GHST')
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

  useEffect(() => {
    setCopySuccess(false);
  }, [inviteUrl]);

  useEffect(() => {
    if (!isHost) {
      setSharePopupOpen(false);
    }
  }, [isHost]);

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

  const killStreakTraitInfo = useMemo(() => {
    if (!killStreakArchetypeId) return null;
    const archetype = RUN_ARCHETYPES_BY_ID[killStreakArchetypeId];
    const trait = archetype?.levelTrait;
    if (!trait || trait.type === 'none') return null;

    const clamp = (v: number, min: number, max: number) =>
      Math.min(Math.max(v, min), max);
    const units = Math.floor(killStreakUnitValue);
    const valuePerUnit = Math.max(
      0,
      trait.valuePerUnit ?? trait.valuePerLevel ?? 0
    );
    const cap =
      typeof trait.cap === 'number' ? trait.cap : Number.POSITIVE_INFINITY;
    const additive = Math.min(cap, valuePerUnit * units);

    const fmtX = (n: number) => `x${Number(n.toFixed(2)).toString()}`;
    const fmtPct = (n: number) => `${Math.round(n * 100)}%`;

    switch (trait.type) {
      case 'damage_multiplier': {
        const mult = Math.max(0, 1 + additive);
        return { shortLabel: 'DMG', valueText: fmtX(mult) };
      }
      case 'movement_speed': {
        const mult = Math.max(0, 1 + additive);
        return { shortLabel: 'MOVE', valueText: fmtX(mult) };
      }
      case 'mana_regen': {
        const mult = Math.max(0, 1 + additive);
        return { shortLabel: 'AP', valueText: fmtX(mult) };
      }
      case 'attack_speed': {
        const per = clamp(valuePerUnit, 0, 0.95);
        const minScalar =
          typeof trait.cap === 'number'
            ? Math.max(0, 1 - clamp(trait.cap, 0, 0.95))
            : 0.2;
        const scalar = clamp(Math.pow(1 - per, units), minScalar, 1);
        const speedMult = 1 / Math.max(0.0001, scalar);
        return { shortLabel: 'ATK SPD', valueText: fmtX(speedMult) };
      }
      case 'attack_range': {
        const mult = Math.max(0, 1 + additive);
        return { shortLabel: 'RANGE', valueText: fmtX(mult) };
      }
      case 'percent_damage_reduction': {
        return { shortLabel: 'ARMOR', valueText: `+${fmtPct(additive)}` };
      }
      case 'life_steal': {
        return { shortLabel: 'LS', valueText: `+${fmtPct(additive)}` };
      }
      case 'critical': {
        return { shortLabel: 'CRIT', valueText: `+${fmtPct(additive)}` };
      }
      case 'evade': {
        return { shortLabel: 'EVADE', valueText: `+${fmtPct(additive)}` };
      }
      case 'magic_find': {
        return { shortLabel: 'MF', valueText: `+${fmtPct(additive)}` };
      }
      case 'potion_coin_find': {
        return { shortLabel: 'LOOT', valueText: `+${fmtPct(additive)}` };
      }
      case 'hp_regen': {
        const perSecond = additive;
        return {
          shortLabel: 'HP REGEN',
          valueText: `+${Number(perSecond.toFixed(1))}/s`,
        };
      }
      default:
        return null;
    }
  }, [killStreakArchetypeId, killStreakUnitValue]);
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
      ? value.toFixed(0)
      : (value as number).toFixed(1);
  };
  const leverageTotalValue = leverageState?.total ?? 1;
  const leverageFloorValue = leverageState?.floor ?? 1;
  const leverageRoomValue = leverageState?.room ?? 1;
  const leverageRoomLocked = leverageState?.roomLocked ?? true;

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

  // Derive countdown (mm:ss) once per second
  const [countdown, setCountdown] = useState<string>('--:--');
  useEffect(() => {
    const update = () => {
      if (!nextTimedSpawnAt || nextTimedSpawnAt <= 0) {
        setCountdown('PAUSED');
        return;
      }
      const remaining = Math.max(0, nextTimedSpawnAt - Date.now());
      const s = Math.floor(remaining / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      setCountdown(`${mm}:${ss}`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [nextTimedSpawnAt]);

  const [countdownRemainingMs, setCountdownRemainingMs] = useState(0);
  const [autoCloseRemainingMs, setAutoCloseRemainingMs] = useState(0);

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

  useEffect(() => {
    if (!autoCloseAt || roomPhase !== 'staging') {
      setAutoCloseRemainingMs(0);
      return;
    }
    const update = () => {
      setAutoCloseRemainingMs(Math.max(0, autoCloseAt - Date.now()));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [autoCloseAt, roomPhase]);

  useEffect(() => {
    if (!enemyDifficultyEnabled) {
      setIntensityCountdown('PAUSED');
      return;
    }
    if (!enemyDifficultyNextAt || enemyDifficultyNextAt <= 0) {
      setIntensityCountdown('--:--');
      return;
    }

    const update = () => {
      if (!enemyDifficultyEnabled) {
        setIntensityCountdown('PAUSED');
        return;
      }
      if (!enemyDifficultyNextAt || enemyDifficultyNextAt <= 0) {
        setIntensityCountdown('--:--');
        return;
      }
      const remaining = enemyDifficultyNextAt - Date.now();
      if (remaining <= 0) {
        setIntensityCountdown('READY');
        return;
      }
      const seconds = Math.max(0, Math.floor(remaining / 1000));
      const minutes = Math.floor(seconds / 60);
      const remainder = seconds % 60;
      setIntensityCountdown(
        `${minutes}:${remainder.toString().padStart(2, '0')}`
      );
    };

    update();
    const intervalId = window.setInterval(update, 1000);
    return () => window.clearInterval(intervalId);
  }, [enemyDifficultyEnabled, enemyDifficultyNextAt]);

  useEffect(() => {
    if (!huntedEnabled) {
      setHuntedCountdown('--:--');
      return;
    }
    if (!huntedNextSpawnAt || huntedNextSpawnAt <= 0) {
      setHuntedCountdown('READY');
      return;
    }

    const update = () => {
      if (!huntedEnabled) {
        setHuntedCountdown('--:--');
        return;
      }
      if (!huntedNextSpawnAt || huntedNextSpawnAt <= 0) {
        setHuntedCountdown('--:--');
        return;
      }
      const remaining = huntedNextSpawnAt - Date.now();
      if (remaining <= 0) {
        setHuntedCountdown('READY');
        return;
      }
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      setHuntedCountdown(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    };

    update();
    const id = window.setInterval(update, 500);
    return () => window.clearInterval(id);
  }, [huntedEnabled, huntedNextSpawnAt]);

  const countdownSeconds =
    countdownRemainingMs > 0 ? Math.ceil(countdownRemainingMs / 1000) : 0;
  const autoCloseSeconds =
    autoCloseRemainingMs > 0 ? Math.ceil(autoCloseRemainingMs / 1000) : 0;

  const formatSeconds = (totalSeconds: number) => {
    const clamped = Math.max(0, totalSeconds);
    const minutes = Math.floor(clamped / 60);
    const seconds = clamped % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Quest Bar: always show current quest (countdown label preferred), one at a time
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
        <div className="w-full h-2 bg-black/60 border-b border-white/10">
          <div
            className="h-full bg-gradient-to-r from-purple-400 to-pink-500"
            style={{ width: `${Math.round(xpRatio * 100)}%` }}
          />
        </div>
      </div>
      {/* Unified status bar with all icons under XP bar */}
      <div className="absolute left-2 right-2 top-3 pointer-events-auto">
        <div className="flex items-center gap-0 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1 border border-white/10">
          <div className="flex items-center gap-2">
            <Users className="w-3 h-3 text-white" />
            <span className="text-white text-xs">{playerCount}</span>
          </div>

          <>
            <div className="h-4 w-px bg-white/10 mx-2" />
            <div className="flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-white/60" />
              {roomPhase !== 'staging' ? (
                <span className="text-white text-xs font-hud">
                  {Math.floor(Number(floorIndex))}
                </span>
              ) : (
                <span className="text-white text-xs font-hud">World</span>
              )}
            </div>
          </>

          {showScore && formattedScore && (
            <>
              <div className="h-4 w-px bg-white/10 mx-2" />
              <div
                className="flex items-center gap-1.5"
                title={dailyQuestActive ? 'Daily Quest attuned' : 'Score'}
              >
                <Trophy
                  className={cn(
                    'w-3 h-3',
                    dailyQuestActive ? 'text-amber-300' : 'text-white/60'
                  )}
                />
                <span
                  className={cn(
                    'text-white text-xs font-hud tracking-[0.12em]',
                    !isScoreEligible && 'text-white/40'
                  )}
                >
                  {formattedRequiredScore
                    ? `${formattedScore} / ${formattedRequiredScore}`
                    : formattedScore}
                </span>
              </div>
            </>
          )}
          <div className="h-4 w-px bg-white/10 mx-2" />
          <div className="flex items-center gap-1.5">
            <Gauge
              className={cn(
                'w-3 h-3',
                leverageRoomLocked ? 'text-white/60' : 'text-emerald-400'
              )}
            />
            <div className="flex flex-col leading-none">
              <span className="text-white text-xs font-hud">
                {`${formatLeverageValue(leverageTotalValue)}`}
              </span>
            </div>
          </div>
          {showIntensityHud && (
            <>
              <div className="h-4 w-px bg-white/10 mx-2" />
              <div className="flex items-center gap-1.5">
                <Flame className="w-3 h-3 text-white/60" />
                <span className="text-white text-xs font-hud">
                  {intensityLevelDisplay}
                </span>
              </div>
            </>
          )}
          {showHuntedHud && (
            <>
              <div className="h-4 w-px bg-white/10 mx-2" />
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    'h-3 w-3 rounded-full shadow-sm',
                    huntedTone.dot
                  )}
                />
                <div className="flex flex-col leading-none">
                  <span
                    className={cn(
                      'text-[10px] font-hud uppercase tracking-[0.14em]',
                      huntedTone.text
                    )}
                  >
                    {huntedLabel}
                  </span>
                  <span className="text-[10px] text-white/60 font-mono">
                    {huntedCountdown}
                  </span>
                </div>
              </div>
            </>
          )}
          <div className="h-4 w-px bg-white/10 mx-2" />

          {killStreakActive && killStreakArchetypeId !== 'unknown' && (
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-emerald-400" />
              <span className="text-white/90 text-xs font-hud">
                {killStreakTraitInfo?.valueText}
              </span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5" title="Level">
            <User className="w-3 h-3 text-white/60" />
            <span className="font-hud text-sm">{levelValue}</span>
          </div>
        </div>
      </div>

      {/* Dev-only invincibility indicator (mobile HUD) */}
      {process.env.NODE_ENV !== 'production' && devInvincible && (
        <div className="absolute top-8 right-2 pointer-events-none">
          <div className="inline-flex items-center gap-1.5 bg-emerald-600/90 border border-emerald-300/80 rounded-md px-2 py-0.5 shadow-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
            <span className="text-[10px] font-hud tracking-[0.16em] text-emerald-50">
              INVINCIBLE
            </span>
          </div>
        </div>
      )}
      {/* Action buttons column on far right, just below stats bar */}
      <div className="absolute right-2 top-12 pointer-events-auto">
        <div className="flex flex-col items-center gap-2">
          {[
            {
              id: 'inventory',
              icon: Package,
              onClick: onInventoryToggle,
              title: 'Open Inventory',
            },
            // {
            //   id: 'chat',
            //   icon: MessageCircle,
            //   onClick: onChatToggle,
            //   title: 'Open Chat',
            // },

            {
              id: 'settings',
              icon: Settings,
              onClick: () => setShowSettings(!showSettings),
              title: 'Settings',
            },
            ...(isHost && inviteUrl
              ? [
                  {
                    id: 'share',
                    icon: Share,
                    onClick: () => setSharePopupOpen(true),
                    title: 'Share invite link',
                  },
                ]
              : []),
          ].map((button) => {
            const Icon = button.icon;
            return (
              <Button
                key={button.id}
                variant="secondary"
                size="sm"
                onClick={button.onClick}
                className="bg-black/70 backdrop-blur-sm border-0 text-white hover:bg-black/80 w-8 h-8 p-0"
                title={button.title}
              >
                <Icon className="w-4 h-4" />
              </Button>
            );
          })}
        </div>
      </div>
      {/* Top Status Bar - Optimized for vertical */}
      <div className="absolute top-12 left-2 right-2 pointer-events-auto space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {roomPhase === 'countdown' && countdownSeconds > 0 && (
            <div className="flex flex-col bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1">
              <span className="text-[11px] text-amber-300 uppercase tracking-wide">
                Starting in {countdownSeconds}s
              </span>
            </div>
          )}

          {showDebugPanel && (
            <div className="flex items-center gap-1 bg-black/70 backdrop-blur-sm rounded-lg px-2 py-1">
              <div
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  connectionStatus === 'connected'
                    ? 'bg-green-500'
                    : connectionStatus === 'reconnecting'
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                )}
              />
              <span
                className={cn(
                  'font-hud text-xs',
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
                {ping !== undefined ? `${ping}ms` : '...'}
              </span>
              <span className="text-gray-300 font-hud text-xs">
                {serverRegion?.split('-')[0] || 'EU'}
              </span>
            </div>
          )}

          {showDebugPanel && (
            <div className="flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1">
              <span className="text-white text-xs font-hud">
                ENEMIES: {enemyCount}
              </span>
              <span className="text-gray-300 text-xs font-hud">
                NEXT: {countdown}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Quest Bar - positioned under minimap */}
      {shouldShowQuest && (
        <div className="absolute left-2 top-[160px] pointer-events-none">
          <div className="flex flex-col items-start justify-start gap-1">
            {questParts.map((part, idx) => (
              <div
                key={`quest_part_${idx}`}
                className="inline-flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-white/10"
              >
                <div className="w-3.5 h-3.5 rounded border border-white/70 bg-transparent" />
                <span className="text-[0.72rem] font-hud tracking-[0.18em] text-white">
                  {part}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {victoryAvailable && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 pointer-events-auto flex flex-col items-center gap-2 z-30">
          <span className="px-4 py-1.5 rounded-md bg-green-500/85 text-black text-sm font-bold uppercase tracking-widest shadow-lg">
            Victory!
          </span>
          <Button
            variant="secondary"
            onClick={onLeaveMatch}
            className="bg-green-500 text-black hover:bg-green-400 text-sm px-4 py-2"
          >
            Leave Match
          </Button>
        </div>
      )}

      {/* Bottom Right HUD: Ability bar */}
      {(weaponState?.weapons?.length ||
        grenadeState?.grenades?.length ||
        spellState?.spells?.length) && (
        <div className="absolute bottom-20 right-4 pointer-events-auto">
          <AbilityBar
            grenades={grenadeState}
            weapons={weaponState}
            onGrenadeSelect={onGrenadeSelect}
            onWeaponSelect={onWeaponSelect}
            spells={spellState}
            onSpellCast={onSpellCast}
            onSpellAutocastToggle={onSpellAutocastToggle}
            orientation="horizontal"
            size="normal"
          />
        </div>
      )}

      {/* Bottom Center HUD: HP bar */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 pointer-events-auto flex flex-col items-center gap-2">
        <div className="bg-black/70 backdrop-blur-sm rounded-lg px-4 py-2 min-w-[220px]">
          <div className="flex items-center gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-red-400 text-xs uppercase tracking-wide">
                  HP
                </span>
                <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-300"
                    style={{ width: `${Math.round(hpRatio * 100)}%` }}
                  />
                </div>
                <span className="text-white text-xs font-hud">{hpDisplay}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sky-400 text-xs uppercase tracking-wide">
                  Mana
                </span>
                <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 to-blue-300 transition-all duration-300"
                    style={{ width: `${Math.round(manaRatio * 100)}%` }}
                  />
                </div>
                <span className="text-white text-xs font-hud">
                  {manaDisplay}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
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
                  className="w-3.5 h-3.5 object-contain"
                />
                <span className="text-white text-xs font-hud">{hpPotions}</span>
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
                  className="w-3.5 h-3.5 object-contain"
                />
                <span className="text-white text-xs font-hud">
                  {manaPotions}
                </span>
              </button>
              <div className="flex items-center gap-1">
                <Coins className="w-4 h-4 text-yellow-400" />
                <span className="text-white text-xs font-hud">{goldCoins}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Removed old Potion Counts row in favor of inline HP potion display */}

      {/* Settings Overlay */}
      {showSettings && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center pointer-events-auto">
          <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 font-hud font-black">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-white text-xl font-bold">Settings</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSettings(false)}
                className="text-white"
              >
                ✕
              </Button>
            </div>

            <div className="space-y-4">
              {/* Audio Settings */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Volume2 className="w-4 h-4 text-white" />
                  <span className="text-white text-sm">Audio</span>
                </div>
                <div className="space-y-2 pl-6">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 text-sm">Master</span>
                    <span className="text-white text-sm">
                      {audioSettings.masterVolume}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 text-sm">SFX</span>
                    <span className="text-white text-sm">
                      {audioSettings.sfxVolume}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 text-sm">Music</span>
                    <span className="text-white text-sm">
                      {audioSettings.musicVolume}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Control Settings */}
              <div>
                <span className="text-white text-sm">Controls</span>
                <div className="mt-2 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 text-sm">Joystick Size</span>
                    <span className="text-white text-sm">Normal</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 text-sm">Button Size</span>
                    <span className="text-white text-sm">Large</span>
                  </div>
                </div>
              </div>

              {/* Wallet Connection */}
              {!isWalletConnected && (
                <Button
                  onClick={onWalletConnect}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  <Wallet className="w-4 h-4 mr-2" />
                  Connect Wallet
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Game Instructions - Bottom Center */}
      <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 pointer-events-none"></div>

      {/* Share Popup Modal */}
      {sharePopupOpen && isHost && inviteUrl && (
        <div
          className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center pointer-events-auto z-[60]"
          onClick={() => setSharePopupOpen(false)}
        >
          <div
            className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 font-hud"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-white text-xl font-bold">Share Room</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSharePopupOpen(false)}
                className="text-white"
              >
                ✕
              </Button>
            </div>

            <div className="text-center mb-4 font-black">
              <p className="text-gray-300 text-sm mb-4">
                Share this invite link with friends to bring them into your
                room.
              </p>

              <div className="bg-black/50 border border-gray-600 rounded-lg p-4 mb-4">
                <div className="text-left text-xs text-gray-400 mb-1">
                  Invite Link
                </div>
                <div className="text-left text-gray-100 text-sm break-all">
                  {inviteUrl}
                </div>
                {roomId && (
                  <div className="text-left text-[11px] text-gray-500 mt-3">
                    Room ID: {roomId}
                  </div>
                )}
              </div>

              <Button
                onClick={() => {
                  navigator.clipboard.writeText(inviteUrl);
                  setCopySuccess(true);
                  setTimeout(() => setCopySuccess(false), 2000);
                }}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {copySuccess ? '✅ Copied!' : '📋 Copy Invite Link'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
