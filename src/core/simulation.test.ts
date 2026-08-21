import { describe, expect, it } from 'vitest';

import { CHOP_BLOCK_CELLS, COLS, ROWS, eq } from './board';
import { PRIMARIES, mixCount, primariesOf, type Primary } from './colors';
import { RAMP, SPEED_RUNGS } from './difficulty';
import { DEFAULT_CONFIG, Game, STARTING_LIVES } from './game';
import { TIERS, type StageConfig } from './orders';
import { SHELF_SLOTS } from './shelf';
import { stockedPrimaries, stocksSugar } from './tutorial';
import {
  Dir,
  OPPOSITE,
  RAW,
  type ColorMask,
  type GameState,
  type TurnSource,
  type Vec2,
} from './types';

/**
 * Two bots that actually play the game, rather than turning at random. Both
 * run the whole production loop — sugar, jars, bench — so a run of either
 * exercises every rule in this phase (the opening levels, matching, staling,
 * patience, lives) against invariants that must hold on every single tick.
 *
 * They differ in the one thing the balancing pass cares about: how much sugar
 * they keep on the strand. `grinderGoal` carries a single segment; `batcherGoal`
 * builds a production line. Tuning against only one of them would tune the game
 * around that way of playing, so both are kept.
 */
const BENCH = CHOP_BLOCK_CELLS[0]!;

const sum = (numbers: readonly number[]): number =>
  numbers.reduce((total, value) => total + value, 0);

/** Signed distance the short way round, since the kitchen edges wrap. */
const shortest = (delta: number, size: number): number =>
  ((((delta + size / 2) % size) + size) % size) - size / 2;

const steerTowards = (state: GameState, goal: Vec2): Dir => {
  const dx = shortest(goal.x - state.snake.head.x, COLS);
  const dy = shortest(goal.y - state.snake.head.y, ROWS);

  const moves: { dir: Dir; distance: number }[] = [
    { dir: dx > 0 ? Dir.Right : Dir.Left, distance: Math.abs(dx) },
    { dir: dy > 0 ? Dir.Down : Dir.Up, distance: Math.abs(dy) },
  ];

  return (
    moves
      .filter((move) => move.distance > 0)
      .sort((a, b) => b.distance - a.distance)
      .map((move) => move.dir)
      // The core rejects a reversal anyway; picking the other axis instead
      // means the bot keeps making progress rather than stalling.
      .find((dir) => dir !== OPPOSITE[state.snake.dir]) ?? state.snake.dir
  );
};

/** Where a bot is heading this move, given the row the ramp is on. */
type Goal = (state: GameState, stage: StageConfig) => Vec2;

/**
 * The cube a maker standing here would actually walk to, measured the short way
 * round rather than by array order — `shortest` above, so the wrap through a
 * service door is defined in one place and not a second time here.
 *
 * Inert while design §8.1's floor is one cube: with a single cube on the map the
 * nearest is the only one, so this cannot move a number until something raises
 * that floor. That is exactly why it goes in ahead of time — a sugar-supply
 * lever that lays three would otherwise be measured against a bot walking past
 * two of them to reach whichever the spawner happened to push first.
 */
const nearestSugar = (state: GameState): Vec2 | undefined => {
  const { head } = state.snake;
  let best: Vec2 | undefined;
  let bestDistance = Infinity;

  for (const pickup of state.pickups) {
    if (pickup.kind !== 'sugar') continue;

    const distance =
      Math.abs(shortest(pickup.pos.x - head.x, COLS)) +
      Math.abs(shortest(pickup.pos.y - head.y, ROWS));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = pickup.pos;
    }
  }

  return best;
};

/** Where a primary's jar is standing, if it is out. */
const jarFor = (state: GameState, primary: Primary): Vec2 | undefined =>
  state.pickups.find((pickup) => pickup.kind === 'dye' && pickup.primary === primary)
    ?.pos;

/**
 * The jar for the first primary `held` still lacks, if one is on the board —
 * an order's primaries, for the maker filling that order. The batcher wants the
 * same thing against its *ladder* rather than against one order, and reads the
 * rung index out while it is there, so it does this inline; what the two share
 * is `jarFor` above.
 */
const jarTowards = (
  state: GameState,
  held: ColorMask,
  needed: readonly Primary[],
): Vec2 | undefined => {
  const missing = needed.find((primary) => (held & primary) === 0);
  return missing === undefined ? undefined : jarFor(state, missing);
};

/**
 * How likely the next child through the door is to ask for `color`, read off
 * the stage's own mix rather than guessed: `rollOrder` draws a tier by weight
 * and then a color uniformly inside it, so the chance is the tier's share of
 * the weights divided by how many colors that tier holds.
 *
 * The tier is `mixCount` rather than `colorInfo().tier`, because what is needed
 * here is the index into `StageConfig.mix` — and the two agree by construction:
 * raw mixes nothing, a primary one, a secondary two. Brown mixes three and no
 * regular customer orders it (design §4), so it is worth nothing to build for.
 *
 * This is the only thing either bot knows that is not on the board in front of
 * it, and it is what "building ahead of the window" is made of: a maker who has
 * played a few minutes knows roughly what gets asked for, and the plan's open
 * finding is about a maker who builds for demand that has not arrived yet.
 */
const demandFor = (stage: StageConfig, color: ColorMask): number => {
  const tier = mixCount(color);
  const weight = stage.mix[tier];
  if (weight === undefined) return 0;

  return weight / sum(stage.mix) / (TIERS[tier]?.length ?? 1);
};

/**
 * The chance that at least `count` of `trials` mouths ask for a color with this
 * `chance` — the binomial tail, walked term by term rather than through
 * factorials, since `trials` is never more than a window plus a rack.
 *
 * This is what stops a batch running away. The *worth* of the second red
 * segment in a batch is not the worth of the first: it only pays if a *second*
 * child wants red, which is rarer. Asking the question that way makes the plan
 * self-limiting — the ladder stops growing on its own, at the rung where an
 * extra segment is likelier to go stale on the rack than to be handed to
 * anybody, instead of at a cap somebody had to pick.
 */
