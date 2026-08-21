import { MIXING_STAGE, type StageConfig } from './orders';

/**
 * The endless ramp (design §7), as a continuous curve rather than a staircase.
 *
 * Every knob the game has lives in the anchor table below and nowhere else, so
 * tuning is one diff against one table — the implementation plan's mitigation
 * for "balance is opinion". The rows between anchors are interpolated, which is
 * what design §7 means by the arrival interval shrinking *smoothly* rather than
 * stepping at a stage boundary.
 */

/**
 * How much ramp one point is worth. Design §7 drives difficulty by elapsed time
 * **and/or** how well the run is going, whichever is further along, so that a
 * strong player is not held back by the clock and a stalling one still ramps.
 * "Whichever is further along" is a literal `max` below.
 *
 * It used to be 6 000 ms per *serve*, a count. Score replaced it because a
 * count is not what the player is looking at: the HUD shows a score and nothing
 * else, so "the shop gets busier as your score climbs" is a rule that can be
 * read off the screen, where "as you serve your thirtieth candy" cannot be
 * (design §11 wants the rules legible, and this is the one the whole run hangs
 * on). What made the swap safe rather than a rebalance is that score turned out
 * to be the *steadier* measure of the two: traced against ramp position, both
 * reference bots settle at 65–70 ms per point from ramp-minute 1.5 on, despite
 * serving at very different rates. So this number is measured rather than
 * chosen — 70 is where the score term delivers the curve the serve term did.
 *
 * The consequence worth knowing before retuning it: `scoreServe` multiplies by
 * tier, by patience and by streak, so a tier-3 serve made promptly on a capped
 * streak is 150 points and a late raw is 10. Under the old count both advanced
 * the ramp 6 s; under this one they advance it 10.5 s and 0.7 s. Playing well
 * therefore pulls the curve forward, which is the whole point of keying on
 * score and is also the thing to look at first if the ramp ever feels like it
 * is punishing a good run. Measured, it tightens the tail rather than the
 * middle — see the tenth sitting in the implementation plan.
 */
const MS_PER_POINT = 70;

/** One row of the table, and where on the ramp it holds. */
interface Anchor extends StageConfig {
  readonly atMs: number;
}

/**
 * Where the ramp is measured from is the **handover**, not the start of the
 * run: design §7's ramp "starts only once level 3 is served", so a player who
 * takes their time over the opening levels must not find the rush already
 * waiting for them when they finish.
 */
export const RAMP: readonly Anchor[] = [
  // The handover itself — Mixing's demand at Warm-up's speed (see MIXING_STAGE).
  { ...MIXING_STAGE, atMs: 0 },
  // Settled: the maker is now up to the Mixing row's 7 cells/s.
  {
    atMs: 60_000,
    mix: [10, 50, 40],
    maxQueue: 3,
    patienceMs: 35_000,
    arrivalIntervalMs: 10_000,
    moveIntervalMs: 143,
  },
  // Rush (design §7's last row): secondaries dominate, speed at its 8 cells/s cap.
  {
    atMs: 180_000,
    mix: [5, 35, 60],
    maxQueue: 4,
    patienceMs: 30_000,
    arrivalIntervalMs: 6_000,
    moveIntervalMs: 125,
  },
  // Past Rush the table is open-ended ("8+ min"). Speed has capped, so the
  // window is the only thing still tightening — which is what makes a run end:
  // design §1 has difficulty ramping *until lives run out*, and a curve that
  // flattened while the player still had headroom would never get there.
  {
    atMs: 420_000,
    mix: [5, 35, 60],
    maxQueue: 4,
    patienceMs: 28_000,
    arrivalIntervalMs: 4_000,
    moveIntervalMs: 125,
  },
  // The backstop. Nobody serves four children every two seconds for long, so
  // this is where a run that got this far is brought to an end rather than left
  // to go on forever.
  {
    atMs: 900_000,
    mix: [5, 35, 60],
    maxQueue: 4,
    patienceMs: 22_000,
    arrivalIntervalMs: 2_800,
    moveIntervalMs: 125,
  },
];

