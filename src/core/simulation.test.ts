import { describe, expect, it } from 'vitest';

import { CHOP_BLOCK_CELLS, COLS, ROWS, eq } from './board';
import { PRIMARIES, mixCount, primariesOf, type Primary } from './colors';
import { RAMP, SPEED_RUNGS } from './difficulty';
import { DEFAULT_CONFIG, Game, STARTING_LIVES } from './game';
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

/** Where a bot is heading this move. */
type Goal = (state: GameState) => Vec2;

/**
 * The jar for the first primary `held` still lacks, if one is on the board.
 * Both bots want exactly this; they differ only in what they do when the floor
 * has not got it.
 */
const jarTowards = (
  state: GameState,
  held: ColorMask,
  needed: readonly Primary[],
): Vec2 | undefined => {
  const missing = needed.find((primary) => (held & primary) === 0);
  if (missing === undefined) return undefined;

  return state.pickups.find(
    (pickup) => pickup.kind === 'dye' && pickup.primary === missing,
  )?.pos;
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
  const sugar = state.pickups.find((pickup) => pickup.kind === 'sugar');
  const carried = state.snake.body[0];
  if (carried === undefined) return sugar?.pos ?? BENCH;

  const want = state.customers[0]?.want ?? RAW;

  return jarTowards(state, carried.color, primariesOf(want)) ?? BENCH;
};

/**
 * Every ordering of a set, longest-first being no cheaper than shortest — there
 * are at most six of these, since a color holds at most three primaries.
 */
const orderings = <T>(items: readonly T[]): T[][] =>
  items.length <= 1
    ? [[...items]]
    : items.flatMap((item, index) =>
        orderings([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
          item,
          ...rest,
        ]),
      );

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

/** How many waiting children a batch of these colors could hand a candy to. */
const coverage = (rungs: readonly ColorMask[], wants: readonly ColorMask[]): number => {
  const spare = [...rungs];
  let matched = 0;

  for (const want of wants) {
    const slot = spare.indexOf(want);
    if (slot < 0) continue;
    spare.splice(slot, 1);
    matched += 1;
  }

  return matched;
};

/**
 * Which ladder to build, as the sequence its dyes go on in.
 *
 * The maker plans against the **whole** window rather than whoever is at the
 * front of it. A ladder is a nested bundle — one secondary over one particular
 * primary over a raw — so building it for a single order leaves the lower rungs
 * to sell themselves, and against seven colors of uncorrelated demand they
 * mostly do not: measured, the strand banked more candy than the grinder and
 * sold less of it. Choosing *which* order to build for, and in which sequence,
 * is what puts those rungs in front of children who are already waiting.
 *
 * Coverage is worth an order of magnitude more than length, so a longer ladder
 * that serves two is taken over a short one that serves one — but between
 * ladders that serve the same number, the shorter wins. That tie-break is the
 * one that matters: what kills a maker is not waste but the time spent building
 * before anybody is handed anything.
 */