const atLeast = (count: number, trials: number, chance: number): number => {
  if (count <= 0) return 1;
  if (trials <= 0 || chance <= 0) return 0;
  if (chance >= 1) return trials >= count ? 1 : 0;

  let below = 0;
  let term = (1 - chance) ** trials;

  for (let seen = 0; seen < count; seen += 1) {
    below += term;
    term *= ((trials - seen) / (seen + 1)) * (chance / (1 - chance));
  }

  return Math.max(1 - below, 0);
};

/**
 * One cube, through the jars the order still needs, then the bench — a candy
 * per trip and never more than one segment on the strand.
 *
 * This is the cheapest way to play and, at the tuning Phase 4 pinned, an
 * extremely good one (see "the reference players" below). It is deliberately
 * kept as a reference: it is the floor a balancing pass has to beat.
 */
const grinderGoal: Goal = (state) => {
  const sugar = nearestSugar(state);
  const carried = state.snake.body[0];
  if (carried === undefined) return sugar ?? BENCH;

  const want = state.customers[0]?.want ?? RAW;

  return jarTowards(state, carried.color, primariesOf(want)) ?? BENCH;
};

/**
 * Every dye sequence a maker could lay, which is a short list: the empty one
 * (a batch of plain sugar), each primary on its own, and each *ordered* pair.
 *
 * Ordered, because `ladderColors` below turns the sequence into different rungs
 * depending which jar goes on first. And pairs at most, because a third primary
 * takes the top rung to brown, which no regular customer orders (design §4) —
 * so a three-dye ladder is a two-dye ladder with a wasted trip on the end.
 *
 * Enumerated up front rather than derived from whoever is waiting, which is
 * what the ceiling raise turns on: a maker planning only the orders in front of
 * them can never want a ladder no current child asked for.
 */
const LADDER_ORDERS: readonly (readonly Primary[])[] = [
  [],
  ...PRIMARIES.map((dye) => [dye]),
  ...PRIMARIES.flatMap((first) =>
    PRIMARIES.filter((second) => second !== first).map((second) => [first, second]),
  ),
];

/**
 * What a ladder built by laying `order`'s dyes on in that sequence comes out as.
 *
 * The segment laid before the first jar crosses every jar after it, the next
 * one crosses all but the first, and the cube laid after the last jar crosses
 * none — so the rungs are the running OR of the *tail* of the order, raw last.
 * Which is why the sequence matters and not just the set: red-then-yellow banks
 * an orange over a **yellow**, yellow-then-red an orange over a **red**.
 */
const ladderColors = (order: readonly Primary[]): ColorMask[] => [
  ...order.map((_dye, index) =>
    order.slice(index).reduce<ColorMask>((mask, dye) => mask | dye, RAW),
  ),
  RAW,
];

/**
 * A batch as a build instruction rather than as a list of colors: the jars to
 * cross, in order, and how many cubes to lay before each of them — `counts` is
 * one longer than `order`, the last entry being the raws laid after the final
 * jar.
 *
 * The counts are the ceiling raise. A ladder is a nested bundle, so its
 * *distinct* rungs are capped at four by the color system itself — but a rung
 * can carry more than one segment, because laying two cubes before a jar gives
 * two segments of that rung's color. Height therefore comes from repeats, and
 * `Primary[]` alone could not say so.
 */
interface Ladder {
  readonly order: readonly Primary[];
  readonly counts: readonly number[];
}

const ladderSize = (ladder: Ladder): number => sum(ladder.counts);

/** One plain cube — the grinder's whole batch, and `bestLadder`'s floor. */
const SOLO_CUBE: Ladder = { order: [], counts: [1] };

/** Coverage is worth an order of magnitude more than length; see `planLadder`. */
const COVERAGE_WEIGHT = 10;

/**
 * How many of each rung to build, and what that batch is worth.
 *
 * Two kinds of demand are counted, and the second is the one that is new:
 *
 * - **Children already waiting.** Every one of them this ladder's rungs can
 *   match takes a segment of its own — which is the repeat case, and what the
 *   old plan could not express: two children wanting red is two red segments,
 *   not one red rung serving one of them and the other going hungry.
 * - **Children who have not walked in yet.** `openings` is how many more mouths
 *   this batch could ever reach: the window slots still to be filled, plus the
 *   room left on the rack, because a candy nobody wants now is not thrown away
 *   — it is racked, and every child arriving sweeps the rack first (design §5).
 *   That second term is the ceiling raise. Slots alone go to zero exactly when
 *   the window is full, which is most of a ramped run, and a maker who stops
 *   planning ahead whenever three children are waiting is the maker the harness
 *   already had.
 *
 * Speculation stacks with diminishing returns: the *j*th segment of a color is
 * worth the chance that **at least *j* of the `openings` ask for it** (`atLeast`
 * above), since a second red only sells if a second child wants red. A segment
 * costs 1 against the `COVERAGE_WEIGHT` a serve is worth, so the plan stops
 * adding rungs the moment the next one is likelier to stale than to sell. That
 * tie-break is the one that matters: what kills a maker is not waste but the
 * time spent building before anybody is handed anything.
 */
const planLadder = (
  order: readonly Primary[],
  wants: readonly ColorMask[],
  stage: StageConfig,
  openings: number,
): { ladder: Ladder; score: number } => {
  const rungs = ladderColors(order);
  const counts = rungs.map(() => 0);
  const spare = [...wants];
  let matched = 0;

  rungs.forEach((color, rung) => {
    for (let slot = spare.indexOf(color); slot >= 0; slot = spare.indexOf(color)) {
      spare.splice(slot, 1);
      counts[rung] = (counts[rung] ?? 0) + 1;
      matched += 1;
    }
  });

  const chances = rungs.map((color) => demandFor(stage, color));
  const guessed = rungs.map(() => 0);
  let expected = 0;

  for (let spent = 0; spent < openings; spent += 1) {
    let pick = -1;
    let best = 0;

    chances.forEach((chance, rung) => {
      const value = atLeast((guessed[rung] ?? 0) + 1, openings, chance);
      if (value > best) {
        best = value;
        pick = rung;
      }
    });

    if (pick < 0 || best * COVERAGE_WEIGHT <= 1) break;

    guessed[pick] = (guessed[pick] ?? 0) + 1;
    counts[pick] = (counts[pick] ?? 0) + 1;
    expected += best;
  }

  // A rung nobody wants is a jar crossed with nothing under it, which kneads
  // nothing and wastes the trip (design §5). Dropping the leading jar is
  // exactly slicing both lists, since the rungs are the running OR of the
  // order's tail — so what is left is a shorter ladder rather than a bad one.
  let from = 0;
  while (from < counts.length - 1 && counts[from] === 0) from += 1;

  const ladder = { order: order.slice(from), counts: counts.slice(from) };

  return {
    ladder,
    score: (matched + expected) * COVERAGE_WEIGHT - ladderSize(ladder),
  };
};