/**
 * The speed ladder — the one knob on this table that is **stepped rather than
 * interpolated**, and the reason is that a smooth speed curve is one nobody can
 * feel.
 *
 * Every other column moves continuously because a jump would lurch, and speed
 * was written the same way. It cost the ramp its most expensive lever. Measured
 * off the curve, the interval changed 2.4–3.1% per five seconds through the
 * ease-in and **0.52%** per five seconds from the Settled row to the cap.
 * Speed discrimination sits around 5%, so between minute one and minute three
 * the strand crossed a third of its whole range at a tenth of the rate an eye
 * can resolve — and then stopped for good at the cap, a minute and a half
 * before the median run ends. What the player was left with was "it feels
 * faster sometimes", which is a lever spending itself where nobody is looking.
 *
 * So the interval is snapped to the rungs below, and each new rung is announced
 * (`speed-raised`, the Quicken cue, the head's pulse). Seven steps of **6.9%**
 * apiece, comfortably over that threshold: the strand changes gear at a moment
 * the player can point at, and the last rung is a thing the run can finally
 * say out loud rather than a silence that happens to go on forever.
 *
 * The rungs are geometric rather than evenly spaced in milliseconds, because
 * what the player resolves is the *ratio*: an even ladder in ms would step 8%
 * at the slow end and 5% at the fast one for the same nominal size. Two things
 * fall out of that which are worth knowing before retuning it.
 *
 * - **Rung 5 is 143 ms, the Settled anchor exactly.** Not arranged — the
 *   handover-to-Settled span is 2.49 times the Settled-to-Rush span in log
 *   terms, and five rungs against two is 2.5. The ladder the table already
 *   implied is the ladder it got, which is why this changes the shape of the
 *   ramp far less than a stepped column sounds like it should.
 * - **The snap is to the nearest rung, never down to the last one passed.**
 *   Down would leave the strand slower than the measured curve everywhere
 *   between rungs — a difficulty change wearing a legibility change's clothes.
 *   Nearest keeps the deviation centred either side: measured over seven
 *   minutes of ramp the mean interval moves by **0.003%**, and the ramp spends
 *   21.4% of itself just under the old curve against 21.4% just over it. On a
 *   64-seed draw of the batching bot that lands the median at 5.30 min against
 *   the continuous curve's 5.17 on the same seeds, with the same 5 runs past
 *   seven minutes — a re-roll, not a re-balance.
 *
 * The ladder cannot go backwards: `rampMs` only ever climbs, so the interval
 * only ever shrinks and the rung only ever rises. That is what lets `Game`
 * announce a rung by remembering the last one, with no hysteresis to tune.
 */
export const SPEED_RUNGS: readonly number[] = [
  200, 187, 174.9, 163.5, 152.9, 143, 133.7, 125,
];

/**
 * Which rung an interval stands on.
 *
 * The ladder descends, so the scan stops at the first rung the value sits above
 * the midpoint of: nearest, in one pass, with no `Math.abs` and no second table
 * of boundaries that could drift out of step with this one.
 *
 * A plain loop for the same measured reason `spanAt` is one — this runs inside
 * `stageAt`, which `Game.step` re-reads between every grid move.
 */
export const speedRungOf = (intervalMs: number): number => {
  const top = SPEED_RUNGS.length - 1;
  for (let rung = 0; rung < top; rung += 1) {
    if (intervalMs > (SPEED_RUNGS[rung]! + SPEED_RUNGS[rung + 1]!) / 2) return rung;
  }

  return top;
};

/**
 * Where the speed ease-in finishes and the ramp proper begins — read off the
 * table rather than written down twice, so moving the anchor moves this with it.
 * The brown-mercy customer is held back until here (design §7).
 */
export const SETTLED_MS = RAMP[1]!.atMs;

/**
 * Where the rush begins — the same moment the speed ease-in ends and the ramp
 * proper starts, which is why it is `SETTLED_MS` rather than a number of its
 * own. Moving that anchor moves this with it.
 *
 * It used to be the Rush row at three minutes, on the reasoning that a tide
 * belonged *past* the last lever rather than among them. The ninth sitting is
 * the second report of staleness and it arrived at **400 points**, which the
 * harness puts at ramp-minute 0.5–0.6 — so the flat stretch being complained
 * about is the one between the handover and the tide, not the one after it. A
 * shape the player meets in the last third of a run is not a shape the run has.
 */
