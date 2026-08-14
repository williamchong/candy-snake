import { PRIMARIES, type Primary } from './colors';
import type { Rng } from './rng';
import { RAW, type ColorMask } from './types';

/**
 * Order tiers map onto color tiers (design §7): raw, then a primary the player
 * only has to pick up, then a secondary they have to mix. Brown is in no tier —
 * it is the over-mix mistake, and no regular customer orders it (design §4).
 *
 * The secondaries are derived from `PRIMARIES` rather than written out, so a
 * tier can never disagree with the palette about what a two-dye mix is.
 */
const SECONDARIES: readonly ColorMask[] = PRIMARIES.flatMap(
  (first: Primary, index: number) =>
    PRIMARIES.slice(index + 1).map((second: Primary) => first | second),
);

/** Indexed to match `StageConfig.mix`: tier 1, tier 2, tier 3. */
const TIERS: readonly (readonly ColorMask[])[] = [[RAW], PRIMARIES, SECONDARIES];

/**
 * One row of the difficulty table (design §7). Phase 4 pins a single stage;
 * Phase 5's `difficulty.ts` varies these continuously over (time, serves)
 * without anything downstream having to change.
 */
export interface StageConfig {
  /** Relative weights per tier — the T1/T2/T3 column of the table. */
  readonly mix: readonly [number, number, number];
  readonly maxQueue: number;
  readonly patienceMs: number;
  /** Gap between arrivals, counted only while the queue has room. */
  readonly arrivalIntervalMs: number;
  /**
   * Milliseconds per grid move — the table's *Snake speed* column, which had
   * nowhere to live while a run was pinned to one row. It belongs with the
   * other knobs rather than in `GameConfig`, so the whole difficulty table is
   * one thing the curve interpolates (implementation plan, "balance is
   * opinion").
   */
  readonly moveIntervalMs: number;
}

/**
 * What the game hands over to once the opening levels are done, and the curve's
 * first anchor (`difficulty.ts`). The table's Warm-up row is deliberately
 * skipped: its job is teaching raw orders, and the tutorial has already taught
 * raw, primary *and* secondary by the time this takes over — dropping back to
 * 100% raw would read as going backwards.
 *
 * Its *speed* is Warm-up's 5 cells/s all the same. Demand starts at Mixing, but
 * a strand that jumped straight to 7 cells/s the instant the third child was
 * served would lurch, so the curve eases the maker up to the Mixing row's speed
 * over the first minute instead.
 */
export const MIXING_STAGE: StageConfig = {
  mix: [10, 50, 40],
  maxQueue: 3,
  patienceMs: 35_000,
  arrivalIntervalMs: 12_000,
  moveIntervalMs: 200,
};

const pick = (colors: readonly ColorMask[], rng: Rng): ColorMask =>
  colors[rng.int(colors.length)] ?? RAW;

/**
 * Draws one order: a tier by the stage's weights, then a color uniformly
 * within that tier. A tier weighted 0 can never come up — the weights are the
 * only thing gating which colors a stage can ask for.
 */
export const rollOrder = (stage: StageConfig, rng: Rng): ColorMask => {
  const total = stage.mix.reduce((sum, weight) => sum + weight, 0);
  let roll = rng.next() * total;

  for (const [index, weight] of stage.mix.entries()) {
    roll -= weight;
    if (roll < 0) return pick(TIERS[index] ?? [], rng);
  }

  // Only reachable if every weight is 0, which is not a stage anyone can play.
  return RAW;
};