/**
 * Which ladder to build. Every sequence in `LADDER_ORDERS` is planned against
 * the window as it stands *and* as the ramp will fill it, and the best-scoring
 * plan wins.
 *
 * The maker plans against the **whole** window rather than whoever is at the
 * front of it, and past the end of it rather than only into it. Building for
 * one order leaves the lower rungs to sell themselves, and against seven colors
 * of uncorrelated demand they mostly do not: measured, the strand banked more
 * candy than the grinder and sold less of it. Choosing *which* ladder, how many
 * of each rung, and in which sequence, is what puts those rungs in front of
 * children — including the ones still at the door.
 */
const bestLadder = (state: GameState, stage: StageConfig): Ladder => {
  const wants = state.customers.map((customer) => customer.want);
  const openings =
    Math.max(stage.maxQueue - wants.length, 0) +
    Math.max(SHELF_SLOTS - state.shelf.length, 0);

  /**
   * A jar is worth planning around if it is on the floor, or if a child waiting
   * needs it — design §8.3 guarantees the pity spawner lays that one within
   * seconds, which is what makes circling for it a wait rather than a stall.
   *
   * A *speculative* rung gets no such promise, and the opening levels are where
   * that bites: level 1 stocks one cube and no jars at all (`stocksDyes`), so a
   * maker who planned a red rung for a child who has not arrived would circle
   * the kitchen forever waiting on a jar the level will never lay.
   */
  const promised = new Set(wants.flatMap((want) => primariesOf(want)));
  const buildable = (order: readonly Primary[]): boolean =>
    order.every((dye) => promised.has(dye) || jarFor(state, dye) !== undefined);

  let best: Ladder | undefined;
  let bestScore = -Infinity;

  for (const order of LADDER_ORDERS) {
    if (!buildable(order)) continue;

    const planned = planLadder(order, wants, stage, openings);
    if (planned.score > bestScore) {
      bestScore = planned.score;
      best = planned.ladder;
    }
  }

  // Nothing worth building — no one waiting and no rung likelier to sell than
  // to stale. One plain cube is still better than standing still: it is the
  // grinder's whole batch, and the bench is on the way to everything.
  //
  // Defensive rather than live, and measured as such: `LADDER_ORDERS` opens
  // with the empty order, which `buildable` can never reject, so the loop
  // always assigns — and a zero-size winner wants `openings` at nought, which
  // is a **full** window over a **full** rack with no waiting child matching
  // any rung. Neither fired once in 8263 calls across four seven-minute runs.
  return best !== undefined && ladderSize(best) > 0 ? best : SOLO_CUBE;
};

/**
 * The other way to play, and the one the color system was designed around: the
 * maker builds a production line before chopping.
 *
 * A jar tints every segment already on the strand, and a cube taken after a jar
 * stays raw (design §4), so a batch can only ever be a **nested ladder** —
 * most-mixed at the head end, shedding a primary per segment toward the tail.
 * Alternating sugar and jars banks one candy per tier in a single trip:
 *
 *     sugar, red, sugar, yellow, sugar  →  [orange, yellow, raw]
 *
 * The ladder is planned against the window as a whole and past the end of it
 * (`bestLadder`): as many segments per rung as there is demand for, plus the
 * raws under them all. Nothing is counted between moves — how far the build has
 * got is read back off the head-end segment's color — so a strand broken
 * mid-build, or a queue that changed while it was being built, simply re-plans
 * from whatever survived.
 *
 * That read-back is the first of the ladder's jars the oldest segment has *not*
 * been through. Finding that jar rather than counting how many it has been
 * through is what keeps a re-plan honest: a queue that changed can leave the
 * strand carrying a primary the new ladder does not call for, and a count would
 * then point at the wrong rung while the jar pointed at the right one.
 *
 * Where the board withholds a cube, the bot takes the next jar it still needs
 * rather than stalling. That is not a special case for the opening levels: it
 * is what those levels are stocked to teach, since each lays one cube and waits
 * for it to come back (design §7). The same rule plays them correctly.
 */
const batcherGoal: Goal = (state, stage) => {
  const carried = state.snake.body;
  const held = carried[0]?.color ?? RAW;
  const { order, counts } = bestLadder(state, stage);
  /**
   * Steering at nothing in particular, which `steerTowards` reads as "no turn":
   * the maker carries straight on. It is what to do when the jar the ladder
   * wants is not out yet — design §8.3 guarantees one within seconds, and a lap
   * of the kitchen costs far less than taking a half-built ladder to the block
   * and throwing the rest of the trip away.
   */
  const circle = state.snake.head;

  // How far the build has got: the first jar the strand has *not* been through.
  // Found rather than counted, and found **once** — a re-plan mid-build can
  // leave the strand holding a later rung's primary and not an earlier one, so
  // the jar to head for and the rungs already owed have to come off the same
  // index or the maker fetches cubes for a rung it is not on. `findIndex` gives
  // both from one scan, which is the coupling rather than a second lookup that
  // has to agree with the first.
  const at = order.findIndex((dye) => (held & dye) === 0);
  /** The ladder's jars are all through the strand; only the bench is left. */
  const finished = at < 0;
  const rung = finished ? order.length : at;
  /** Every segment that must be on the strand before that jar is crossed. */
  const wanted = sum(counts.slice(0, rung + 1));

  // Lay this rung's cubes before crossing the jar that tints them. A cube taken
  // after the jar stays raw, so the ladder would come out a rung short.
  if (carried.length < wanted) {
    const sugar = nearestSugar(state);
    if (sugar !== undefined) return sugar;
    // No cube to be had, so press on with the next jar rather than stall.
  }

  return finished ? BENCH : (jarFor(state, order[rung]!) ?? circle);
};