export const RUSH_FROM_MS = SETTLED_MS;

/**
 * The rush (design §7).
 *
 * Every lever that adds a *kind* of thing is spent by the three-minute mark —
 * max queue at 2 min, the order mix and the speed cap at 3 — and what is left
 * either side of that is numbers getting smaller, which the seventh sitting
 * judged to be labour rather than difficulty. This is the element that is not a
 * number: the window stops being a steady drip and becomes a tide, so there is
 * a shape to read and play against rather than a rate to keep up with. A maker
 * who sees one coming has a reason to build a ladder into it instead of
 * chopping singles through a flat interval, which is the batching lever the
 * first sitting asked for in the one shape that is not a permanently harder
 * game.
 *
 * It moves `arrivalIntervalMs` and **nothing else**. `ui/layout.ts` sizes the
 * standing line for four children and `CustomerQueue.standingX` clamps nothing,
 * so a fifth walks off the frame: a deeper queue is a layout job first.
 *
 * And it is one pure term over ramp position with no rng in it, so a seeded run
 * still replays exactly and the shape is unit-tested like the rest of the table.
 */

/** One tide, from the start of a lull to the end of the ebb. */
export const RUSH_PERIOD_MS = 60_000;

/**
 * The tide, as fractions of a period — the same anchor-and-interpolate idiom
 * `RAMP` is written in, and for the same reason: the shape is the tuning, and
 * it should be one table to read rather than a formula to unpick.
 *
 * The lull is half the cycle, because that is what the maker builds in — a
 * ladder the window has no room for is the fixed bundle problem, not a batch.
 *
 * The swell is the telegraph (design §11 wants that drawn, not written), and
 * nine seconds is sized against the thing it is meant to let the player start:
 * the sugar-supply pass measured a six-rung ladder at ~69 moves, which is 8.6 s
 * at the Rush row's 125 ms. Not a trip to the bench — that is 16 cells, two
 * seconds — but a whole batch built from nothing, which is what a maker who
 * reads the doorway is being given time to do.
 *
 * Now that the tide starts at `SETTLED_MS` the earliest swells are read at that
 * row's 143 ms instead, where the same ladder is 9.9 s — a shade longer than
 * the warning. The warning is deliberately left where it is: the *lull* is the
 * half a ladder is built in (see `RUSH_SHAPE`), and the swell only has to be
 * long enough to start one. Sizing it off the slowest row would make it too
 * long everywhere else, and the swell is measured as a fraction of the period
 * rather than in moves for the same reason `RAMP` interpolates — one shape,
 * read the same way at every point on the curve.
 */
const RUSH_SHAPE: readonly { readonly at: number; readonly intensity: number }[] = [
  { at: 0, intensity: 0 },
  { at: 0.5, intensity: 0 }, // the lull — where a ladder gets built
  { at: 0.65, intensity: 1 }, // the swell, ~9 s of it, which is the warning
  { at: 0.85, intensity: 1 }, // the peak, ~12 s
  { at: 1, intensity: 0 }, // and the ebb
];

/**
 * How fast children arrive at the lull and at the peak, against the interval
 * the anchor table names.
 *
 * The trough is shallower than the table rather than level with it — a peak
 * measured against an unchanged baseline is simply more game, and the seventh
 * sitting's table is already landing its death target. But it is only *just*
 * shallower, and the reason is the one thing the sweep had to be asked before
 * these two numbers could be picked.
 *
 * **A rate-neutral tide is not a difficulty-neutral one.** `admitCustomer`
 * stops admitting at `maxQueue`, so the surplus rate at a peak is clipped by
 * the window the moment it fills, while every millisecond of a longer lull is
 * recovery time paid to the maker in full. Balanced to cancel on paper (0.8 and
 * 1.5, mean rate 1.04) the rush pushed the batching maker's median death from
 * 5.8 minutes to 6.6 — the first thing the sweep said about it was that it had
 * made the game *easier*.
 *
 * At the pair below the same sweep reads 5.79 min against a no-rush baseline of
 * 5.80, 16/16 closed out either way, while mean queue occupancy over the tide
 * swings 2.64 → 3.37 and arrivals 12.6 → 16.4 a minute. That is the whole
 * intent stated as a measurement: a board that visibly changes, on a curve that
 * did not move.
 */
