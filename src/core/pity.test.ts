import { describe, expect, it } from 'vitest';

import { BLUE, PRIMARIES, RED, YELLOW } from './colors';
import { createCustomer } from './customers';
import { DEFAULT_CONFIG, Game } from './game';
import {
  NO_PITY,
  PITY_CEILING_MS,
  PITY_MS,
  duePrimaries,
  starvedPrimaries,
  tickPity,
} from './pity';
import { createSnake } from './snake';
import { createDye, createSugar } from './spawner';
import { Dir, RAW, type ColorMask, type GameState, type TurnSource } from './types';

const NO_TURNS: TurnSource = { take: () => undefined };

const stateWith = (
  wants: readonly ColorMask[],
  extra: Partial<GameState> = {},
): GameState =>
  ({
    snake: createSnake({ x: 8, y: 8 }, Dir.Right),
    pickups: [createSugar({ x: 2, y: 2 })],
    severed: [],
    shelf: [],
    customers: wants.map((want, index) => createCustomer(index + 1, want, 30_000)),
    score: 0,
    lives: 3,
    streak: 0,
    served: 0,
    over: false,
    tutorialIndex: 0,
    tick: 0,
    elapsedMs: 0,
    ...extra,
  }) as GameState;

describe('starvedPrimaries', () => {
  it('asks for nothing when nobody is waiting', () => {
    expect(starvedPrimaries(stateWith([]))).toEqual([]);
  });

  it('asks for both primaries a secondary order needs', () => {
    expect(starvedPrimaries(stateWith([RED | BLUE]))).toEqual([RED, BLUE]);
  });

  it('does not ask for a jar already on the floor', () => {
    const state = stateWith([RED | BLUE], {
      pickups: [createSugar({ x: 2, y: 2 }), createDye({ x: 4, y: 4 }, RED)],
    });

    expect(starvedPrimaries(state)).toEqual([BLUE]);
  });

  it('does not ask at all when the candy is already on the shelf', () => {
    const state = stateWith([RED | BLUE], {
      shelf: [{ color: RED | BLUE, bornAt: 0 }],
    });

    expect(starvedPrimaries(state)).toEqual([]);
  });

  it('counts a segment already part-way to the order', () => {
    // A red segment on the strand is half of purple, so only blue is missing.
    const state = stateWith([RED | BLUE], {
      snake: {
        ...createSnake({ x: 8, y: 8 }, Dir.Right),
        body: [{ pos: { x: 7, y: 8 }, color: RED }],
      },
    });

    expect(starvedPrimaries(state)).toEqual([BLUE]);
  });

  it('ignores a segment that has overshot the order', () => {
    // Blending never takes a primary back out (design §4), so an orange segment
    // is no use to someone who wanted purple — it is not a subset of it.
    const state = stateWith([RED | BLUE], {
      snake: {
        ...createSnake({ x: 8, y: 8 }, Dir.Right),
        body: [{ pos: { x: 7, y: 8 }, color: RED | YELLOW }],
      },
    });

    expect(starvedPrimaries(state)).toEqual([RED, BLUE]);
  });

  it('measures a head start in primaries, not in mask value', () => {
    // Brown is the only order with three primaries in it, so it is the only one
    // where two subsets can disagree: blue (4) is the bigger number than
    // red-and-yellow (3) and the smaller head start toward it.
    const state = stateWith([RED | YELLOW | BLUE], {
      snake: {
        ...createSnake({ x: 8, y: 8 }, Dir.Right),
        body: [
          { pos: { x: 7, y: 8 }, color: RED | YELLOW },
          { pos: { x: 6, y: 8 }, color: BLUE },
        ],
      },
    });

    expect(starvedPrimaries(state)).toEqual([BLUE]);
  });

  it('pools what the whole window needs', () => {
    expect(starvedPrimaries(stateWith([RED, BLUE, YELLOW]))).toEqual([RED, YELLOW, BLUE]);
  });

  it('asks for nothing for a raw order', () => {
    expect(starvedPrimaries(stateWith([RAW]))).toEqual([]);
  });
});

describe('the pity clock', () => {
  it('stays under design §8.3’s guarantee', () => {
    expect(PITY_MS).toBeLessThanOrEqual(PITY_CEILING_MS);
  });

  it('holds a shortage back until it has run long enough', () => {
    let clock = tickPity(NO_PITY, [RED], PITY_MS - 1);
    expect(duePrimaries(clock)).toEqual([]);

    clock = tickPity(clock, [RED], 1);
    expect(duePrimaries(clock)).toEqual([RED]);
  });

  it('resets a primary that stopped being needed', () => {
    const waited = tickPity(NO_PITY, [RED], PITY_MS - 1);

    expect(duePrimaries(tickPity(waited, [], 1))).toEqual([]);
  });

  it('runs each primary on its own clock', () => {
    const clock = tickPity(tickPity(NO_PITY, [RED], PITY_MS), [RED, BLUE], 1);

    expect(duePrimaries(clock)).toEqual([RED]);
  });
});

describe('a running game', () => {
  const stepUntil = (game: Game, ms: number): void => {
    for (let elapsed = 0; elapsed < ms; elapsed += 20) game.step(20, NO_TURNS);
  };

  it('leaves the opening levels stocked by their own rule', () => {
    const game = new Game({ ...DEFAULT_CONFIG, seed: 3 });
    stepUntil(game, 30_000);

    // Still on level 1, whose stock list is empty: no jar may be on the floor,
    // pity or not (design §7).
    expect(game.openingLevel).toBeDefined();
    expect(game.state.pickups.filter((pickup) => pickup.kind === 'dye')).toEqual([]);
  });

  it('never leaves an endless board with no dye on it at all', () => {
    const game = new Game({ ...DEFAULT_CONFIG, openingLevels: false, seed: 3 });
    stepUntil(game, 20_000);

    expect(game.state.pickups.some((pickup) => pickup.kind === 'dye')).toBe(true);
  });

  it.each([3, 7, 21])('never starves an order past the guarantee (seed %d)', (seed) => {
    const game = new Game({ ...DEFAULT_CONFIG, openingLevels: false, seed });
    const waited: Record<number, number> = { [RED]: 0, [YELLOW]: 0, [BLUE]: 0 };
    let worst = 0;

    // Five minutes of a maker who never touches the controls: the window
    // fills, orders go unfilled, and nothing is ever picked up — which is the
    // hardest case for the spawner, since no jar is ever cleared off the map
    // to trigger a refill.
    for (let elapsed = 0; elapsed < 300_000 && !game.state.over; elapsed += 20) {
      game.step(20, NO_TURNS);

      const starved = starvedPrimaries(game.state);
      for (const primary of PRIMARIES) {
        waited[primary] = starved.includes(primary) ? (waited[primary] ?? 0) + 20 : 0;
        worst = Math.max(worst, waited[primary] ?? 0);
      }
    }

    expect(worst).toBeLessThanOrEqual(PITY_CEILING_MS);
  });
});