const botFor = (game: Game, goalOf: Goal = grinderGoal): TurnSource => ({
  take: () => steerTowards(game.state, goalOf(game.state, game.stage)),
});

/** Everything that must be true after every single step of every run. */
const violationsIn = (game: Game, tick: number): string[] => {
  const { state } = game;
  const broken: string[] = [];
  const at = (message: string): string => `tick ${tick}: ${message}`;

  if (state.lives < 0 || state.lives > STARTING_LIVES) {
    broken.push(at(`${state.lives} lives`));
  }
  if (state.shelf.length > SHELF_SLOTS) {
    broken.push(at(`${state.shelf.length} candies on a ${SHELF_SLOTS}-slot shelf`));
  }

  const inTutorial = game.openingLevel !== undefined;
  // The live cap, not a fixed row: the ramp widens the window as it climbs
  // (design §7), so the only thing that can be asserted is that the queue never
  // outgrows whatever difficulty is asking for right now.
  const cap = inTutorial ? 1 : game.stage.maxQueue;
  if (state.customers.length > cap) {
    broken.push(at(`${state.customers.length} children waiting, cap ${cap}`));
  }

  for (const customer of state.customers) {
    if (customer.patience !== undefined && customer.patience.remainingMs < 0) {
      broken.push(at(`customer ${customer.id} past the end of their bar`));
    }
    // The opening levels must never put a clock on the window (design §7).
    if (inTutorial && customer.patience !== undefined) {
      broken.push(at(`opening-level customer ${customer.id} has a patience clock`));
    }
    // Every candy is offered to the queue as it is made, and every arrival
    // sweeps the rack — so this pairing is unreachable by construction.
    if (state.shelf.some((candy) => candy.color === customer.want)) {
      broken.push(at(`customer ${customer.id} waiting beside a candy they ordered`));
    }
  }

  const stocked: readonly Primary[] = stockedPrimaries(game.openingLevel);
  for (const primary of PRIMARIES) {
    const jars = state.pickups.filter(
      (pickup) => pickup.kind === 'dye' && pickup.primary === primary,
    );
    if (jars.length > 1) broken.push(at(`${jars.length} jars of primary ${primary}`));
    if (jars.length > 0 && !stocked.includes(primary)) {
      broken.push(at(`primary ${primary} on a board stocked for ${stocked.join()}`));
    }
  }

  // Design §8.1's floor, narrowed by design §7: an opening level hands out one
  // cube and waits for it to come back as a candy before laying another.
  const wantsSugar = stocksSugar(game.openingLevel, state);
  const onMap = state.pickups.some((pickup) => pickup.kind === 'sugar');
  if (wantsSugar && !onMap) broken.push(at('no sugar on the map'));
  if (!wantsSugar && onMap) broken.push(at('a second cube laid out mid-level'));

  return broken;
};

interface RunResult {
  readonly violations: string[];
  readonly game: Game;
  /** Candies that left the block, however they were then disposed of. */
  readonly chopped: number;
  /** Candies the shelf had to let go of to make room (design §5). */
  readonly staled: number;
  /**
   * Cuts holding more than one color — a production line rather than a single
   * candy. The only direct evidence that a maker batched at all, since a
   * one-segment strand cannot produce one.
   */
  readonly ladders: number;
  /** Mean segments in a batch at the moment it was cut loose. */
  readonly meanBatch: number;
  /**
   * Strands lost to a self-hit (design §6). A production line is a longer
   * strand, and a longer strand is easier to steer into — so this is the cost
   * of batching that no amount of demand tuning can pay off.
   */
  readonly broken: number;
  /**
   * How long the run lasted, or undefined for a maker still standing when the
   * sweep ran out of ticks. `step` returns before it advances the clock once
   * the run is over, so `elapsedMs` is already the moment of death rather than
   * however long the loop kept calling afterwards.
   */
  readonly diedAtMs: number | undefined;
  /**
   * The deepest the window ever got. Design §7 has carried a max-queue column
   * since Phase 4 and no sweep ever read it back — which is how the queue came
   * to be stuck at one for six sittings with every assertion green (see the
   * plan's seventh sitting). Measured now, so it cannot go quiet again.
   */
  readonly peakQueue: number;
  /**
   * The most sugar the strand ever carried. Segments rather than `snakeLength`,
   * which counts the head: what is being measured is how much of a ladder got
   * built, and the maker is not a rung of it.
   *
   * This is the direct read on whether a lever aimed at the *cost* of a ladder
   * actually bought one — `ladders` says a batch held more than one color, and
   * says nothing about how tall it was.
   */
  readonly peakSegments: number;
  /** The same, averaged over the ticks the maker was alive. */
  readonly meanSegments: number;
  /**
   * Every gear change the run was told about, in order (design §7's speed
   * ladder). Collected here because this is the only harness that plays long
   * enough to reach the top of it: an unattended `Game` loses its lives to
   * walkouts before the sixth rung, so `game.test.ts` can only ever see the
   * ease-in.
   */
  readonly gears: { readonly rung: number; readonly top: boolean }[];
}

