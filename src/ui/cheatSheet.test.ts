import { describe, expect, it } from 'vitest';

import { AUTO_COLLAPSE_MS, SheetState } from './cheatSheet';

describe('SheetState', () => {
  it('opens as it was told to', () => {
    expect(new SheetState(true).isOpen).toBe(true);
    expect(new SheetState(false).isOpen).toBe(false);
  });

  it('never opens a closed sheet just because the player steered', () => {
    // Steering is what puts the sheet away, and it must not be what brings it
    // back — a wheel appearing mid-run would be the obstruction design §4 is
    // written to avoid.
    const state = new SheetState(false);

    state.steered();
    state.tick(AUTO_COLLAPSE_MS * 2);

    expect(state.isOpen).toBe(false);
  });

  it('collapses a few seconds after the first turn, and not a tick before', () => {
    const state = new SheetState(true);

    state.steered();
    state.tick(AUTO_COLLAPSE_MS - 1);
    expect(state.isOpen).toBe(true);

    state.tick(1);
    expect(state.isOpen).toBe(false);
  });

  it('does not start the clock until the player actually steers', () => {
    // A player reading the wheel before they move has as long as they like.
    const state = new SheetState(true);

    state.tick(AUTO_COLLAPSE_MS * 10);

    expect(state.isOpen).toBe(true);
  });

  it('never restarts the countdown on a later turn', () => {
    // Restarting it would mean the sheet stays up exactly while the player is
    // busiest, which is the one time it is in the way.
    const state = new SheetState(true);

    state.steered();
    state.tick(AUTO_COLLAPSE_MS - 1);
    state.steered();
    state.tick(1);

    expect(state.isOpen).toBe(false);
  });

  it('stays open once the player has asked for it, however much they steer', () => {
    const state = new SheetState(true);

    state.steered();
    state.tick(AUTO_COLLAPSE_MS);
    expect(state.isOpen).toBe(false);

    state.toggle();
    state.steered();
    state.tick(AUTO_COLLAPSE_MS * 2);

    expect(state.isOpen).toBe(true);
  });

  it('cancels a running countdown when the player toggles', () => {
    // Opened by hand at the last moment, the sheet must not vanish under them
    // half a second later because a clock was already running.
    const state = new SheetState(true);

    state.steered();
    state.tick(AUTO_COLLAPSE_MS - 1);
    state.toggle();
    state.toggle();
    state.tick(AUTO_COLLAPSE_MS * 2);

    expect(state.isOpen).toBe(true);
  });

  it('reports the state it toggled into', () => {
    const state = new SheetState(true);

    expect(state.toggle()).toBe(false);
    expect(state.toggle()).toBe(true);
  });
});
