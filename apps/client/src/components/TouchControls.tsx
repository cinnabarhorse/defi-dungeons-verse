'use client';

import type { WeaponHudState } from '../game/GameScene';

interface TouchControlsProps {
  onWeaponCycle: () => void;
  weaponState?: WeaponHudState;
}

export function TouchControls({
  onWeaponCycle,
  weaponState,
}: TouchControlsProps) {
  const TouchButton = ({
    children,
    onClick,
    onTouchStart,
    onTouchEnd,
    className = '',
    id,
    size = 'large',
    variant = 'primary',
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    onTouchStart?: () => void;
    onTouchEnd?: () => void;
    className?: string;
    id?: string;
    size?: 'small' | 'medium' | 'large';
    variant?: 'primary' | 'secondary' | 'accent';
  }) => {
    const sizeClasses = {
      small: 'w-12 h-12 text-sm',
      medium: 'w-16 h-16 text-base',
      large: 'w-20 h-20 text-lg',
    };

    const variantClasses = {
      primary:
        'bg-blue-600/80 border-blue-400 hover:bg-blue-500/80 active:bg-blue-700/80',
      secondary:
        'bg-gray-600/80 border-gray-400 hover:bg-gray-500/80 active:bg-gray-700/80',
      accent:
        'bg-purple-600/80 border-purple-400 hover:bg-purple-500/80 active:bg-purple-700/80',
    };

    return (
      <button
        id={id}
        className={`
          ${sizeClasses[size]}
          ${variantClasses[variant]}
          flex items-center justify-center
          border-2 rounded-full
          backdrop-blur-sm
          text-white font-bold
          transition-all duration-100
          transform active:scale-95
          shadow-lg
          select-none
          touch-manipulation
          ${className}
        `}
        onClick={onClick}
        onTouchStart={(e) => {
          // Only prevent default if we need to stop scrolling/zooming
          if (e.cancelable) {
            e.preventDefault();
          }
          onTouchStart?.();
        }}
        onTouchEnd={(e) => {
          if (e.cancelable) {
            e.preventDefault();
          }
          onTouchEnd?.();
        }}
        onMouseDown={onTouchStart}
        onMouseUp={onTouchEnd}
        onMouseLeave={onTouchEnd}
      >
        {children}
      </button>
    );
  };

  const activeWeapon =
    weaponState && typeof weaponState.activeIndex === 'number'
      ? weaponState.weapons?.[weaponState.activeIndex] ?? null
      : null;
  const weaponIcon =
    activeWeapon?.iconUrl && activeWeapon.iconUrl.length > 0
      ? activeWeapon.iconUrl
      : '/wearables/0.svg';
  const slotLabel = activeWeapon?.slot === 'right'
    ? 'R'
    : activeWeapon?.slot === 'left'
    ? 'L'
    : '';
  const typeEmoji =
    activeWeapon?.weaponType === 'ranged' ? '🏹' : '⚔️';

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Weapon Switch Button */}
      <TouchButton onClick={onWeaponCycle} variant="secondary" size="medium">
        <div className="flex flex-col items-center gap-1">
          {activeWeapon ? (
            <div className="relative flex items-center justify-center h-10 w-10 rounded-full bg-white/10 overflow-hidden">
              <img
                src={weaponIcon}
                alt={activeWeapon.name}
                className="h-8 w-8 object-contain"
                draggable={false}
              />
              {slotLabel && (
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white/80">
                  {slotLabel}
                </span>
              )}
            </div>
          ) : (
            <span className="text-lg">⚔️</span>
          )}
          <span className="text-xs opacity-80">
            {activeWeapon ? `${typeEmoji} Cycle` : 'Cycle Weapon'}
          </span>
        </div>
      </TouchButton>
    </div>
  );
}