const CALM_RATE = 0.95;
const PEAK_RATE = 2.6;

/**
 * How far along the ramp a run stands, in milliseconds of *equivalent* time.
 * Scoring faster than the clock pulls the curve forward; scoring slower leaves
 * the clock to carry it.
 *
 * The clock is kept as the floor rather than dropped for score alone, and it is
 * not decoration: without it a maker who serves just enough to hold their lives
 * and no more would sit at the handover's twelve-second interval indefinitely,
 * and design §1 has difficulty ramping *until lives run out*. For anyone
 * actually playing, the score term is the one that binds.
 */
export const rampMs = (endlessMs: number, endlessScore: number): number =>
  Math.max(endlessMs, endlessScore * MS_PER_POINT);

/** Exported for the tests, which rebuild the pre-snap speed curve with it. */
export const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * t;

/**
 * Brackets `at` in a table sorted by `keyOf` and reports how far between the two
 * rows it falls. Both tables in this file are read through it — the anchors and
 * the tide — so the bracketing rule is settled once rather than twice.
 *
 * `>=` rather than `>`, so landing exactly on a row brackets it as the *end* of
 * a span (t=1) instead of the start of the next one (t=0): the same row either
 * way, but it keeps the final row reachable.
 *
 * `t` is **not clamped**, and neither caller wants it to be: `stageAt` clamps
 * its position into the table beforehand and `rushShape`'s phase cannot leave
 * [0,1), so both are inside the table by construction. A position outside it
 * extrapolates — which is the honest answer for a table of anchors, and is why
 * both ends are picked deliberately: below the first row the opening span is
 * used with a negative `t`, and past the last row the closing span, rather than
 * a "not found" being fed back as an index. Starting the scan at 1 is what
 * settles the first of those. Rows must have distinct keys, or `t` divides by
 * zero.
 *
 * Exported for the same reason `arrivalRateAt` is — the drift test rebuilds the
 * continuous curve this file used to hand out, and transcribing the bracketing
 * rule over there would let the two drift apart silently: the test would go on
 * measuring the snap against a curve the module had stopped drawing.
 *
 * The scan is a plain loop and not `findIndex` for a measured reason. With two
 * call sites passing different row shapes, `keyOf` inside a builtin's callback
 * goes polymorphic, inlining stops and both closures start being materialized:
 * `stageAt` measured 71.6 ns/call that way against 18.3 ns with the loop, on a
 * getter read a few hundred times a second. Neither figure is anything against
 * a frame budget — but a 4× on the most-called function in `core/` is not worth
 * paying for a builtin that saves two lines.
 */
export const spanAt = <T>(
  table: readonly T[],
  keyOf: (row: T) => number,
  at: number,
): { from: T; to: T; t: number } => {
  let next = table.length - 1;
  for (let index = 1; index < table.length; index += 1) {
    if (keyOf(table[index]!) >= at) {
      next = index;
      break;
    }
  }

  const from = table[next - 1]!;
  const to = table[next]!;

  return { from, to, t: (at - keyOf(from)) / (keyOf(to) - keyOf(from)) };
};

/** The tide's own shape, before the ease-in below is applied to it. */
const rushShape = (rampPosMs: number): number => {
  const phase = ((rampPosMs - RUSH_FROM_MS) % RUSH_PERIOD_MS) / RUSH_PERIOD_MS;
  const { from, to, t } = spanAt(RUSH_SHAPE, (point) => point.at, phase);

  return lerp(from.intensity, to.intensity, t);
};

/**
 * How far the tide has come in: 0 at the Settled row, 1 a period later.
 *
 * It comes in over its own first period rather than switching on, so that the
 * anchor it starts from is still the row as written and the run does not step
 * to an easier interval at the exact moment the rush was added to make it less
 * flat. The whole table is written to move smoothly (design §7).
 */
const rushSwing = (rampPosMs: number): number =>
  Math.min(Math.max((rampPosMs - RUSH_FROM_MS) / RUSH_PERIOD_MS, 0), 1);