const play = (seed: number, ticks: number, goalOf: Goal = grinderGoal): RunResult => {
  const game = new Game({ ...DEFAULT_CONFIG, seed });
  const bot = botFor(game, goalOf);
  const violations: string[] = [];
  let score = 0;
  let served = 0;
  let level = 0;
  let chopped = 0;
  let staled = 0;
  let ladders = 0;
  let cuts = 0;
  let cutSum = 0;
  let broken = 0;
  let peakQueue = 0;
  let peakSegments = 0;
  let segmentSum = 0;
  let liveTicks = 0;
  const gears: { rung: number; top: boolean }[] = [];

  for (let tick = 0; tick < ticks; tick += 1) {
    for (const event of game.step(20, bot)) {
      if (event.type === 'candy-chopped') chopped += 1;
      if (event.type === 'candy-staled') staled += 1;
      if (event.type === 'strand-broken') broken += 1;
      if (event.type === 'speed-raised') gears.push({ rung: event.rung, top: event.top });
      if (event.type !== 'strand-cut') continue;

      // Both readings are of the **strand the maker built**, which is the batch
      // plus whatever stayed on the head — not of the batch alone. Today those
      // are the same thing, since a chop severs the whole body (design §5) and
      // leaves the snake head-only; the retained term is here so that a rule
      // keeping part of the strand back cannot quietly turn "how long a line
      // did this maker build" into "how much of it was sold this trip". A
      // metric that answers a different question after a rules change, under
      // the same name, is how this harness has gone blind four times.
      //
      // `kept` is the body at the end of the step, not at the cut — `step`
      // returns its events already materialised, so reading it in here moves
      // nothing in time. What being in here buys is that the accounting no
      // longer assumes **one cut a step**. That assumption holds today
      // (`SPEED_RUNGS` floors a move at 125 ms against this loop's fixed 20, so
      // at most one move and so at most one cut) and is exactly the kind of
      // thing a rules change costs you quietly. A second cut in one step would
      // still add `kept` twice, so this is honest about the count and not yet
      // about the length; if a rule ever lands that can part a strand twice in
      // a move, that is the line to come back to.
      const kept = game.state.snake.body;
      const colors = new Set([...event.batch, ...kept].map((segment) => segment.color));
      if (colors.size > 1) ladders += 1;
      cuts += 1;
      cutSum += event.batch.length + kept.length;
    }

    violations.push(...violationsIn(game, tick));

    const { state } = game;
    if (state.score < score) violations.push(`tick ${tick}: score went backwards`);
    if (state.served < served) violations.push(`tick ${tick}: serves went backwards`);
    if (state.tutorialIndex < level) violations.push(`tick ${tick}: tutorial rewound`);
    ({ score, served, tutorialIndex: level } = state);

    // Sampled over the ticks the maker was alive rather than over the sweep: a
    // run that ended at four minutes would otherwise be read as having spent
    // the next three carrying nothing. It is the mean that needs saying so —
    // `step` returns before it touches anything once the run is over, so a
    // finished game's state never moves and neither peak could shift anyway.
    if (!state.over) {
      peakQueue = Math.max(peakQueue, state.customers.length);
      peakSegments = Math.max(peakSegments, state.snake.body.length);
      segmentSum += state.snake.body.length;
      liveTicks += 1;
    }
  }

  return {
    violations: violations.slice(0, 10),
    game,
    chopped,
    staled,
    ladders,
    meanBatch: cuts === 0 ? 0 : cutSum / cuts,
    broken,
    diedAtMs: game.state.over ? game.state.elapsedMs : undefined,
    peakQueue,
    peakSegments,
    meanSegments: segmentSum / liveTicks,
    gears,
  };
};

const SEEDS = [1, 17, 404, 9_001];
/** 20 000 × 20 ms is a shade under seven minutes of play per seed. */
const TICKS = 20_000;

describe('a full run', () => {
  it.each(SEEDS)('holds every invariant end to end (seed %d)', (seed) => {
    expect(play(seed, TICKS).violations).toEqual([]);
  });

  it.each(SEEDS)('holds them for a maker who batches too (seed %d)', (seed) => {
    expect(play(seed, TICKS, batcherGoal).violations).toEqual([]);
  });

  it('builds a production line and serves off it', () => {
    const seed = SEEDS[0] ?? 1;
    const batcher = play(seed, TICKS, batcherGoal);

    expect(batcher.game.state.tutorialIndex).toBe(batcher.game.tutorial.length);
    expect(batcher.game.state.served).toBeGreaterThan(batcher.game.tutorial.length);
    // Serving is not the claim — laddering is, and only a multi-colored cut
    // shows it. A maker carrying one segment can barely manage one by accident.
    expect(batcher.ladders).toBeGreaterThan(10);
    expect(play(seed, TICKS).ladders).toBeLessThan(batcher.ladders);
  });

  it('gets through the opening levels and serves real orders', () => {
    const { game } = play(SEEDS[0] ?? 1, TICKS);

    expect(game.state.tutorialIndex).toBe(game.tutorial.length);
    expect(game.state.served).toBeGreaterThan(game.tutorial.length);
    expect(game.state.score).toBeGreaterThan(0);
  });

  it('cannot end while the opening levels are still running', () => {
    const game = new Game({ ...DEFAULT_CONFIG, seed: 5 });
    const idle: TurnSource = { take: () => undefined };

    // A player who never touches the controls drives straight forever and
    // serves nobody. The run has to survive that for as long as they leave it.
    for (let tick = 0; tick < TICKS; tick += 1) game.step(20, idle);

    expect(game.state.tutorialIndex).toBe(0);
    expect(game.state.lives).toBe(STARTING_LIVES);
    expect(game.state.over).toBe(false);
  });

  it('ends the run when the maker walks away from a real queue', () => {
    const game = new Game({ ...DEFAULT_CONFIG, seed: 5 });
    const bot = botFor(game);
    const idle: TurnSource = { take: () => undefined };

    for (let tick = 0; tick < TICKS && game.state.tutorialIndex < 3; tick += 1) {
      game.step(20, bot);
    }
    expect(game.state.tutorialIndex).toBe(3);

    // Three children, each with a clock now: walking away has to cost the run.
    for (let tick = 0; tick < TICKS && !game.state.over; tick += 1) {
      game.step(20, idle);
    }

    expect(game.state.over).toBe(true);
    expect(game.state.lives).toBe(0);
  });

  it('never spawns a pickup under an unopened cell of the strand', () => {
    const game = new Game({ ...DEFAULT_CONFIG, seed: 21 });
    const bot = botFor(game);

    for (let tick = 0; tick < 4_000; tick += 1) {
      game.step(20, bot);
      const { snake, pickups } = game.state;
      const cells = [snake.head, ...snake.body.map((segment) => segment.pos)];

      for (const pickup of pickups) {
        if (pickup.open) continue;
        expect(cells.some((cell) => eq(cell, pickup.pos))).toBe(false);
      }
    }
  });
});

/** 30 000 × 20 ms — the far end of the 8–10 min run Phase 5 is aiming at. */
const TARGET_TICKS = 30_000;

