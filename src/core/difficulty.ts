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
 * How far along the ramp a run stands, in milliseconds of *equivalent* time.
 * Serving faster than the clock pulls the curve forward; serving slower leaves
 * the clock to carry it.
 */
export const rampMs = (endlessMs: number, endlessServed: number): number =>
  Math.max(endlessMs, endlessServed * MS_PER_SERVE);

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

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
  const at = Math.min(Math.max(rampMs(endlessMs, endlessServed), first.atMs), last.atMs);

  // `>=` rather than `>`, so landing exactly on an anchor brackets it as the
  // *end* of a span (t=1) instead of the start of the next one (t=0) — the same
  // row either way, but it keeps the final anchor reachable.
  const next = Math.max(
    1,
    RAMP.findIndex((anchor) => anchor.atMs >= at),
  );
  const from = RAMP[next - 1]!;
  const to = RAMP[next]!;
  const t = (at - from.atMs) / (to.atMs - from.atMs);

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
    arrivalIntervalMs: lerp(from.arrivalIntervalMs, to.arrivalIntervalMs, t),
    moveIntervalMs: lerp(from.moveIntervalMs, to.moveIntervalMs, t),
  };
};
