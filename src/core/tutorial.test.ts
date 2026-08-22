import { describe, expect, it } from 'vitest';

import { PRIMARIES, colorInfo, primariesOf } from './colors';
import { createRng } from './rng';
import {
  mixingUnlocked,
  rollTutorial,
  stockedPrimaries,
  stocksDyes,
  stocksSugar,
  TAUGHT_COMBO,
  TUTORIAL_HEADLINES,
  type TutorialLevel,
} from './tutorial';
import { Dir, RAW, type ColorMask, type GameState } from './types';

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

  it.each(SEEDS)(
    'closes on a batch: the same mix, for two children (seed %d)',
    (seed) => {
      const levels = tutorialFor(seed);
      const [, , third, fourth] = levels;

      expect(levels).toHaveLength(4);
      // The colour is one the player has just made, so the only new thing in the
      // last level is the *count* — one cut, two children (design §9).
      expect(fourth?.want).toBe(third?.want);
      expect(fourth?.children).toBe(TAUGHT_COMBO);
      expect(levels.slice(0, -1).map((level) => level.children)).toEqual([1, 1, 1]);
    },
  );

  it.each(SEEDS)('keeps the wheel up over the batch level (seed %d)', (seed) => {
    // It asks for the mix again, so the two jars that earned the wheel in level
    // 3 are still the level's own stock — the wheel does not blink out for the
    // last of the four.
    expect(mixingUnlocked(tutorialFor(seed).at(-1))).toBe(true);
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

  it.each(SEEDS)('has one headline per level, and none to spare (seed %d)', (seed) => {
    // The captions are indexed by `tutorialIndex`, so the two lists drifting
    // apart would mean a level playing under the wrong lesson — or none.
    expect(TUTORIAL_HEADLINES).toHaveLength(tutorialFor(seed).length);
  });

  it('does not always teach the same dye', () => {
    const taught = new Set(SEEDS.map((seed) => tutorialFor(seed)[1]?.want));

    expect(taught.size).toBeGreaterThan(1);
  });
});

describe('mixingUnlocked', () => {
  it.each(SEEDS)('holds the wheel back until the mix level (seed %d)', (seed) => {
    const [raw, primary, mix] = tutorialFor(seed);

    // The first two levels stock at most one jar, so there is nothing to mix
    // and no wheel; the mix level's two jars are what earn it.
    expect(mixingUnlocked(raw)).toBe(false);
    expect(mixingUnlocked(primary)).toBe(false);
    expect(mixingUnlocked(mix)).toBe(true);
  });

  it('keeps the wheel up once the tutorial is over', () => {
    expect(mixingUnlocked(undefined)).toBe(true);
  });
});

describe('stockedPrimaries', () => {
  it('stocks the level being played', () => {
    const levels = tutorialFor(42);

    expect(stockedPrimaries(levels[1])).toEqual(levels[1]?.stock);
  });

  it('opens the board up to every dye once the tutorial is over', () => {
    // `undefined` is what `Game.openingLevel` hands over once the levels are
    // done — the subject is the endless board, not an index past the last level.
    expect(stockedPrimaries(undefined)).toEqual(PRIMARIES);
  });
});

/**
 * A maker carrying `segments` of `color`, with `cut` raw ones on the way to
 * the block and `served` of the level's children already fed. Those are named
 * rather than positional: they vary independently, and a third positional
 * argument would be reached past a placeholder that says nothing about itself.
 */
const strand = (
  segments: number,
  {
    cut = 0,
    color = RAW,
    served = 0,
  }: { cut?: number; color?: ColorMask; served?: number } = {},
): Pick<GameState, 'snake' | 'severed' | 'tutorialServes'> => ({
  tutorialServes: served,
  snake: {
    head: { x: 0, y: 0 },
    dir: Dir.Right,
    body: Array.from({ length: segments }, (_unused, index) => ({
      pos: { x: index + 1, y: 0 },
      color,
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
            batchServes: 0,
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
    expect(stocksSugar(level, strand(0, { cut: 1 }))).toBe(false);
  });

  it('lays the batch level a second cube, and no third', () => {
    const batch = tutorialFor(42).at(-1)!;

    expect(stocksSugar(batch, strand(0))).toBe(true);
    expect(stocksSugar(batch, strand(1))).toBe(true);
    expect(stocksSugar(batch, strand(2))).toBe(false);
  });

  it('counts the batch level down as its children are fed', () => {
    // A maker who chops the pair one candy at a time is not stalled: what the
    // level still wants is its orders less the ones already served, so the cube
    // for the second child arrives on an empty strand like any other.
    const batch = tutorialFor(42).at(-1)!;

    expect(stocksSugar(batch, strand(0, { served: 1 }))).toBe(true);
    expect(stocksSugar(batch, strand(1, { served: 1 }))).toBe(false);
    expect(stocksSugar(batch, strand(0, { served: 2 }))).toBe(false);
  });

  it('keeps the endless board stocked whatever the maker is carrying', () => {
    expect(stocksSugar(undefined, strand(1))).toBe(true);
    expect(stocksSugar(undefined, strand(0, { cut: 3 }))).toBe(true);
  });
});

describe('stocksDyes', () => {
  const level = tutorialFor(42)[1]!;

  it('holds the level’s jar back while there is nothing to dye', () => {
    expect(stocksDyes(level, strand(0))).toEqual([]);
  });

  it('lays it once the first cube is on the strand', () => {
    expect(stocksDyes(level, strand(1))).toEqual(level.stock);
  });

  it('does not wait on a batch already cut loose', () => {
    // The cut piece is the level's candy on its way through the block, not a
    // strand to dye — so this is the same empty-handed board as above.
    expect(stocksDyes(level, strand(0, { cut: 2 }))).toEqual([]);
  });

  it('lays no more once the candy already carries the color', () => {
    const primary = level.stock[0]!;

    // Crossing it again would knead in a primary the segment holds, which
    // changes nothing — so the level stops offering the trip (design §7).
    expect(stocksDyes(level, strand(1, { color: primary }))).toEqual([]);
  });

  it('lays only the dye the mix is still short of', () => {
    const mix = tutorialFor(42)[2]!;
    const [first, second] = mix.stock;

    expect(stocksDyes(mix, strand(1, { color: first }))).toEqual([second]);
    expect(stocksDyes(mix, strand(1, { color: mix.want }))).toEqual([]);
  });
});
