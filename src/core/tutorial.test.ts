import { describe, expect, it } from 'vitest';

import { PRIMARIES, colorInfo, primariesOf } from './colors';
import { createRng } from './rng';
import {
  rollTutorial,
  stockedPrimaries,
  stocksDyes,
  stocksSugar,
  type TutorialLevel,
} from './tutorial';
import { Dir, RAW, type GameState } from './types';

const tutorialFor = (seed: number): TutorialLevel[] => rollTutorial(createRng(seed));

const SEEDS = [1, 2, 3, 7, 42, 1_234, 99_999];

describe('rollTutorial', () => {
  it.each(SEEDS)('teaches raw, then one dye, then two (seed %d)', (seed) => {
    const [first, second, third] = tutorialFor(seed);

    expect(first?.want).toBe(RAW);
    expect(colorInfo(second?.want ?? RAW).tier).toBe(2);
    expect(colorInfo(third?.want ?? RAW).tier).toBe(3);
  });

  it.each(SEEDS)(
    'stocks the board with exactly what the order needs (seed %d)',
    (seed) => {
      for (const level of tutorialFor(seed)) {
        expect(level.stock).toEqual(primariesOf(level.want));
      }
    },
  );

  it.each(SEEDS)(
    'puts no jar on the board at all for the raw level (seed %d)',
    (seed) => {
      expect(tutorialFor(seed)[0]?.stock).toEqual([]);
    },
  );

  it.each(SEEDS)('builds the mix out of the dye it just taught (seed %d)', (seed) => {
    const [, second, third] = tutorialFor(seed);
    const taught = second?.stock[0];

    expect(taught).toBeDefined();
    expect(third?.stock).toHaveLength(2);
    expect(third?.stock).toContain(taught);
  });

  it('never widens the stocked set backwards, so no jar is ever taken away', () => {
    for (const seed of SEEDS) {
      const levels = tutorialFor(seed);
      levels.forEach((level, index) => {
        const before = levels[index - 1]?.stock ?? [];
        for (const primary of before) expect(level.stock).toContain(primary);
      });
    }
  });

  it('replays identically from the same seed', () => {
    expect(tutorialFor(42)).toEqual(tutorialFor(42));
  });

  it('does not always teach the same dye', () => {
    const taught = new Set(SEEDS.map((seed) => tutorialFor(seed)[1]?.want));

    expect(taught.size).toBeGreaterThan(1);
  });
});

describe('stockedPrimaries', () => {
  it('stocks the level being played', () => {
    const levels = tutorialFor(42);

    expect(stockedPrimaries(levels[1])).toEqual(levels[1]?.stock);
  });

  it('opens the board up to every dye once the tutorial is over', () => {
    expect(stockedPrimaries(tutorialFor(42)[3])).toEqual(PRIMARIES);
  });
});

/** A maker carrying `segments`, with `cut` more of them on the way to the block. */
const strand = (segments: number, cut = 0): Pick<GameState, 'snake' | 'severed'> => ({
  snake: {
    head: { x: 0, y: 0 },
    dir: Dir.Right,
    body: Array.from({ length: segments }, (_unused, index) => ({
      pos: { x: index + 1, y: 0 },
      color: RAW,
    })),
  },
  severed:
    cut === 0
      ? []
      : [
          {
            segments: Array.from({ length: cut }, (_unused, index) => ({
              pos: { x: index, y: 1 },
              color: RAW,
            })),
            fate: 'chop',
          },
        ],
});

describe('stocksSugar', () => {
  const level = tutorialFor(42)[0];

  it('lays the level its one cube while the maker is empty-handed', () => {
    expect(stocksSugar(level, strand(0))).toBe(true);
  });

  it('lays no second cube while the first is still on the strand', () => {
    expect(stocksSugar(level, strand(1))).toBe(false);
  });

  it('waits for a cut batch to finish going through the block', () => {
    expect(stocksSugar(level, strand(0, 1))).toBe(false);
  });

  it('keeps the endless board stocked whatever the maker is carrying', () => {
    expect(stocksSugar(undefined, strand(1))).toBe(true);
    expect(stocksSugar(undefined, strand(0, 3))).toBe(true);
  });
});

describe('stocksDyes', () => {
  const level = tutorialFor(42)[1];

  it('holds the level’s jar back while there is nothing to dye', () => {
    expect(stocksDyes(level, strand(0))).toEqual([]);
  });

  it('lays it once the first cube is on the strand', () => {
    expect(stocksDyes(level, strand(1))).toEqual(level?.stock);
  });

  it('does not wait on a batch already cut loose', () => {
    // The cut piece is the level's candy on its way through the block, not a
    // strand to dye — so this is the same empty-handed board as above.
    expect(stocksDyes(level, strand(0, 2))).toEqual([]);
  });

  it('never withholds a jar from the endless board', () => {
    expect(stocksDyes(undefined, strand(0))).toEqual(PRIMARIES);
  });
});