/**
 * How hard the tide is actually running at a point on the ramp — 0 through the
 * lull, 1 at a full peak, the swell and ebb in between, and everything scaled
 * back while the tide is still coming in.
 *
 * This is what the HUD draws (`Game.rush`), and it is the *delivered* figure
 * rather than the raw shape on purpose: a doorway that filled right up while
 * the first, half-strength tide was still easing in would be promising a flood
 * that is not coming.
 *
 * Takes the same (clock, score) pair `stageAt` does, so where a run stands on
 * the ramp stays a question this file answers — the HUD asks how hard the rush
 * is running, not how far along a curve it is.
 *
 * Unlike `stageAt` it does not clamp into the anchor table: those stop at the
 * backstop and the tide does not, and clamping would freeze it at whatever
 * phase 15 minutes happens to land on — leaving the longest runs the only ones
 * with no rush in them.
 */
export const rushAt = (endlessMs: number, endlessScore: number): number =>
  arrivalTideAt(rampMs(endlessMs, endlessScore));

/** The same, off a ramp position already in hand — `stageAt`'s way in. */
const arrivalTideAt = (rampPosMs: number): number =>
  rampPosMs <= RUSH_FROM_MS ? 0 : rushShape(rampPosMs) * rushSwing(rampPosMs);

/**
 * What the tide does to the arrival interval, as a **rate** — twice the rate is
 * half the wait, which is why `stageAt` divides by it rather than scaling.
 *
 * The ease-in is applied to the whole swing rather than to the shape, because
 * the two are not the same easing: a tide half come in should be half as far
 * from *neutral*, not half as far from its own lull.
 *
 * Exported for the tests, which divide it back out to assert that the *baseline*
 * under the tide still tightens the way design §7's table says it does.
 */
export const arrivalRateAt = (rampPosMs: number): number => {
  if (rampPosMs <= RUSH_FROM_MS) return 1;

  return lerp(1, lerp(CALM_RATE, PEAK_RATE, rushShape(rampPosMs)), rushSwing(rampPosMs));
};

/**
 * The difficulty in force at a point on the ramp.
 *
 * The position is clamped into the table rather than the ends being special
 * cases: clamped to the first anchor the interpolation below runs at t=0 and
 * clamped to the last at t=1, either of which reproduces that row exactly. So
 * "before the handover" and "past the backstop" come out right without a branch
 * that could disagree with the interpolated middle.
 */
export const stageAt = (endlessMs: number, endlessScore: number): StageConfig => {
  const first = RAMP[0]!;
  const last = RAMP[RAMP.length - 1]!;
  const pos = rampMs(endlessMs, endlessScore);
  const at = Math.min(Math.max(pos, first.atMs), last.atMs);
  const { from, to, t } = spanAt(RAMP, (anchor) => anchor.atMs, at);

  return {
    // Weights are relative, so a fractional mix is a real mix rather than a
    // rounding error: `rollOrder` divides by their sum.
    mix: [
      lerp(from.mix[0], to.mix[0], t),
      lerp(from.mix[1], to.mix[1], t),
      lerp(from.mix[2], to.mix[2], t),
    ],
    // The one knob that has to be whole — half a place at the window is not a
    // thing the queue can hold.
    maxQueue: Math.round(lerp(from.maxQueue, to.maxQueue, t)),
    patienceMs: lerp(from.patienceMs, to.patienceMs, t),
    // The table names the baseline; the tide is what the window actually does
    // around it. Off the *unclamped* position, so it keeps running past the
    // backstop rather than freezing at whatever phase 15 minutes lands on.
    arrivalIntervalMs:
      lerp(from.arrivalIntervalMs, to.arrivalIntervalMs, t) / arrivalRateAt(pos),
    // The one stepped column: interpolated like the rest, then snapped to the
    // ladder so the change is something the player can feel and be told about
    // rather than a drift under the threshold of noticing (`SPEED_RUNGS`).
    moveIntervalMs:
      SPEED_RUNGS[speedRungOf(lerp(from.moveIntervalMs, to.moveIntervalMs, t))]!,
  };
};