/**
 * A wider draw for the one question that is about a *rate* rather than about a
 * run: how often the ramp closes a batching run out.
 *
 * `SEEDS`' four are enough for an invariant, which either holds on a run or
 * does not. They are not enough for a proportion. Anything that shifts when a
 * pickup spawns re-rolls every free cell drawn after it, so a run either side
 * of such a change is a different run rather than the same one played harder —
 * and with a sample of four, "3 of 4 died" and "2 of 4 died" is the same
 * measurement twice. Sixteen makes the reshuffle visible as noise instead of
 * reading as a curve that stopped biting.
 */
const SWEEP = [...SEEDS, 2, 3, 5, 7, 11, 13, 23, 31, 57, 88, 123, 777];

/**
 * Wider still, and only the **median** is asked of it — because sixteen turns
 * out not to be enough for that either, which is a thing this file has now
 * learned twice about two different statistics.
 *
 * A proportion needed sixteen where four would not do (`SWEEP` above). A median
 * needs sixty-four: measured on the same build, the batching maker's death
 * reads **3.95 min across `SWEEP` and 4.21 across this draw** — a quarter of a
 * minute apart, which straddles the floor of the 4–6 window the ramp is aimed
 * at. Half the sittings recorded in the plan compared two medians sixteen seeds
 * wide and read the difference as a curve that moved; on this evidence some of
 * those differences were the draw.
 *
 * Sixty-four rather than a rounder thirty-two, and the margin is the reason.
 * Bootstrapped against a 512-seed pool of batcher deaths (true median ≈ 4.41),
 * the chance a draw's own median lands under the 4-minute floor runs 12.3% at
 * sixteen seeds, 6.4% at thirty-two and **1.8% at sixty-four** — and the
 * sub-draw medians are not even monotonic below that (forty-eight reads lower
 * than thirty-two), which is the noise saying so itself. The true median sits
 * only ~0.4 min above a hard floor, so the draw has to be wide enough to
 * resolve less than that or the assertion fails on the draw rather than on the
 * game.
 *
 * It costs about a second of suite time — ~14 ms a seed, and this is the
 * largest single test in the project — paid only by the batcher, since the
 * grinder outlives the sweep on most seeds and has no median to speak of.
 */
const WIDE = [...SWEEP, ...Array.from({ length: 48 }, (_unused, at) => 1_000 + at * 37)];

/**
 * The deepest window the ramp ever opens, off the table rather than written
 * down again — the last row's, since the cap only climbs and then holds past
 * the end of the table (`difficulty.test.ts` pins both). A retune that widens
 * the window should not read here as a run that failed to fill it.
 */
const PEAK_QUEUE = RAMP[RAMP.length - 1]!.maxQueue;

/**
 * Where the balance stands *after* the ramp went in, measured rather than
 * guessed — the after half of the comparison the pre-Phase-5 block set up. The
 * plan's mitigation for "balance is opinion" is seeded simulations that make
 * tuning comparable run-to-run, so the numbers stay committed as assertions and
 * the next change to them shows up as a diff.
 *
 * Two of the three findings that opened the phase are answered:
 *
 * - **Losing is possible now.** The maker who batches — the way the color
 *   system is meant to be played — dies inside the 4–6 minute window the plan
 *   is aiming at, where before neither bot could be touched. That window used
 *   to read 8–10; what moved it is in the plan, under the seventh sitting.
 * - **The window is no longer the only constraint.** The ramp shortens the
 *   arrival interval past what either maker can keep up with, so the run ends
 *   on the queue rather than on the clock running out of customers.
 *
 * The third is **not** answered, and the assertions below say so plainly rather
 * than quietly dropping it: batching is still the worse way to play. It is not
 * a tuning failure — the levers were measured and none of them close it. A
 * nested ladder is a fixed bundle (a secondary over one particular primary over
 * a raw) while demand is spread uncorrelated across seven colors, so the extra
 * candy a longer strand buys is mostly candy nobody ordered. Removing staling
 * entirely (a 60-slot shelf) does not fix it, flattening the tier mix does not
 * fix it, and teaching the bot to plan against the whole window rather than the
 * child at the front of it only narrows it.
 *
 * That is a rules question, not a numbers question, and it is recorded here as
 * the open one. Both bots are kept for the same reason as before: tightening
 * the ramp until the *grinder* died on schedule would be tuning the game around
 * the strategy it least wants to reward.
 */
