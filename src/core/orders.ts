import { BROWN, PRIMARIES, type Primary } from './colors';
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

/**
 * Indexed to match `StageConfig.mix`: tier 1, tier 2, tier 3. Exported because
 * `rollOrder` below is not the only thing that needs to know the shape of
 * demand — the balancing sim's batching bot plans against it, and a second copy
 * of the cardinalities there was right about tier 3 only because there happen
 * to be three primaries (`SECONDARIES` has three members for the same reason,
 * and would not if there were four).
 */
export const TIERS: readonly (readonly ColorMask[])[] = [[RAW], PRIMARIES, SECONDARIES];

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
 * How often a child asks for what a child already at the window is asking for
 * (design §7). Zero is the uncorrelated window the game shipped with.
 *
 * The point is not variety, it is that **one cut can feed two children**: the
 * combo (design §9) needs two mouths wanting the same candy at the same time,
 * and demand drawn independently across seven colors makes that a coincidence.
 * The pair-cap sweep measured a maker who takes that pair whenever it is
 * offered and nothing else — it beats the grinder on 54 seeds of 64 — so this
 * is the knob that decides how often the game offers it.
 *
 * What it is mostly doing is changing the **joint** distribution of the window
 * rather than the marginal one: an echo copies a want that was itself drawn
 * from the stage's weights, so the draw cannot invent demand the table did not
 * ask for. Measured on the roller alone that is exact, and `orders.test.ts`
 * pins it.
 *
 * In a running game it is **not** exact, and the reason is that the window a
 * child is copied from is not a fair sample of what was ordered. An easy color
 * leaves it faster: a raw or a primary is the more likely to be sitting on the
 * rack when its child walks up, and design §5 has them swept and served on the
 * spot. So what is left standing to be echoed skews toward the colors that are
 * slow to make, and the echo repeats that skew. Measured over 64 seeds against
 * the mix in force at each arrival, the delivered share of secondaries runs
 * **59.8% against the 57.1% the table asked for**, with raw and the primaries
 * each about a point light; at a chance of zero the same measurement comes back
 * level (56.9% against 57.2%).
 *
 * That is a deviation worth knowing about before this constant is raised — it
 * is smaller than one step of the anchor table's own T3 column, and the death
 * target held across the sweep, which is why it is recorded rather than
 * corrected.
 */
export const TWIN_CHANCE = 0.25;

/**
 * The colors a child could echo: what the window is already asking for, minus
 * brown.
 *
 * Brown is the over-mix mistake and no regular customer orders it (design §4).
 * It reaches the window only through `Game`'s mercy path, which wants one
 * already on the rack — so echoing it would put out an order that nothing in
 * the kitchen is trying to make.
 *
 * Exported for the same reason `TIERS` is: the balancing sim's batching bot has
 * to value a rung against what the next child is likely to ask for, and a
 * second copy of this rule over there would be a place for the maker's belief
 * and the game's behaviour to drift apart.
 */
export const echoable = (waiting: readonly ColorMask[]): readonly ColorMask[] =>
  waiting.filter((want) => want !== BROWN);

/**
 * Draws one order: a tier by the stage's weights, then a color uniformly
 * within that tier. A tier weighted 0 can never come up — the weights are the
 * only thing gating which colors a stage can ask for.
 *
 * `waiting` is the window as it stands, and `twinChance` of the time the draw
 * echoes one of it instead.
 */
export const rollOrder = (
  stage: StageConfig,
  rng: Rng,
  waiting: readonly ColorMask[] = [],
  twinChance: number,
): ColorMask => {
  // Nothing is drawn unless the echo could actually happen: a run with the knob
  // at zero, or a window with nobody echoable in it, must leave the rng stream
  // exactly where a game without this feature left it. That is what makes zero
  // a control rather than another arm, and `orders.test.ts` pins it.
  if (twinChance > 0) {
    const echoes = echoable(waiting);
    if (echoes.length > 0 && rng.next() < twinChance) return pick(echoes, rng);
  }

  return rollTier(stage, rng);
};

const rollTier = (stage: StageConfig, rng: Rng): ColorMask => {
  const total = stage.mix.reduce((sum, weight) => sum + weight, 0);
  let roll = rng.next() * total;

  for (const [index, weight] of stage.mix.entries()) {
    roll -= weight;
    if (roll < 0) return pick(TIERS[index] ?? [], rng);
  }

  // Only reachable if every weight is 0, which is not a stage anyone can play.
  return RAW;
};
