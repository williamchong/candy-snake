import { PRIMARIES, mixCount, type Primary } from './colors';
import { RAW, type ColorMask, type GameState } from './types';

/**
 * Spawn fairness (design §8.3). The board is no longer stocked with one jar of
 * every primary at all times — that floor was Phase 4's stopgap, deliberately
 * more generous than the finished game, and it is what made the *order* dyes
 * are picked up in stop mattering. What replaces it is narrower and later: the
 * jars an order actually needs, and not before they are missed.
 *
 * Scarcity here is *which* jars, not how long they take. Design §8.3 guarantees
 * a needed primary "within 5 s", which is a ceiling on how long the board may
 * leave an order unfillable — not a wait every pickup has to serve. Measured at
 * the full five, a maker spends the run standing about: two dyes at five
 * seconds each costs more than most orders have patience for. The delay below
 * is short enough to keep the game moving and long enough that a jar does not
 * reappear under the maker's feet the instant it is spent.
 */

/**
 * How long a needed primary may be missing before the board has to produce it.
 * A tuning knob under design §8.3's ceiling, never at it.
 */
export const PITY_MS = 1_500;

/** Design §8.3's guarantee. `PITY_MS` is checked against it in the tests. */
export const PITY_CEILING_MS = 5_000;

/** How long each primary has been needed-and-absent. */
export type PityClock = Readonly<Record<Primary, number>>;

export const NO_PITY: PityClock = { 1: 0, 2: 0, 4: 0 };

/** Whether `color` could be built up from `base` by adding primaries (design §4). */
const reachableFrom = (base: ColorMask, color: ColorMask): boolean =>
  (base & color) === base;

/**
 * The primaries an order still needs that the board has not got.
 *
 * What counts as "already satisfiable" is design §8.3's list: the shelf, the
 * strand, and the jars on the floor. A segment only helps if its color is a
 * *subset* of the order — blending never takes a primary back out, so a purple
 * segment is no use to someone who wanted red. Raw is a subset of everything,
 * which is the base case: there is always a cube on the map (§8.1), so the
 * worst case is needing the order's primaries outright.
 *
 * **A previewed order counts, and it has to.** `state.upcoming` is demand the
 * doorway has already shown the player, and a shown order the board
 * will not stock is worse than no preview at all: the maker builds toward a jar
 * that never comes and spends the lead time circling. The tenth sitting paid a
 * whole sweep to learn this in the other direction — its speculative rungs had
 * no promise behind them, and the bot waited on jars its level was never
 * stocked to lay. The promise is what turns a preview into something worth
 * acting on, so the two ship together or neither does.
 */
/**
 * Every order the kitchen owes a candy: the window, then the doorway.
 *
 * Exported for the same reason `orders.ts`'s `echoable` is — the balancing sim
 * plans a ladder against this same pool, and a second copy of the rule over
 * there would be a place for the maker's belief and the board's promise to
 * drift apart. They have to be the same list: the harness may only treat a
 * previewed want like a waiting one *because* the promise below covers it.
 */
export const demandedWants = (state: GameState): ColorMask[] => [
  ...state.customers.map((customer) => customer.want),
  ...state.upcoming,
];

export const starvedPrimaries = (state: GameState): Primary[] => {
  const onMap = new Set<ColorMask>(
    state.pickups.flatMap((pickup) => (pickup.kind === 'dye' ? [pickup.primary] : [])),
  );

  const starved = new Set<Primary>();
  for (const want of demandedWants(state)) {
    if (state.shelf.some((candy) => candy.color === want)) continue;

    // The most-mixed segment that is still on the way to this order. Raw floors
    // it, since a cube can always be pulled. "Most mixed" counts primaries and
    // not the mask itself: blue is the larger number than red-and-yellow, and
    // the smaller head start.
    let best: ColorMask = RAW;
    let bestMixes = 0;
    for (const segment of state.snake.body) {
      if (!reachableFrom(segment.color, want)) continue;

      const mixes = mixCount(segment.color);
      if (mixes > bestMixes) {
        bestMixes = mixes;
        best = segment.color;
      }
    }

    for (const primary of PRIMARIES) {
      const missing = (want & primary) !== 0 && (best & primary) === 0;
      if (missing && !onMap.has(primary)) starved.add(primary);
    }
  }

  return PRIMARIES.filter((primary) => starved.has(primary));
};

/**
 * Advances the clocks by one slice. A primary that is no longer starved resets
 * rather than pausing: the five seconds are how long *this* shortage has run,
 * not how much waiting the player has done across the whole game.
 */
export const tickPity = (
  clock: PityClock,
  starved: readonly Primary[],
  dtMs: number,
): PityClock => ({
  1: starved.includes(1) ? clock[1] + dtMs : 0,
  2: starved.includes(2) ? clock[2] + dtMs : 0,
  4: starved.includes(4) ? clock[4] + dtMs : 0,
});

/** The primaries whose shortage has gone on long enough to be ended. */
export const duePrimaries = (clock: PityClock): Primary[] =>
  PRIMARIES.filter((primary) => clock[primary] >= PITY_MS);