const bestLadder = (state: GameState): Primary[] => {
  const wants = state.customers.map((customer) => customer.want);

  let best: Primary[] = [];
  let bestScore = -Infinity;

  for (const want of wants) {
    for (const order of orderings(primariesOf(want))) {
      const score = coverage(ladderColors(order), wants) * 10 - order.length;
      if (score > bestScore) {
        bestScore = score;
        best = order;
      }
    }
  }

  return best;
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
 * The ladder is cut to the window as a whole (`bestLadder`): one segment per
 * jar it calls for, plus the raw one under them all. Nothing is counted between
 * moves — how far the build has got is read back off the head-end segment's
 * color — so a strand broken mid-build, or a queue that changed while it was
 * being built, simply re-plans from whatever survived.
 *
 * Where the board withholds a cube, the bot takes the next jar it still needs
 * rather than stalling. That is not a special case for the opening levels: it
 * is what those levels are stocked to teach, since each lays one cube and waits
 * for it to come back (design §7). The same rule plays them correctly.
 */
const batcherGoal: Goal = (state) => {
  const carried = state.snake.body;
  const held = carried[0]?.color ?? RAW;
  const needed = bestLadder(state);
  const mixes = mixCount(held);
  /** A segment per jar the ladder calls for, plus the raw one under them all. */
  const batchSize = needed.length + 1;
  /**
   * Steering at nothing in particular, which `steerTowards` reads as "no turn":
   * the maker carries straight on. It is what to do when the jar the ladder
   * wants is not out yet — design §8.3 guarantees one within seconds, and a lap
   * of the kitchen costs far less than taking a half-built ladder to the block
   * and throwing the rest of the trip away.
   */
  const circle = state.snake.head;

  if (carried.length >= batchSize) return BENCH;

  // Dye what is on the strand before laying the next cube on top of it. A cube
  // taken first would cross this jar too, and the ladder would come out flat.
  if (mixes < carried.length) return jarTowards(state, held, needed) ?? circle;

  const sugar = state.pickups.find((pickup) => pickup.kind === 'sugar');
  if (sugar !== undefined) return sugar.pos;

  // No cube to be had, so press on with the next jar rather than stall. This is
  // a real test rather than the one above again: an order that changed
  // mid-build can leave `held` carrying a primary the new one does not need.
  if (mixes >= needed.length) return BENCH;

  return jarTowards(state, held, needed) ?? circle;
};

const botFor = (game: Game, goalOf: Goal = grinderGoal): TurnSource => ({
  take: () => steerTowards(game.state, goalOf(game.state)),
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
      if (event.type === 'strand-cut') {
        const colors = new Set(event.batch.map((segment) => segment.color));
        if (colors.size > 1) ladders += 1;
      }
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

  it('ends a batching run inside the window the ramp is aimed at', () => {
    // How often the ramp closes a run out is a rate, so it is asked of the
    // wider draw (`SWEEP`) rather than of the four. Every seed, now that an
    // emptied window refills rather than standing open: the queue the run ends
    // on is one the maker actually had to hold off. Measured 16/16, against
    // 14/16 when the window admitted one child per interval whatever it held.
    const diedAt = target(batcherGoal, SWEEP)
      .map((run) => run.diedAtMs)
      .filter((ms): ms is number => ms !== undefined);
    expect(diedAt.length).toBeGreaterThanOrEqual(14);

    // *When* it closes them out is the target itself, and the median is what
    // carries it: the tail is a re-roll on any given seed (anything that moves
    // a spawn re-rolls every free cell drawn after it) but the middle of the
    // draw is not. Measured 5.16 min, over deaths running 4.2 … 7.7, against
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
    const sorted = [...diedAt].sort((a, b) => a - b);
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
    // Measured **2** of 16, against 3 for the serve count on the same
    // (mercy-fixed) draw. That is the one thing keying on score bought here,
    // and the interquartile range says it more plainly: 4.3–6.7 min under the
    // serve count against 4.7–6.2 under score, so the distribution closed in
    // from *both* ends. A score is a read on how well a run is going where a
    // serve count reads only how long it has been going on, so the runs that
    // used to get away are the ones the curve now catches.
    const late = diedAt.filter((ms) => ms > 7 * 60_000);
    expect(
      late.length * 4,
      `${late.length} of ${diedAt.length} closed-out runs passed seven minutes`,
    ).toBeLessThanOrEqual(diedAt.length);
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
      // A floor rather than a target, and it has come down from 30 twice in one
      // sitting for the same arithmetic reason both times: a run that ends
      // sooner makes fewer cuts, so this counts down with the median it is
      // measured beside rather than saying anything new when it moves.
      // Measured 32 … 51 on the four this runs over, bottoming at 32 across the
      // wider draw — against the grinder's 4 … 9, which is the separation the
      // number is actually here for. Set below the wider draw's floor so that
      // asking it of `SWEEP` later would not need a third revision.
      expect(batcher.ladders).toBeGreaterThan(20);
      // Neither bot ever steers into itself, so none of the gap below is a
      // longer strand being clumsier — it is all what the candy is worth.
      expect(batcher.broken).toBe(0);
    });
  });

  it('fills the window the seventh sitting opened', () => {
    // See `peakQueue` for why occupancy is read back at all. Measured: every
    // slot the ramp opens is reached on every seed of the draw, both bots.
    for (const goalOf of [batcherGoal, grinderGoal]) {
      target(goalOf, SWEEP).forEach((run, index) => {
        expect(run.peakQueue, `seed ${SWEEP[index]}`).toBe(PEAK_QUEUE);
      });
    }
  });

  it('never builds the long strand the open finding is about', () => {
    // What this harness can and cannot answer, pinned rather than left to be
    // rediscovered. `batcherGoal` sizes its batch from `bestLadder` — the
    // primaries of one waiting order, plus the raw under them — so the tallest
    // thing any order can ask for is a secondary's two dyes over a raw, and the
    // bot never asks for a fourth segment. A fourth is one it was handed: once
    // the batch is full the goal is the bench, and it stops steering around
    // sugar rather than avoiding it. It spends most of its life carrying one
    // segment: measured mean 1.31, peak 4.
    //
    // So a green sweep here is evidence about a maker who batches *three*, and
    // about nothing longer. The temporal half of the open finding — that a
    // ladder costs more trip time than a customer's patience affords — is a
    // claim about strands this harness never builds, which is why four arms of
    // a sugar-supply change moved this number by 0.1 (see the plan, under the
    // sugar-supply pass). Lifting this ceiling comes before measuring any lever
    // aimed at it.
    target(batcherGoal, SWEEP).forEach((batcher, index) => {
      const seed = `seed ${SWEEP[index]}`;
      expect(batcher.peakSegments, seed).toBeLessThanOrEqual(4);
      expect(batcher.meanSegments, seed).toBeLessThan(2);
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
    // invariant too, asked of the same four. A window that refills has taken
    // it off that footing: a fixed bundle has more targets to land on when
    // three children are waiting than when one is, and on one seed in the draw
    // that is now enough to put the batcher ahead. One seed is not a closure —
    // it is the first movement anything has produced on this finding, and it
    // is a proportion now, so it moves to the draw that can carry a proportion
    // (`SWEEP`, and see its own note on why four cannot).
    //
    // Measured 1 of 16, against 0 of 16 before. Closing the finding means this
    // number crossing the halfway mark and the assertion inverting with it —
    // not the assertion being deleted.
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
