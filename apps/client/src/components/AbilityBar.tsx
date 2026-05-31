'use client';

import React, { Fragment, useState, useEffect } from 'react';
import { Button } from './ui/Button';
import { cn } from '../lib/utils';
import { isMobileDevice } from '../lib/mobile';
import type {
  GrenadeHudEntry,
  GrenadeHudState,
  WeaponHudEntry,
  WeaponHudState,
  SpellHudEntry,
  SpellHudState,
} from '../game/GameScene';

interface AbilityBarProps {
  grenades?: GrenadeHudState;
  weapons?: WeaponHudState;
  onGrenadeSelect?: (slug: string | null) => void;
  onWeaponSelect?: (index: number) => void;
  spells?: SpellHudState;
  onSpellCast?: (spellId: string) => void;
  onSpellAutocastToggle?: (spellId: string, enabled: boolean) => void;
  orientation?: 'horizontal' | 'vertical';
  size?: 'normal' | 'large';
}

function weaponTooltip(entry: WeaponHudEntry): string {
  const parts = [entry.name];
  parts.push(entry.weaponType === 'ranged' ? 'Ranged' : 'Melee');
  parts.push(entry.slot === 'left' ? 'Left Hand' : 'Right Hand');
  return parts.join(' • ');
}

export function AbilityBar({
  grenades,
  weapons,
  onGrenadeSelect,
  onWeaponSelect,
  spells,
  onSpellCast,
  onSpellAutocastToggle,
  orientation = 'horizontal',
  size = 'normal',
}: AbilityBarProps) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(isMobileDevice());
    const handleResize = () => {
      setIsMobile(isMobileDevice());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const grenadeEntries = grenades?.grenades ?? [];
  const weaponEntries = weapons?.weapons ?? [];
  const spellEntries = spells?.spells ?? [];

  const hasGrenades = grenadeEntries.length > 0;
  const hasWeapons = weaponEntries.length > 0;
  const hasSpells = spellEntries.length > 0;

  if (!hasGrenades && !hasWeapons && !hasSpells) {
    return null;
  }

  const isHorizontal = orientation === 'horizontal';
  const mobileMultiplier = isMobile ? 0.8 : 1;
  const baseButtonSize = Math.round(
    (size === 'large' ? 68 : 48) * mobileMultiplier
  );
  const grenadeIconSize = Math.round(
    (size === 'large' ? 48 : 38) * mobileMultiplier
  );
  const weaponIconSize = Math.round(
    (size === 'large' ? 44 : 34) * mobileMultiplier
  );
  const infinityFontSize = size === 'large' ? '11px' : '10px';
  const hotkeyFontSize = size === 'large' ? '13px' : '12px';
  const labelOffset = size === 'large' ? 'right-1.5 top-1.5' : 'right-1 top-1';

  const renderCooldownRing = (
    progress: number,
    color: string,
    strokeWidth: number
  ) => {
    if (!Number.isFinite(progress)) return null;
    const clamped = Math.max(0, Math.min(1, progress));
    if (clamped <= 0 || clamped >= 1) return null;
    const viewBoxSize = 36;
    const radius = viewBoxSize / 2 - strokeWidth;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - clamped);
    return (
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full z-10"
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      >
        <circle
          cx={viewBoxSize / 2}
          cy={viewBoxSize / 2}
          r={radius}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          cx={viewBoxSize / 2}
          cy={viewBoxSize / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${viewBoxSize / 2} ${viewBoxSize / 2})`}
        />
      </svg>
    );
  };

  const containerClasses = cn(
    'pointer-events-auto flex gap-3 rounded-xl bg-black/50 px-3 py-2 backdrop-blur-md shadow-lg',
    isHorizontal ? 'flex-row items-center' : 'flex-col'
  );

  const groupClasses = cn(
    'flex gap-3',
    isHorizontal ? 'flex-row items-center' : 'flex-col'
  );

  const renderWeaponButtons = () =>
    weaponEntries.map((weapon: WeaponHudEntry, index) => {
      const isActive = weapons?.activeIndex === index;
      const slotLabel = weapon.slot === 'left' ? 'L' : 'R';
      const typeEmoji = weapon.weaponType === 'ranged' ? '🏹' : '⚔️';
      const iconSource =
        weapon.iconUrl && weapon.iconUrl.length > 0
          ? weapon.iconUrl
          : '/wearables/0.svg';

      return (
        <Button
          key={`${weapon.slug}:${slotLabel}`}
          variant="secondary"
          size="icon"
          disabled={!onWeaponSelect}
          onClick={() => onWeaponSelect?.(index)}
          className={cn(
            'relative overflow-hidden border-0 bg-black/70 text-white transition hover:-translate-y-0.5',
            isActive && 'ring-2 ring-sky-400',
            !onWeaponSelect && 'cursor-default'
          )}
          style={{
            height: baseButtonSize,
            width: baseButtonSize,
          }}
          title={weaponTooltip(weapon)}
        >
          <img
            src={iconSource}
            alt={weapon.name}
            className="pointer-events-none select-none object-contain"
            draggable={false}
            style={{
              height: weaponIconSize,
              width: weaponIconSize,
            }}
          />
          <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/70 px-1 font-bold text-white/80 text-xs">
            {slotLabel}
          </span>
          <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/60 px-1 text-white/80 text-xs">
            {typeEmoji}
          </span>
        </Button>
      );
    });

  const renderSpellButtons = () =>
    spellEntries.map((spell: SpellHudEntry) => {
      const totalCooldown = spell.cooldownMs ?? 0;
      const remainingCooldown = spell.cooldownRemainingMs ?? 0;
      const cooldownProgress =
        totalCooldown > 0
          ? Math.min(1, Math.max(0, 1 - remainingCooldown / totalCooldown))
          : 1;
      const tooltipParts = [
        spell.name,
        `${spell.manaCost} MP`,
        spell.description,
      ];
      if (spell.isCoolingDown) tooltipParts.push('Cooling down');
      if (spell.insufficientMana) tooltipParts.push('Not enough mana');

      const badgeClasses = cn(
        'absolute top-1 right-1 rounded px-1 text-[10px] font-bold select-none pointer-events-none',
        spell.autocastEnabled
          ? 'bg-emerald-500/80 text-black'
          : 'bg-black/60 text-white/80'
      );

      const buttonSize = Math.round(
        (size === 'large' ? 72 : 60) * mobileMultiplier
      );
      const strokeWidth = size === 'large' ? 3 : 2;
      const doubleTapDelayMs = 250;

      const handleClick = (
        event: React.MouseEvent<HTMLButtonElement, MouseEvent>
      ) => {
        const target = event.currentTarget as HTMLButtonElement;
        // If autocast toggling is available, use double-tap logic.
        if (onSpellAutocastToggle) {
          const pendingId = target.dataset.singleClickTimeoutId;
          if (pendingId) {
            // Second tap within window: toggle autocast, cancel cast
            window.clearTimeout(Number(pendingId));
            delete target.dataset.singleClickTimeoutId;
            onSpellAutocastToggle(spell.id, !spell.autocastEnabled);
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          // First tap: schedule a cast, unless a second tap arrives
          const timeoutId = window.setTimeout(() => {
            delete target.dataset.singleClickTimeoutId;
            if (!spell.isCoolingDown && !spell.insufficientMana) {
              onSpellCast?.(spell.id);
            }
          }, doubleTapDelayMs);
          target.dataset.singleClickTimeoutId = String(timeoutId);
          return;
        }
        // No autocast toggle available: normal immediate cast
        if (spell.isCoolingDown || spell.insufficientMana) return;
        onSpellCast?.(spell.id);
      };

      // No onDoubleClick handler: relying on two quick clicks only

      const iconSrc = spell.icon ?? undefined;

      return (
        <Button
          key={spell.id}
          variant="secondary"
          className={cn(
            'relative overflow-hidden border-0 bg-black/70 text-white transition hover:-translate-y-0.5 rounded-xl p-0',
            spell.isCoolingDown && 'opacity-80',
            spell.insufficientMana && 'brightness-90'
          )}
          style={{
            minWidth: buttonSize,
            width: buttonSize,
            height: buttonSize,
          }}
          onClick={handleClick}
          title={tooltipParts.filter(Boolean).join(' • ')}
        >
          {iconSrc ? (
            <img
              src={iconSrc}
              alt={spell.name}
              className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover z-0"
              draggable={false}
            />
          ) : null}
          <span className={cn(badgeClasses, 'z-20')}>AUTO</span>
          {spell.isCoolingDown && (
            <div className="pointer-events-none absolute inset-0 rounded-xl bg-black/35" />
          )}
          {renderCooldownRing(cooldownProgress, '#60A5FA', strokeWidth)}
        </Button>
      );
    });

  const renderGrenadeButtons = () =>
    grenadeEntries.map((grenade: GrenadeHudEntry, index) => {
      const isArmed = grenades?.armedGrenadeSlug === grenade.slug;
      const isCoolingDown = grenade.isCoolingDown;
      const insufficientMana = Boolean(grenade.insufficientMana);
      const disabled = isCoolingDown || insufficientMana || !onGrenadeSelect;
      const hotkeyLabel = index < 2 ? String(index + 1) : '';
      // No tooltip for grenades

      const totalCooldown = grenade.cooldownMs ?? 0;
      const remainingCooldown = grenade.remainingMs ?? 0;
      const cooldownProgress =
        totalCooldown > 0
          ? Math.min(1, Math.max(0, 1 - remainingCooldown / totalCooldown))
          : 1;
      const grenadeStrokeWidth = size === 'large' ? 3 : 2;

      return (
        <Button
          key={grenade.slug}
          variant="secondary"
          size="icon"
          onClick={() => onGrenadeSelect?.(isArmed ? null : grenade.slug)}
          disabled={disabled}
          className={cn(
            'relative overflow-hidden border-0 bg-black/70 text-white transition hover:-translate-y-0.5',
            isArmed && 'ring-2 ring-amber-400',
            disabled && 'cursor-not-allowed opacity-60',
            insufficientMana && 'brightness-90'
          )}
          style={{
            height: baseButtonSize,
            width: baseButtonSize,
          }}
          // no tooltip
        >
          <img
            src={`/wearables/${grenade.svgId}.svg`}
            alt={grenade.name}
            className="pointer-events-none select-none object-contain"
            draggable={false}
            style={{
              height: grenadeIconSize,
              width: grenadeIconSize,
            }}
          />
          <span
            className={cn(
              'pointer-events-none absolute rounded bg-black/80 px-1 font-bold text-white shadow',
              labelOffset
            )}
            style={{ fontSize: infinityFontSize }}
          >
            ♾
          </span>
          {hotkeyLabel && (
            <span
              className="pointer-events-none absolute left-1 top-1 rounded bg-black/70 px-1 font-bold text-white/80"
              style={{ fontSize: hotkeyFontSize }}
            >
              {hotkeyLabel}
            </span>
          )}
          {isCoolingDown && (
            <div className="pointer-events-none absolute inset-0 rounded-full bg-black/35" />
          )}
          {insufficientMana && !isCoolingDown && (
            <div className="pointer-events-none absolute inset-0 rounded-full bg-black/25" />
          )}
          {renderCooldownRing(cooldownProgress, '#FBBF24', grenadeStrokeWidth)}
        </Button>
      );
    });

  const groups: React.ReactNode[] = [];
  if (hasSpells) {
    groups.push(
      <div className={groupClasses} key="spells">
        {renderSpellButtons()}
      </div>
    );
  }
  if (hasWeapons) {
    groups.push(
      <div className={groupClasses} key="weapons">
        {renderWeaponButtons()}
      </div>
    );
  }
  if (hasGrenades) {
    groups.push(
      <div className={groupClasses} key="grenades">
        {renderGrenadeButtons()}
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      {groups.map((group, index) => (
        <Fragment key={index}>
          {group}
          {index < groups.length - 1 && (
            <div
              className={cn(
                'bg-white/10',
                isHorizontal ? 'h-10 w-px self-stretch' : 'h-px w-full'
              )}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
