import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AbilityBar } from '../components/AbilityBar';

function createSpell(
  overrides: Partial<Parameters<typeof makeSpell>[0]> = {}
): ReturnType<typeof makeSpell> {
  return makeSpell({
    id: 'freezing_attack',
    name: 'Freezing Attack',
    ...overrides,
  });
}

function makeSpell(args: {
  id: string;
  name: string;
  cooldownMs?: number;
  cooldownRemainingMs?: number;
  isCoolingDown?: boolean;
  manaCost?: number;
  description?: string;
  autocastEnabled?: boolean;
  insufficientMana?: boolean;
  icon?: string | null;
}) {
  return {
    id: args.id,
    name: args.name,
    description: args.description ?? 'desc',
    manaCost: args.manaCost ?? 3,
    cooldownMs: args.cooldownMs ?? 600,
    cooldownRemainingMs: args.cooldownRemainingMs ?? 0,
    isCoolingDown: args.isCoolingDown ?? false,
    autocastEnabled: args.autocastEnabled ?? false,
    insufficientMana: args.insufficientMana ?? false,
    icon: args.icon ?? undefined,
  } as const;
}

describe('AbilityBar spell double-tap', () => {
  test('double-tap anywhere on spell button toggles autocast and cancels cast', () => {
    jest.useFakeTimers();

    const onCast = jest.fn();
    const onToggle = jest.fn();

    const spell = createSpell({ autocastEnabled: false });

    render(
      <AbilityBar
        spells={{ spells: [spell] }}
        onSpellCast={onCast}
        onSpellAutocastToggle={onToggle}
        orientation="horizontal"
        size="normal"
      />
    );

    // Select by title since the button has a title attribute with the name
    const button = screen.getByTitle(/Freezing Attack/i);

    // First tap schedules a cast
    fireEvent.click(button);

    // Second tap within window triggers toggle and cancels pending cast
    fireEvent.click(button);

    // Advance time less than or equal to debounce to flush queued
    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenLastCalledWith('freezing_attack', true);
    expect(onCast).not.toHaveBeenCalled();

    // A subsequent DOM dblclick should not cause another toggle because we removed onDoubleClick
    fireEvent.dblClick(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  test('single tap after delay casts when not cooling and has mana', () => {
    jest.useFakeTimers();

    const onCast = jest.fn();
    const onToggle = jest.fn();
    const spell = createSpell({
      autocastEnabled: false,
      insufficientMana: false,
    });

    render(
      <AbilityBar
        spells={{ spells: [spell] }}
        onSpellCast={onCast}
        onSpellAutocastToggle={onToggle}
      />
    );

    const button = screen.getByTitle(/Freezing Attack/i);

    fireEvent.click(button);

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(onCast).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  test('single tap does not cast when cooling or insufficient mana', () => {
    jest.useFakeTimers();

    const onCast = jest.fn();
    const spellCooling = createSpell({ isCoolingDown: true });
    const spellNoMana = createSpell({
      id: 'bounce_attack',
      name: 'Bounce Attack',
      insufficientMana: true,
    });

    const { rerender } = render(
      <AbilityBar spells={{ spells: [spellCooling] }} onSpellCast={onCast} />
    );

    const btn1 = screen.getByTitle(/Freezing Attack/i);
    fireEvent.click(btn1);
    act(() => jest.advanceTimersByTime(300));
    expect(onCast).not.toHaveBeenCalled();

    rerender(
      <AbilityBar spells={{ spells: [spellNoMana] }} onSpellCast={onCast} />
    );

    const btn2 = screen.getByTitle(/Bounce Attack/i);
    fireEvent.click(btn2);
    act(() => jest.advanceTimersByTime(300));
    expect(onCast).not.toHaveBeenCalled();

    jest.useRealTimers();
  });
});
