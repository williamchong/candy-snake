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
 * How much ramp one serve is worth. Design §7 drives difficulty by elapsed time
 * **and/or** candies served, whichever fires first, so that a fast player is not
 * held back by the clock and a slow one is not overrun by it. "Whichever fires
 * first" is a literal `max` below.
 */
const MS_PER_SERVE = 6_000;

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
 * Where the speed ease-in finishes and the ramp proper begins — read off the
 * table rather than written down twice, so moving the anchor moves this with it.
 * The brown-mercy customer is held back until here (design §7).
 */
export const SETTLED_MS = RAMP[1]!.atMs;

/**
 * Where the table runs out of things to introduce, and so where the rush
 * begins. Read off the same row `RAMP` calls Rush, for the reason `SETTLED_MS`
 * is: moving the anchor moves this with it.
 */
export const RUSH_FROM_MS = RAMP[2]!.atMs;

/**
 * The rush (design §7).
 *
 * Past the Rush row every lever that adds a *kind* of thing is spent — max
 * queue at 2 min, the order mix and the speed cap at 3 — and what was left was
 * two numbers getting smaller, which the seventh sitting judged to be labour
 * rather than difficulty. This is the element that goes past that mark: the
 * window stops being a steady drip and becomes a tide, so there is a shape to
 * read and play against rather than a rate to keep up with. A maker who sees
 * one coming has a reason to build a ladder into it instead of chopping singles
 * through a flat interval, which is the batching lever the first sitting asked
 * for in the one shape that is not a permanently harder game.
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
 * The swell is deliberately longer than an eyeblink: it is the telegraph
 * (design §11 wants that drawn, not written), and nine seconds is about the
 * trip time from the far side of the kitchen to the bench.
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
 * Serving faster than the clock pulls the curve forward; serving slower leaves
 * the clock to carry it.
 */
export const rampMs = (endlessMs: number, endlessServed: number): number =>
  Math.max(endlessMs, endlessServed * MS_PER_SERVE);

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

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
 * The scan is a plain loop and not `findIndex` for a measured reason. With two
 * call sites passing different row shapes, `keyOf` inside a builtin's callback
 * goes polymorphic, inlining stops and both closures start being materialized:
 * `stageAt` measured 71.6 ns/call that way against 18.3 ns with the loop, on a
 * getter read a few hundred times a second. Neither figure is anything against
 * a frame budget — but a 4× on the most-called function in `core/` is not worth
 * paying for a builtin that saves two lines.
 */
const spanAt = <T>(
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
 * How far the tide has come in: 0 at the Rush row, 1 a period later.
 *
 * It comes in over its own first period rather than switching on, so that the
 * Rush anchor is still the row as written and the run does not step to an
 * easier interval at the exact moment the rush was added to make it less flat.
 * The whole table is written to move smoothly (design §7).
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
 * Takes the same (clock, serves) pair `stageAt` does, so where a run stands on
 * the ramp stays a question this file answers — the HUD asks how hard the rush
 * is running, not how far along a curve it is.
 *
 * Unlike `stageAt` it does not clamp into the anchor table: those stop at the
 * backstop and the tide does not, and clamping would freeze it at whatever
 * phase 15 minutes happens to land on — leaving the longest runs the only ones
 * with no rush in them.
 */
export const rushAt = (endlessMs: number, endlessServed: number): number =>
  arrivalTideAt(rampMs(endlessMs, endlessServed));

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
export const stageAt = (endlessMs: number, endlessServed: number): StageConfig => {
  const first = RAMP[0]!;
  const last = RAMP[RAMP.length - 1]!;
  const pos = rampMs(endlessMs, endlessServed);
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
    moveIntervalMs: lerp(from.moveIntervalMs, to.moveIntervalMs, t),
  };
};
