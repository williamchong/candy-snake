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
    patienceMs: 42_000,
    arrivalIntervalMs: 10_000,
    moveIntervalMs: 143,
  },
  // Rush (design §7's last row): secondaries dominate, speed at its 8 cells/s cap.
  {
    atMs: 180_000,
    mix: [5, 35, 60],
    maxQueue: 4,
    patienceMs: 36_000,
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
    patienceMs: 34_000,
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
    patienceMs: 26_000,
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
 * Where the rush begins — **inside** the speed ease-in, at 40 s of ramp, which
 * at 70 ms a point is score 571.
 *
 * It used to be the Rush row at three minutes, on the reasoning that a tide
 * belonged *past* the last lever rather than among them; the ninth sitting
 * brought it back to `SETTLED_MS`, where the ease-in ends, on a report of
 * staleness at **400 points** — ramp-minute 0.5–0.6, so the flat stretch being
 * complained about was the one between the handover and the tide rather than
 * the one after it, and a shape the player meets in the last third of a run is
 * not a shape the run has.
 *
 * This is that same argument one row further down, because the settled anchor
 * was still answering a 400-point report with the minute the report was about:
 * the first tide arrived at score 857, and the run before it was the flat
 * stretch. Read as a preview it is now 571 — near enough the reported number
 * that the player meets the game's one shape lever inside the stretch they were
 * calling stale, rather than after it.
 *
 * What it costs is the one thing this anchor was protecting. The last 20 s of
 * the speed ease-in now runs under the first swell, and the standing objection
 * to that is real: a tide laid over a strand still being brought up to pace is
 * two things moving at once with no way to tell which one bit. It is paid
 * deliberately, and it is a smaller bill than it reads as — the overlap is two
 * rungs of an eight-rung ladder (`SPEED_RUNGS`), and the tide spends it at
 * roughly a third of its strength on average: `rushSwing` runs 0 → 2/3 across
 * those 20 s, so the ease-in is only ever muddied by a tide half arrived.
 *
 * It is a number of its own rather than `SETTLED_MS` for the first time, so the
 * tie that made moving the Settled anchor move the tide with it is gone. That
 * is the point rather than a side effect: a tide that previews *before* the
 * ramp proper cannot be defined as the moment the ramp proper starts.
 */
export const RUSH_FROM_MS = 40_000;

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
 * It moves `arrivalIntervalMs` and holds `rushFloorAt`'s floor under the window,
 * and nothing else. `ui/layout.ts` sizes the standing line for four children and
 * `CustomerQueue.standingX` clamps nothing, so a fifth walks off the frame: a
 * deeper queue is a layout job first, which is why the floor stops at three and
 * the cap stays the table's.
 *
 * The shape is one pure term over ramp position with no rng in it, so a seeded
 * run still replays exactly and it is unit-tested like the rest of the table.
 * The floor is a pure term over that shape; what makes it *state* rather than
 * curve is only where it binds — `Game.admitCustomer`, against the window it is
 * holding — so nothing in this file has to know how many children are waiting.
 */

/** One tide, from the start of a lull to the end of the ebb. */
export const RUSH_PERIOD_MS = 60_000;

/**
 * Where the tide has grown to its full size — the table's own **Rush row**,
 * read off `RAMP` rather than written down twice, so moving that anchor moves
 * this with it.
 *
 * The tide arrives as a preview (`RUSH_FROM_MS`, score 571) and grows into the
 * run rather than switching on at one size. That is the answer to the fourth
 * report from the chair — *the rush should run longer and with more children* —
 * and the reason it is a growth rather than a bigger constant is that the
 * preview is the part that was asked for as well: a first tide the player meets
 * early, at a size they can read, is what makes the later ones legible as *the
 * same thing, bigger*. A rush whose first appearance is already its final size
 * has nothing to show but its own arrival.
 *
 * The Rush row is where it finishes because that is where the rest of the table
 * finishes: max queue is done at 2 min, the order mix and the speed cap at 3,
 * and the seventh sitting's complaint was that nothing new arrives after them.
 * The tide is now the one lever that is still growing when they have all
 * stopped, which is the hole that sitting named.
 */
export const RUSH_FULL_MS = RAMP[2]!.atMs;

/**
 * The tide, as fractions of a period — the same anchor-and-interpolate idiom
 * `RAMP` is written in, and for the same reason: the shape is the tuning, and
 * it should be one table to read rather than a formula to unpick.
 *
 * **Two columns, not one**: where each anchor sits at the preview, and where it
 * has moved to once `rushGrowth` is in. They are written as seconds over the
 * period rather than as bare fractions because seconds are what the shape is
 * actually tuned in — a plateau is 12 s or 20 s long, and 0.65 is not a number
 * anybody picked.
 *
 * What grows is the **peak**, and it grows out of the lull: 12 s of plateau
 * becomes 20 s, and the lull pays for it, 30 s down to 22 s. Two things are
 * deliberately held still. The **swell is 9 s in both columns** — it is the
 * warning, and it is sized against the ~69 moves of a ladder built from nothing
 * (below), so a bigger rush that shortened its own telegraph would be an ambush
 * instead. And the **period stays 60 s**, because a period that changed under a
 * running cycle would move the phase discontinuously: the tide could jump from
 * peak to lull mid-swell, and a seeded run would stop replaying.
 *
 * The lull is still where a ladder gets built — a ladder the window has no room
 * for is the fixed bundle problem, not a batch. That is the constraint the
 * grown column is set against rather than a preference: 22 s against the 8.6 s
 * a six-rung ladder takes at the Rush row's 125 ms leaves room for two, which is
 * the same claim the 30 s column makes and the reason the peak did not simply
 * take the whole lull.
 *
 * The swell is the telegraph (design §11 wants that drawn, not written), and
 * nine seconds is sized against the thing it is meant to let the player start:
 * the sugar-supply pass measured a six-rung ladder at ~69 moves, which is 8.6 s
 * at the Rush row's 125 ms. Not a trip to the bench — that is 16 cells, two
 * seconds — but a whole batch built from nothing, which is what a maker who
 * reads the doorway is being given time to do.
 *
 * The earliest swells are read at a slower row than the Rush one — 143 ms at
 * the settled anchor, where the same ladder is 9.9 s, and slower again through
 * the preview, which now starts inside the speed ease-in. The warning is
 * deliberately left where it is: the *lull* is where a ladder is actually built,
 * and the swell only has to be long enough to start one. Sizing it off the
 * slowest row would make it too long everywhere else, and the swell is measured
 * as a fraction of the period rather than in moves for the same reason `RAMP`
 * interpolates — one shape, read the same way at every point on the curve.
 */
const RUSH_SHAPE: readonly {
  readonly at: number;
  readonly grown: number;
  readonly intensity: number;
}[] = [
  { at: 0, grown: 0, intensity: 0 },
  // The lull ends — 30 s of it at the preview, 22 s once the tide is full.
  { at: 30_000 / RUSH_PERIOD_MS, grown: 22_000 / RUSH_PERIOD_MS, intensity: 0 },
  // The crest. Nine seconds of swell either way: the warning does not shrink.
  { at: 39_000 / RUSH_PERIOD_MS, grown: 31_000 / RUSH_PERIOD_MS, intensity: 1 },
  // The peak ends — a 12 s plateau at the preview, 20 s once it is full.
  { at: 51_000 / RUSH_PERIOD_MS, grown: 51_000 / RUSH_PERIOD_MS, intensity: 1 },
  // And the ebb, 9 s either way.
  { at: 1, grown: 1, intensity: 0 },
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
const CALM_RATE = 0.65;
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

/** Kept inside a range — the three curves below all have ends to stop at. */
const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

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

/**
 * Where on `RUSH_SHAPE` a run *enters* the cycle — half a period in, which is
 * the top of the lull and the foot of the first swell.
 *
 * The table is unchanged and the tide still runs lull → swell → peak → ebb
 * forever; this only moves where the run joins it. Entering at 0 meant the very
 * first thing a run met after the tide switched on was thirty seconds of
 * nothing, and the swell that followed was the *second* half of the first
 * period — 39 s of ramp, which at 70 ms a point is score 860 → 1414 spent being
 * told the rush had started and shown nothing at all.
 *
 * That is the third staleness report in this file, and the second to be answered
 * by moving where the tide sits rather than by changing its shape: the ninth
 * sitting brought `RUSH_FROM_MS` down from the three-minute row to the settled
 * one, and this brings the first swell down from 39 s past that anchor to 9.
 * The period, the shape and the peak rate are all untouched, and **from the
 * second cycle on the mean arrival rate is untouched too** — measured over one
 * cycle at 10 ms, 1.5275 either side of this change, exactly. The first cycle is
 * the exception and it is worth stating plainly rather than rounding off, since
 * it is the only one this constant moves: its mean rate falls **1.4081 → 1.2513**,
 * about 11%. Entering at the swell skips that cycle's lull, but it also spends
 * the cycle's second half in an ebb the old entry point spent at a peak, and the
 * shortened `RUSH_SWING_PERIODS` only claws part of it back (the offset alone
 * reads 1.1194).
 *
 * So the honest description is a legibility change everywhere and a slightly
 * *lighter* first cycle, against which the queue floor is the counterweight —
 * and the pair of them is what the sweep is asked about: 64 seeds, batcher
 * median death 5.31 min either side, which is the invariant that actually
 * matters. A claim of "neutral" per cycle would have been the wrong thing to
 * ask it to confirm.
 *
 * It also retires the hazard `rushSwing` was written against: a run entering at
 * the lull met `CALM_RATE` — an interval slightly *easier* than the table's — at
 * the exact moment the rush was added to make the game less flat. Entering at
 * the swell's foot, the first thing the tide does is tighten.
 *
 * **Read off the shape rather than written down**, so "the swell's foot" cannot
 * quietly stop being true: it is the preview column's lull end, which is where
 * the first swell begins. Retuning that anchor without this would leave a run
 * entering somewhere in the middle of a lull again with every test still green.
 * The preview column is the right one to read even though the offset is applied
 * at every phase: the only moment the *entry* reading matters is `RUSH_FROM_MS`
 * itself, where the growth is 0 and the preview column is the shape in force.
 */
const RUSH_OPENS_AT = RUSH_SHAPE[1]!.at;

/**
 * Where in the cycle a ramp position falls, 0…1 — the tide's clock, said once.
 *
 * Both readers of the shape need it: `rushShape` to interpolate the intensity,
 * and `rushMeterAt` to place the run against the edges it has solved for. Two
 * copies is the drift this file keeps closing everywhere else (see
 * `RUSH_FLOOR_FROM`) — and this pair would drift *silently*, because the gauge's
 * edges are phases and would go on being compared against a phase computed a
 * different way. The delivered rush would then stop lining up with the drawn
 * one, which is the single property the whole gauge exists to guarantee.
 *
 * One `%` and no wrap back into range: every caller returns before this on
 * `rampPosMs <= RUSH_FROM_MS`, so the operand cannot be negative, and `spanAt`'s
 * docblock is entitled to say the phase never leaves [0,1).
 */
const rushPhaseAt = (rampPosMs: number): number =>
  ((rampPosMs - RUSH_FROM_MS) / RUSH_PERIOD_MS + RUSH_OPENS_AT) % 1;

/**
 * The tide's own shape, before the ease-in below is applied to it.
 *
 * Two positions are read rather than one: where the run is *within* the cycle
 * (the phase) and how far along the ramp the cycle itself stands (the growth),
 * which is what slides the table's anchors between its two columns. The shape
 * is still one pure term over ramp position with no rng in it, so a seeded run
 * replays exactly.
 *
 * **The closure passed to `spanAt` is free, and the obvious way to remove it is
 * not.** `spanAt`'s own docblock warns about a callback going polymorphic, so a
 * `keyOf` that now captures `grown` looks like exactly that hazard; measured, it
 * is not. Against a variant with the bracketing inlined and no function object
 * at all, this reads 19.6 ns/call to 19.2, and 40M calls under `--trace-gc`
 * scavenge 622 times against 614: V8 inlines `spanAt` here and escape-analyzes
 * the closure away, which it cannot do through a builtin like `findIndex`.
 * Hoisting `keyOf` to a module-level singleton over a module-level `let` — the
 * cheap fix that suggests itself — measures **57.9 ns against 39.7** on
 * `stageAt`, because writing module scope from a hot function is what actually
 * defeats the inlining.
 */
const rushShape = (rampPosMs: number): number => {
  const phase = rushPhaseAt(rampPosMs);
  const grown = rushGrowth(rampPosMs);
  const { from, to, t } = spanAt(
    RUSH_SHAPE,
    (point) => lerp(point.at, point.grown, grown),
    phase,
  );

  return lerp(from.intensity, to.intensity, t);
};

/**
 * How long the tide takes to come fully in, as a fraction of its own period.
 *
 * It used to be a whole period, and that was sized against a hazard
 * `RUSH_OPENS_AT` has since retired: a run entering the cycle at the lull met
 * `CALM_RATE` first, so the tide switching straight on would have handed the
 * player an interval slightly easier than the table's at the exact moment it was
 * added to make the game harder. Easing in over a period hid that.
 *
 * Entering at the swell's foot there is nothing to hide — the shape itself now
 * starts at 0 and climbs, which is the smooth start the ease-in was standing in
 * for. Left at a whole period the two would compound: the first swell would peak
 * 9 s in against a swing only 15% wound on, delivering 0.15 of a tide to a
 * player who had just been shown a doorway. A rush you can see and cannot feel
 * is the complaint this pass exists to answer, so the ease-in is cut to half a
 * period — which is the distance from the entry point through the swell, the
 * peak and the ebb, i.e. exactly the run's **first pass over the tide**. Not the
 * 9 s to the first crest: winding the swing in that fast would put a full-force
 * peak on a player twelve seconds after the rush first existed. What it means
 * in delivered terms, measured: the shape's first crest delivers **0.284** and
 * the first full-strength peak is in the second cycle, at +65 s. (Both were
 * 0.300 and +69 s before the tide grew — the grown column pulls each crest a
 * little earlier in its cycle, so the swing has slightly less time to wind on
 * before the first one.)
 *
 * That 0.284 is the number to look at before retuning any of this. The floor
 * engages at `RUSH_FLOOR_FROM` (1/3), so the first tide crosses it 1.5 s into
 * the peak plateau rather than at the crest — a 15% margin, and a nudge to this
 * constant, to `RUSH_OPENS_AT` or to `RUSH_CROWD` can push a run's first held
 * window a whole cycle later without anything else looking wrong.
 * `difficulty.test.ts` pins that the first tide reaches the floor at all.
 */
const RUSH_SWING_PERIODS = 1 - RUSH_OPENS_AT;

/**
 * How far the tide has come in: 0 at the preview mark, 1 once
 * `RUSH_SWING_PERIODS` of its period has passed.
 */
const rushSwing = (rampPosMs: number): number =>
  clamp((rampPosMs - RUSH_FROM_MS) / (RUSH_PERIOD_MS * RUSH_SWING_PERIODS), 0, 1);

/**
 * How big the tide has grown — 0 at the preview, 1 from the Rush row on
 * (`RUSH_FULL_MS`). The same shape as the swing above and a different question:
 * the swing is how much of one tide has arrived, this is which tide it is.
 * Clamped at both ends, so the shape table reads its preview column exactly at
 * the start and its grown column exactly from the Rush row onward.
 */
const rushGrowth = (rampPosMs: number): number =>
  clamp((rampPosMs - RUSH_FROM_MS) / (RUSH_FULL_MS - RUSH_FROM_MS), 0, 1);

/**
 * How hard the tide is actually running at a point on the ramp — 0 through the
 * lull, 1 at a full peak, the swell and ebb in between, and everything scaled
 * back while the tide is still coming in.
 *
 * The *delivered* figure rather than the raw shape, on purpose: a tide that
 * counted at full strength while it was still easing in would be promising a
 * flood that is not coming.
 *
 * **Nothing in the game reads this any more, and it is kept deliberately.** The
 * HUD drew it until the eleventh sitting and now draws `rushMeterAt`'s gauge;
 * the two production readers left — `rushFloorAt` and `arrivalRateAt` — go
 * through `arrivalTideAt` and `rushShape` below, off a ramp position they
 * already hold. So this is the (clock, score) door onto the same curve, and
 * what still comes through it is `difficulty.test.ts`, which checks the tide's
 * shape here: the gauge's edges are solved against this curve, so a shape
 * nothing can name is a shape nothing can check.
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
  const at = clamp(pos, first.atMs, last.atMs);
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

/**
 * How many children the doorway telegraph draws at a full peak — the
 * `ui/rushDoor.ts` crowd, named here because the floor below is a promise made
 * in that widget's units and kept in the window's.
 *
 * The door fills one figure at a time: the *n*th is fully present at intensity
 * `n / RUSH_CROWD`. So this is not a decoration the rule happens to agree with,
 * it is the rule's own scale.
 */
export const RUSH_CROWD = 3;

/**
 * How many children a running tide insists on having at the window.
 *
 * The tide moved `arrivalIntervalMs` and nothing else, and a rate is the one
 * thing a maker can outrun. `arrivalGapMs` is `intervalMs × (n + 1) / maxQueue`,
 * so with one child waiting the early ramp asks 6.4–8.0 s for the next — against
 * a bench round trip of two or three. A player who keeps up therefore empties
 * the window faster than any interval refills it, and the tide is invisible to
 * exactly the players it was built for: the third staleness report in this file
 * arrived at 1063 points, which is ramp-minute 1.24, from a chair that had never
 * seen two children at once.
 *
 * Clipping is why a rate alone cannot fix that. The plan already recorded one
 * half of it — at a peak the surplus rate "is clipped by the window the moment
 * it fills" — and this is the other half: below `maxQueue` the surplus is
 * clipped by the *maker*, and the better they are the more of it they clip. A
 * floor is the only form of the rush that a fast maker cannot serve away.
 *
 * It is also what makes the batch lever cashable. Design §9 pays for one cut
 * that feeds two children and the whole point of a telegraphed rush is that "a
 * maker who sees one coming has a reason to build a ladder into it" — but a
 * ladder cannot be cashed into a window that only ever holds one child, so the
 * lever the rush exists to offer was one the rush never actually opened.
 */
export const RUSH_QUEUE_FLOOR = 2;

/**
 * And how many it insists on once the tide has grown to full size — the other
 * half of *longer and with more children*, and the half a rate cannot deliver.
 *
 * Three of the table's four places, which is as deep as the window goes: the
 * standing line is drawn for four (`ui/layout.ts` sizes its pitch at a quarter
 * of the board) and a fifth child walks off the frame, so a deeper queue than
 * this is a layout job before it is a balance one. Every row of `RAMP` carries
 * a `maxQueue` of at least three, so the floor still binds *under* the table
 * everywhere and can never admit past the row in force.
 *
 * What is worth knowing before this is raised again is what it costs at four.
 * At a floor of two the window sat above its floor 86–91% of a tide and still
 * reached the cap, so it was plainly a floor; at three of four there is one
 * place of headroom and it is much closer to a pin. That is the intent — a peak
 * a good maker cannot empty is what a rush is — but it is why the floor grows
 * into the run rather than starting here, and why the sweep's own assertion had
 * to stop asking whether the window gets *past* the floor and start asking
 * whether it still reaches the cap.
 */
export const RUSH_FULL_QUEUE_FLOOR = 3;

/**
 * Where the floor engages: the intensity at which the doorway has its first
 * figure fully drawn, which is the moment the telegraph stops being a hint and
 * starts being a crowd.
 *
 * Tying it to the door's own arithmetic rather than picking a number is what
 * keeps the promise and the delivery from drifting. A rush the player can see
 * coming and then cannot feel is the complaint this whole mechanism is answering
 * — so the frame where the doorway reads as occupied is the frame the window
 * starts holding a pair.
 */
export const RUSH_FLOOR_FROM = 1 / RUSH_CROWD;

/**
 * How many children the tide insists on having at the window — 0 through the
 * lull and the first flicker of a swell, a pair once the doorway reads as a
 * crowd, and three once the tide has grown to full size.
 *
 * Steps rather than ramps, because the quantity is children: there is no
 * fractional child to interpolate, and `maxQueue` is rounded for the same
 * reason. `Game.admitCustomer` is where it binds, and it binds *under*
 * `maxQueue` — the floor says how empty the window may get, never how full it
 * may be, so it can never admit past the row the table names.
 *
 * It takes the same (clock, score) pair `rushAt` does rather than the two
 * positions it actually reads, and that is deliberate: those two are the
 * *delivered* intensity and the *growth*, both functions of one ramp position,
 * so a signature taking them separately admits pairs the game cannot be in — a
 * full-strength crest at growth 0, for instance, which is a state no run
 * reaches. One argument pair, one walk up the ramp, and both terms read off the
 * same step.
 *
 * The two it reads are different questions and the difference is the mechanism.
 * The intensity is what ties the floor to the ease-in: a tide still winding in
 * has not reached `RUSH_FLOOR_FROM`, so an early half-strength swell holds no
 * window at all, and past that threshold the floor is the same at any intensity
 * — a step, not a ramp. The growth is what tells a full-size tide from a
 * preview: they both crest at 1, and only the growth says one of them is bigger.
 */
export const rushFloorAt = (endlessMs: number, endlessScore: number): number => {
  const pos = rampMs(endlessMs, endlessScore);
  if (arrivalTideAt(pos) < RUSH_FLOOR_FROM) return 0;

  return rushGrowth(pos) >= 1 ? RUSH_FULL_QUEUE_FLOOR : RUSH_QUEUE_FLOOR;
};

/**
 * What the tide is doing right now, in the two terms the HUD has to say out
 * loud (design §11).
 *
 * `rush` above is the tide's *strength*, which is the right number for a
 * doorway filling up and the wrong one for every question the chair actually
 * asked of it: **am I in a rush, when does this one end, and when is the next
 * one?** A scalar that rises and falls answers none of them, because a player
 * reading 0.4 off a crowd cannot tell a swell from an ebb — the same figure
 * means "brace" on the way up and "it is over" on the way down, and the shape
 * is the only thing that distinguishes them.
 *
 * So this is the shape, reported as a gauge that fills toward a rush and drains
 * through one. Between rushes `fill` climbs 0 → 1 and lands on the moment the
 * next one starts; during a rush it falls 1 → 0 and lands on the moment this
 * one ends. One bar, read the same way in both states, with `on` saying which
 * of the two readings is in force.
 */
export interface RushMeter {
  /**
   * Whether a rush is running — and it is the *delivered* rush, tied to
   * `rushFloorAt` binding rather than to a plateau in the shape table.
   *
   * That tie is the whole reason this is trustworthy. The rush the player is
   * told about has to be the rush the game is imposing, or the HUD is drawing a
   * second, decorative tide beside the real one; this file has already had to
   * close that exact drift once, between the doorway's crowd and the floor
   * under the window (`RUSH_FLOOR_FROM`). So "a rush is on" means the same
   * thing here as it means in `admitCustomer`: the window is being held open.
   */
  readonly on: boolean;
  /** The gauge, 0…1 — filling toward the next rush, or draining through this one. */
  readonly fill: number;
}

/** No tide worth drawing: before the preview mark, and on a pinned stage. */
export const RUSH_QUIET: RushMeter = { on: false, fill: 0 };

/**
 * Where the tide crosses the floor's threshold, and how far through that
 * crossing a run stands.
 *
 * The edges are solved rather than searched for, which they can be because the
 * shape is piecewise linear in phase: intensity climbs 0 → 1 across the swell
 * and falls 1 → 0 across the ebb, so the phase at which it passes a threshold
 * is one `lerp` on each side. Scanning the curve for the crossing would work
 * too and is what this looked like first; it is rejected because it puts a loop
 * on a getter the HUD reads every frame, and because a scan's answer depends on
 * its step size, which is a second tuning knob nobody would ever be told about.
 *
 * **The threshold is divided by the swing rather than compared against the
 * delivered figure**, and that is the one line here worth understanding. The
 * delivered intensity is `shape × swing`, so asking where `shape × swing`
 * crosses `RUSH_FLOOR_FROM` is asking where `shape` crosses
 * `RUSH_FLOOR_FROM / swing` — the same question moved to the side of the
 * equation the shape table is written on, where it is a straight interpolation.
 * While the tide is still easing in, that quotient can exceed 1: the shape's own
 * crest is not yet delivering enough to hold the window, and the honest reading
 * would be "no rush this cycle at all". It is clamped to 1 instead, which puts
 * `opens` at the crest and `shuts` at the end of the plateau — so in that regime
 * the gauge calls the **plateau itself** the rush: 12 s of it at the preview
 * shape, 20 s grown. Not an instant, and not a collapsed window; the two edges
 * stay well apart (0.65 → 0.85 at the preview, 0.52 → 0.85 grown), which is
 * also why nothing below can divide by zero.
 *
 * So the clamp degrades to "the rush is the part that was going to be flat out
 * anyway", which is the right shape to show a player who is being told about a
 * tide too weak to hold the window yet. It lasts about half a minute at the very
 * start of the tide's life, against the alternative of a gauge that sits dead
 * through the first swell the player is ever shown, and it corrects itself
 * continuously as the swing winds on rather than snapping when it reaches 1.
 */
const rushEdges = (
  rampPosMs: number,
  swing: number,
): { readonly opens: number; readonly shuts: number } => {
  const grown = rushGrowth(rampPosMs);
  const phaseOf = (point: (typeof RUSH_SHAPE)[number]): number =>
    lerp(point.at, point.grown, grown);
  const need = Math.min(RUSH_FLOOR_FROM / swing, 1);

  return {
    // Up the swell, from the end of the lull to the crest.
    opens: lerp(phaseOf(RUSH_SHAPE[1]!), phaseOf(RUSH_SHAPE[2]!), need),
    // And down the ebb, from the end of the peak to the end of the period.
    shuts: lerp(phaseOf(RUSH_SHAPE[3]!), 1, 1 - need),
  };
};

/**
 * The gauge, at a point on the ramp — `Game.rushMeter`'s way in, and the same
 * (clock, score) pair every other reader of this table takes.
 *
 * Like `rushAt` it does not clamp into the anchor table: the tide runs past the
 * backstop, and a gauge frozen at whatever phase fifteen minutes lands on would
 * leave the longest runs the only ones whose HUD had stopped telling the truth.
 */
export const rushMeterAt = (endlessMs: number, endlessScore: number): RushMeter => {
  const pos = rampMs(endlessMs, endlessScore);
  if (pos <= RUSH_FROM_MS) return RUSH_QUIET;

  const swing = rushSwing(pos);
  // Unreachable as the two lines stand — the guard above leaves `pos` strictly
  // past `RUSH_FROM_MS`, so `rushSwing`'s numerator is strictly positive — and
  // kept anyway, because `rushEdges` divides by this. It is the *guard above*
  // that makes that divide safe, which is a thing one line knowing about
  // another; this says so where the divide is, rather than leaving the next
  // person to change `rushSwing`'s clamp to find out.
  if (swing <= 0) return RUSH_QUIET;

  const phase = rushPhaseAt(pos);
  const { opens, shuts } = rushEdges(pos, swing);

  if (phase >= opens && phase <= shuts)
    return { on: true, fill: (shuts - phase) / (shuts - opens) };

  // Between rushes, measured from the one that just finished to the one coming.
  // Whichever side of the peak the phase falls, the span it is inside runs from
  // a `shuts` to an `opens`; the wrap is carried by moving one of the two into
  // the neighbouring period rather than by a second branch on the arithmetic.
  const from = phase < opens ? shuts - 1 : shuts;
  const to = phase < opens ? opens : opens + 1;

  return { on: false, fill: (phase - from) / (to - from) };
};