describe('the reference players, after the ramp went in', () => {
  /**
   * The runs behind the tests below, memoised per (bot, seed). `play` is a pure
   * function of (seed, ticks, goal) — the core takes all its randomness from
   * the seeded rng (architecture §2) — so re-running one can only produce what
   * the last one did. Nothing here may step these games further.
   *
   * Per seed rather than per sweep, because the sweeps overlap: `SWEEP` opens
   * with `SEEDS`, and the four would otherwise be played out twice.
   */
  const runs = new Map<Goal, Map<number, RunResult>>();
  const target = (goalOf: Goal, seeds: readonly number[] = SEEDS): RunResult[] => {
    const bySeed = runs.get(goalOf) ?? new Map<number, RunResult>();
    runs.set(goalOf, bySeed);

    return seeds.map((seed) => {
      const run = bySeed.get(seed) ?? play(seed, TARGET_TICKS, goalOf);
      bySeed.set(seed, run);
      return run;
    });
  };

  /**
   * Candies off the block per minute the maker was alive — `elapsedMs` stops
   * at death, so it is the length of the run either way.
   *
   * Counting candies instead is the obvious measure and the wrong one: the
   * ramp closes the batcher's run out and leaves the grinder standing, so a
   * raw count sets a six-minute run against a ten-minute one and reads the
   * shorter as the less productive. Per minute, the batcher leads on every one
   * of an offline draw of 96 seeds, before this level-2 change and after;
   * counted raw it led on about two thirds of them, and which two thirds is a
   * re-roll.
   */
  const choppedPerMinute = (run: RunResult): number =>
    run.chopped / (run.game.state.elapsedMs / 60_000);

  /** When the ramp closed each batching run out, for the runs it closed. */
  const deathsOf = (seeds: readonly number[]): number[] =>
    target(batcherGoal, seeds)
      .map((run) => run.diedAtMs)
      .filter((ms): ms is number => ms !== undefined);

  it('ends a batching run inside the window the ramp is aimed at', () => {
    // How often the ramp closes a run out is a rate, so it is asked of the
    // wider draw (`SWEEP`) rather than of the four. Every seed, now that an
    // emptied window refills rather than standing open: the queue the run ends
    // on is one the maker actually had to hold off. Measured 16/16, against
    // 14/16 when the window admitted one child per interval whatever it held.
    const diedAt = deathsOf(SWEEP);
    expect(diedAt.length).toBeGreaterThanOrEqual(14);

    // *When* it closes them out is the target itself, and the median is what
    // carries it: the tail is a re-roll on any given seed (anything that moves
    // a spawn re-rolls every free cell drawn after it) but the middle of the
    // draw is not — or so this said until the ceiling went up, when the middle
    // of *sixteen* turned out to move by a quarter of a minute against sixty-
    // four (3.95 against 4.21) and to straddle the floor while doing it. The
    // median has moved to `WIDE` for that reason, and every median quoted below
    // was read off sixteen seeds and should be taken as ±0.3 min.
    //
    // Measured 4.21 min on `WIDE`, over deaths running 2.6 … 7.5. The figures
    // that follow are the history of this number and were all read off sixteen
    // seeds; the jump from the 5.16 recorded below is mostly the draw widening
    // and not the curve moving. Against
    // 5.79 while the tide still waited for the three-minute mark — the ninth
    // sitting moved it to `SETTLED_MS` and a shape the maker meets a minute in
    // is one they have to hold off for the rest of the run.
    //
    // The score-ramp pass then keyed the ramp on score rather than on a count
    // of serves. `MS_PER_POINT` was fitted to leave the median where it was and
    // did (4.66 → 4.67) — but the same pass found the brown-mercy gate reading
    // the raw clock where its own rule said "once the ramp has settled", and
    // fixing *that* is what put the median at 5.16: a maker whose score runs
    // ahead of the stopwatch now reaches the settled row, and the free serve a
    // mercy customer is, sooner than the clock would have let them. Both arms
    // re-measured with the gate fixed read 4.66 (serve count) against 5.16
    // (score), and this file has had to say three times that a run either side
    // of a change that moves an rng draw is a different run, not the same one
    // played harder.
    //
    // The window reads 4–6 rather than the 8–10 it was written with, and the
    // reason is not that the curve grew teeth. It is that nothing new arrives
    // after the three-minute mark: max queue is done at 2 min, the order mix
    // and the speed cap at 3, and past those only two numbers move — patience
    // and the arrival interval — neither of which adds a thing to do. A target
    // past the last of the levers was asking the ramp to hold attention with
    // arithmetic. See the plan's seventh sitting.
    const sorted = [...deathsOf(WIDE)].sort((a, b) => a - b);
    const median =
      sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]!
        : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
    // Said once for both ends, since a median outside the window fails one of
    // them and the reader wants the same number either way.
    const measured = `median death at ${(median / 60_000).toFixed(1)} min`;
    expect(median, measured).toBeGreaterThanOrEqual(4 * 60_000);
    expect(median, measured).toBeLessThanOrEqual(6 * 60_000);

    // And the long tail stays a tail. Not a bound on the median twice over: a
    // draw could sit dead centre and still send a quarter of its runs past the
    // point the levers ran out, which is the thing the target is against.
    //
    // Measured **2** of 64 — the same draw the median above is read from, so
    // the two halves of this test are no longer measured on different
    // populations. Against 3 of 16 for the serve count on the same
    // (mercy-fixed) draw. That is the one thing keying on score bought here,
    // and the interquartile range says it more plainly: 4.3–6.7 min under the
    // serve count against 4.7–6.2 under score, so the distribution closed in
    // from *both* ends. A score is a read on how well a run is going where a
    // serve count reads only how long it has been going on, so the runs that
    // used to get away are the ones the curve now catches.
    const late = sorted.filter((ms) => ms > 7 * 60_000);
    expect(
      late.length * 4,
      `${late.length} of ${sorted.length} closed-out runs passed seven minutes`,
    ).toBeLessThanOrEqual(sorted.length);
  });

  it('climbs the whole speed ladder and says so, once per rung', () => {
    // The half of the ladder no unattended game can reach: the sixth rung lands
    // at 91 s of ramp and the seventh at 151, and a `Game` nobody plays has
    // lost its three lives to walkouts by 58 s. So the announcement is checked
    // end to end here, on runs that actually last (design §7).
    target(batcherGoal).forEach((run) => {
      expect(run.gears.map((gear) => gear.rung)).toEqual(
        // Rung 0 is the speed every run opens at, so it is never announced.
        Array.from({ length: SPEED_RUNGS.length - 1 }, (_, index) => index + 1),
      );

      // And the top of the ladder is called exactly once, at the end of it.
      // This is the one piece of news the ramp had no way to deliver before:
      // from here the strand never gets faster, and only the window tightens.
      const tops = run.gears.filter((gear) => gear.top);
      expect(tops).toHaveLength(1);
      expect(run.gears[run.gears.length - 1]!.top).toBe(true);
    });
  });

  it('buys a batching maker more candy per minute than a grinder', () => {
    const grinders = target(grinderGoal);

    target(batcherGoal).forEach((batcher, seed) => {
      const grinder = grinders[seed]!;

      // The longer strand is genuinely the more productive one: fewer trips to
      // the jars and the block per candy that comes off it.
      expect(choppedPerMinute(batcher)).toBeGreaterThan(choppedPerMinute(grinder));
      // And it is laddering to get there, rather than chopping singles fast.
      // A floor rather than a target, and it has now come down three times —
      // twice because a run that ends sooner makes fewer cuts, and this third
      // time for a reason worth separating from that one, because it looks the
      // same and is not.
      //
      // `ladders` counts a cut whose strand held more than one *color*, so it
      // measures variety and not length. Raising the ceiling bought length by
      // letting a rung carry several segments, and a rung carried twice is the
      // same color twice — so the batcher builds longer strands and trips this
      // counter less often. Measured 11 … 28 across the wider draw against
      // 32 … 51 before, while the batch at the bench went 2.32 → 2.96 segments.
      // Read the two together or neither means anything: `meanBatch` below is
      // the length, this is the variety, and the grinder's 1 … 10 is still the
      // separation the number is here for.
      expect(batcher.ladders).toBeGreaterThan(10);
      // The gap below is *mostly* what the candy is worth, and no longer quite
      // all of it. The grinder still never steers into itself; the batcher now
      // rarely does — measured **3 breaks across the sixteen** seven-minute runs
      // of `SWEEP`, no seed contributing more than one, and 0 across the four
      // this test runs over. Against 0 everywhere before the ceiling went up.
      // That is the cost `broken` was put here to carry (a production line is a
      // longer strand, and a longer strand is easier to run into), so it is
      // held to a ceiling rather than to zero — a break every fifth run cannot
      // account for the score gap, which is what this has to establish before
      // that gap can be read as economics. The gap is **2.24×** in aggregate
      // over the four seeds here (2.64× over `SWEEP`), and the four carry no
      // breaks at all.
      expect(batcher.broken).toBeLessThanOrEqual(1);
      expect(grinder.broken).toBe(0);
    });
  });

  it('fills the window the seventh sitting opened', () => {
    // See `peakQueue` for why occupancy is read back at all. The claim is about
    // the **ramp** — that every slot it promises is a slot a run actually sees
    // — so it is carried by the maker who lives long enough to be shown them
    // all. That is the grinder, on every seed of the draw.
    target(grinderGoal, SWEEP).forEach((run, index) => {
      expect(run.peakQueue, `seed ${SWEEP[index]}`).toBe(PEAK_QUEUE);
    });

    // The batcher is held one slot lower, and the slack is a run length rather
    // than a window that failed to open: the last widening is a row on the ramp,
    // and a maker who dies before reaching that row never sees it. Measured
    // 15 of 16 at the full depth and one at three, on a `SWEEP` median run of
    // 3.95 min — where before the ceiling went up it was 16 of 16 on 5.7.
    // A *second* seed dropping would not be slack; it would be the window
    // closing, which is the thing the seventh sitting built this to catch.
    const short = target(batcherGoal, SWEEP).filter((run) => run.peakQueue < PEAK_QUEUE);
    expect(
      short.length,
      `${short.length} of ${SWEEP.length} short of the window`,
    ).toBeLessThanOrEqual(1);
    target(batcherGoal, SWEEP).forEach((run, index) => {
      expect(run.peakQueue, `seed ${SWEEP[index]}`).toBeGreaterThanOrEqual(
        PEAK_QUEUE - 1,
      );
    });
  });

  it('builds the long strand the open finding is about', () => {
    // What this harness can answer, pinned rather than left to be rediscovered
    // — and it is the *inverse* of what stood here for five sittings. The old
    // `bestLadder` sized a batch from the primaries of one waiting order plus
    // the raw beneath them, so the bot could not ask for a fourth segment, and
    // this test said so: peak 4, mean 1.31. A green sweep was then evidence
    // about a maker who batches three and about nothing longer, which is why
    // four arms of a sugar-supply change moved the number by 0.1.
    //
    // The ceiling is up. A rung can now carry several segments (`planLadder`'s
    // counts), and the plan runs past the window into the rack the next child
    // sweeps — so the maker builds for demand that has not walked in yet, which
    // is what the plan named as the prerequisite for asking any long-strand
    // question at all.
    //
    // Measured over `SWEEP`, before → after: batch at the bench 2.32 → 2.96
    // segments, carried mean 1.22 → 1.94, peak 4 → 9. The floors below are set
    // under the *worst* seed rather than at the mean (batch 2.69, peak 5,
    // carried 1.71), since what has to be true for the evidence to mean
    // anything is that no seed is quietly still playing the old game.
    target(batcherGoal, SWEEP).forEach((batcher, index) => {
      const seed = `seed ${SWEEP[index]}`;
      expect(batcher.peakSegments, seed).toBeGreaterThan(4);
      expect(batcher.meanBatch, seed).toBeGreaterThan(2.4);
      // Pinned beside the batch it is quoted with. `meanSegments` is what the
      // old ceiling test held *under* 2 on every seed; it is a different
      // question from `meanBatch` — what the maker drags around all run, not
      // what reaches the bench — and a documented metric nothing reads is how
      // this file has gone blind before.
      expect(batcher.meanSegments, seed).toBeGreaterThan(1.5);
    });

    // And the grinder is untouched by all of it: it carries one segment by
    // construction, so it stays the floor a balancing pass has to beat.
    target(grinderGoal, SWEEP).forEach((grinder, index) => {
      expect(grinder.meanBatch, `seed ${SWEEP[index]}`).toBeLessThan(1.5);
    });
  });

  it('still pays it nothing for the extra work — the open finding', () => {
    // Every extra candy the batcher makes is made for a window that did not
    // ask for it. That is an invariant — it holds on a run or it does not — so
    // the four carry it. Measured 16 of 16 across the wider draw as well.
    const grinders = target(grinderGoal);
    target(batcherGoal).forEach((batcher, seed) => {
      expect(batcher.staled).toBeGreaterThan(grinders[seed]!.staled);
    });

    // Whether the maker doing more work is *paid* less for it used to be an
    // invariant, asked of the same four. It is a proportion now, so it is asked
    // of the draw that can carry one (`SWEEP`, and see its own note on why four
    // cannot) — and the proportion is **0 of 16**.
    //
    // It read 1 of 16 for two sittings, on a window that refills giving a fixed
    // bundle more targets to land on. Raising the bot ceiling took it back to
    // zero, and that is the more useful number: the seed the batcher used to
    // win is gone, but it is gone from a bot that now builds a batch of three
    // at the bench instead of two, plans past the window, and still loses on
    // every seed. Five sittings held this open on the grounds that the harness
    // could not be asked. Asked properly, the answer did not change.
    //
    // Closing the finding means this number crossing the halfway mark and the
    // assertion inverting with it — not the assertion being deleted.
    const sweptGrinders = target(grinderGoal, SWEEP);
    const ahead = target(batcherGoal, SWEEP).filter(
      (batcher, seed) => batcher.game.state.score > sweptGrinders[seed]!.game.state.score,
    );
    expect(
      ahead.length * 4,
      `the batching maker outscored the grinder on ${ahead.length} of ${SWEEP.length} seeds`,
    ).toBeLessThanOrEqual(SWEEP.length);
  });
});
