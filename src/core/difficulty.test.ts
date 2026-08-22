import { describe, expect, it } from 'vitest';

import {
  RAMP,
  SPEED_RUNGS,
  lerp,
  RUSH_FROM_MS,
  RUSH_PERIOD_MS,
  RUSH_QUEUE_FLOOR,
  RUSH_FULL_QUEUE_FLOOR,
  RUSH_FULL_MS,
  RUSH_FLOOR_FROM,
  rushFloorAt,
  SETTLED_MS,
  arrivalRateAt,
  rampMs,
  rushAt,
  spanAt,
  speedRungOf,
  stageAt,
} from './difficulty';
import { MIXING_STAGE } from './orders';

const FIRST = RAMP[0]!;
const LAST = RAMP[RAMP.length - 1]!;

/** Every knob, in the direction the ramp is supposed to move it (design §7). */
const HARDER = [
  {
    name: 'arrival interval',
    // The delivered interval is the baseline divided by the tide, and a tide is
    // not monotonic — being one is the whole of what it adds. What the ramp
    // promises to keep tightening is the baseline under it, which is what
    // multiplying the rate back out recovers.
    of: (ms: number) => stageAt(ms, 0).arrivalIntervalMs * arrivalRateAt(ms),
    up: false,
  },
  { name: 'patience', of: (ms: number) => stageAt(ms, 0).patienceMs, up: false },
  { name: 'move interval', of: (ms: number) => stageAt(ms, 0).moveIntervalMs, up: false },
  { name: 'queue cap', of: (ms: number) => stageAt(ms, 0).maxQueue, up: true },
] as const;

describe('the difficulty curve', () => {
  it('hands over at exactly the row the opening levels leave off at', () => {
    expect(stageAt(0, 0)).toEqual(MIXING_STAGE);
  });

  it('holds the last row once the table runs out', () => {
    const past = stageAt(LAST.atMs * 4, 0);

    expect(past.arrivalIntervalMs * arrivalRateAt(LAST.atMs * 4)).toBeCloseTo(
      LAST.arrivalIntervalMs,
    );
    expect(past.patienceMs).toBe(LAST.patienceMs);
    expect(past.maxQueue).toBe(LAST.maxQueue);
  });

  it('reproduces every anchor exactly when it lands on one', () => {
    // Put the ramp position back on rather than stripping it off, so the
    // comparison is against the table row as written — and the tide with it,
    // since past the Rush row the row is a baseline the window swings around
    // rather than the interval it delivers.
    for (const anchor of RAMP) {
      const stage = stageAt(anchor.atMs, 0);

      // Every other knob as written, and the interval as the baseline the tide
      // is swinging around.
      expect({
        ...stage,
        arrivalIntervalMs: anchor.arrivalIntervalMs,
        atMs: anchor.atMs,
      }).toEqual(anchor);
      expect(stage.arrivalIntervalMs * arrivalRateAt(anchor.atMs)).toBeCloseTo(
        anchor.arrivalIntervalMs,
      );
    }
  });

  it.each(HARDER)('moves $name the way the ramp should', ({ of, up }) => {
    const samples = Array.from({ length: 40 }, (_unused, step) =>
      of((LAST.atMs / 39) * step),
    );

    samples.forEach((value, index) => {
      const previous = samples[index - 1];
      if (previous === undefined) return;
      if (up) expect(value).toBeGreaterThanOrEqual(previous);
      else expect(value).toBeLessThanOrEqual(previous);
    });
  });

  it('eases the maker up to the Mixing row rather than jumping', () => {
    // The handover is Warm-up's 5 cells/s and the settled row is Mixing's 7,
    // and the point of the anchor between them is that nothing steps (design §7).
    expect(stageAt(0, 0).moveIntervalMs).toBe(MIXING_STAGE.moveIntervalMs);
    expect(stageAt(SETTLED_MS, 0).moveIntervalMs).toBeLessThan(
      MIXING_STAGE.moveIntervalMs,
    );

    const half = stageAt(SETTLED_MS / 2, 0).moveIntervalMs;
    expect(half).toBeLessThan(MIXING_STAGE.moveIntervalMs);
    expect(half).toBeGreaterThan(stageAt(SETTLED_MS, 0).moveIntervalMs);
  });

  it('never lets the maker outrun the view between two cells', () => {
    // GameScene caps catch-up at 100 ms; a shorter move interval than that
    // would let one frame advance two grid moves and the strand would teleport.
    for (const anchor of RAMP) expect(anchor.moveIntervalMs).toBeGreaterThan(100);
  });

  describe('the speed ladder', () => {
    /** The ramp, sampled a tenth of a second at a time out to the backstop. */
    const WALK = Array.from({ length: 9_000 }, (_, tick) => tick * 100);

    it('only ever hands out a speed that is on the ladder', () => {
      // The point of stepping the column is that there is a countable set of
      // speeds. A value between two rungs would be a gear the player was never
      // told about, which is the whole failure this replaced.
      //
      // Collected and asserted once rather than asserted per sample: 9 000
      // `expect` calls cost 69 ms where the 9 000 `stageAt` calls behind them
      // cost 1, and the failure names every offending sample instead of only
      // the first.
      const between = WALK.filter(
        (ms) => !SPEED_RUNGS.includes(stageAt(ms, 0).moveIntervalMs),
      );

      expect(between).toEqual([]);
    });

    it('steps far enough each time to be felt', () => {
      // Speed discrimination sits around 5%. A ladder whose rungs fell under
      // that would be the smooth curve again, wearing steps — so this is the
      // assertion the change exists to make, and the one to look at first if
      // anyone ever adds a rung.
      for (let rung = 1; rung < SPEED_RUNGS.length; rung += 1) {
        const step = SPEED_RUNGS[rung - 1]! / SPEED_RUNGS[rung]! - 1;
        expect(step, `rung ${rung} steps ${(step * 100).toFixed(2)}%`).toBeGreaterThan(
          0.05,
        );
      }
    });

    it('never drops a gear', () => {
      // What lets `Game` announce a rung by remembering the last one. If this
      // fails, the announcement needs hysteresis and the cue starts flapping.
      const drops: number[] = [];
      let last = -1;
      for (const ms of WALK) {
        const rung = speedRungOf(stageAt(ms, 0).moveIntervalMs);
        if (rung < last) drops.push(ms);
        last = rung;
      }

      expect(drops).toEqual([]);
    });

    it('starts at the handover speed and ends at the cap', () => {
      expect(SPEED_RUNGS[0]).toBe(FIRST.moveIntervalMs);
      expect(SPEED_RUNGS[SPEED_RUNGS.length - 1]).toBe(LAST.moveIntervalMs);
    });

    it('puts a rung on the Settled anchor rather than beside it', () => {
      // Not decoration: the ladder is geometric and the anchor table's own two
      // spans are 2.49 : 1 in log terms, so five rungs against two lands on it.
      // A retune that breaks this has changed the shape of the ramp, not just
      // the size of its steps.
      expect(SPEED_RUNGS).toContain(RAMP[1]!.moveIntervalMs);
    });

    it('snaps to the nearest rung, so the curve underneath is left where it was', () => {
      // The reason this is balance-neutral rather than a difficulty change: the
      // deviation is centred, not one-sided. Snapping *down* would pass this
      // file's monotonicity tests and quietly make the whole ramp slower.
      //
      // Through the module's own `spanAt` and `lerp` rather than a transcription
      // of them: the only difference between the two sides of this comparison
      // has to be the snap. A hand-copied bracketing rule would go on measuring
      // against a curve the module had stopped drawing, and pass while doing it.
      let snapped = 0;
      let continuous = 0;
      for (const ms of WALK) {
        const at = Math.min(Math.max(ms, FIRST.atMs), LAST.atMs);
        const { from, to, t } = spanAt(RAMP, (anchor) => anchor.atMs, at);

        snapped += stageAt(ms, 0).moveIntervalMs;
        continuous += lerp(from.moveIntervalMs, to.moveIntervalMs, t);
      }

      const drift = snapped / continuous - 1;
      expect(
        Math.abs(drift),
        `mean speed drifted ${(drift * 100).toFixed(3)}%`,
      ).toBeLessThan(0.005);
    });

    it('reads a rung off any interval between the rungs either side of it', () => {
      SPEED_RUNGS.forEach((interval, rung) => {
        expect(speedRungOf(interval)).toBe(rung);
        expect(speedRungOf(interval + 0.5)).toBe(rung);
        expect(speedRungOf(interval - 0.5)).toBe(rung);
      });

      // And the handover is at the midpoint, which is what makes the snap the
      // nearest rung rather than the last one passed — the ±0.5 ms above sits
      // nowhere near it, since the gaps run 9 to 13 ms.
      SPEED_RUNGS.slice(0, -1).forEach((interval, rung) => {
        const midpoint = (interval + SPEED_RUNGS[rung + 1]!) / 2;

        expect(speedRungOf(midpoint + 0.01)).toBe(rung);
        expect(speedRungOf(midpoint - 0.01)).toBe(rung + 1);
      });

      // Off the ends it clamps rather than running off the table.
      expect(speedRungOf(1_000)).toBe(0);
      expect(speedRungOf(1)).toBe(SPEED_RUNGS.length - 1);
    });
  });

  describe('the score and the clock, whichever is further along', () => {
    it('lets the clock carry a maker who scores nothing', () => {
      // The floor, and the reason the clock is kept at all: a maker who serves
      // just enough to hold their lives must not be able to park the curve.
      expect(rampMs(120_000, 0)).toBe(120_000);
    });

    it('lets a score carry a maker faster than the clock', () => {
      // Two thousand points a minute into a run is well ahead of the clock, and
      // the curve has to be where the score puts it rather than where the
      // stopwatch does — that is the whole of what keying on score means.
      expect(rampMs(60_000, 2_000)).toBeGreaterThan(60_000);
      expect(rampMs(1_000, 2_000)).toBe(rampMs(0, 2_000));
    });

    it('takes whichever is further along, never the sum', () => {
      const both = rampMs(90_000, 500);
      expect(both).toBe(Math.max(90_000, rampMs(0, 500)));
    });

    it('pays a hard serve more ramp than an easy one', () => {
      // The consequence of keying on score rather than counting serves, pinned
      // because it is the thing a retune has to decide it still wants:
      // `scoreServe` weights by tier, by patience and by streak, so the curve
      // now moves by how well a serve went and not merely by that it happened.
      const easy = rampMs(0, 10); // a raw handed over late, no streak
      const hard = rampMs(0, 150); // a secondary served promptly, streak capped

      expect(hard).toBeGreaterThan(easy * 10);
    });
  });

  describe('the rush', () => {
    /** One period, sampled finely enough to catch the swell and the ebb. */
    const period = (from: number, samples = 240): number[] =>
      Array.from({ length: samples }, (_unused, step) =>
        rushAt(from + (RUSH_PERIOD_MS / samples) * step, 0),
      );

    /** How many seconds of one period are spent where `keep` holds. */
    const seconds = (from: number, keep: (intensity: number) => boolean): number =>
      (period(from, 600).filter(keep).length * (RUSH_PERIOD_MS / 600)) / 1_000;

    it('leaves the window alone until the preview mark', () => {
      // Forty seconds of ramp — score 571 — and then the tide runs for the whole
      // of the rest of the game. The mark used to be `SETTLED_MS`, where the
      // speed ease-in finishes, on the reasoning that a tide laid over a strand
      // still being brought up to pace is two things moving at once with no way
      // to tell which one bit. It came down because the staleness reports keep
      // arriving inside the stretch the tide was still waiting out — 400 points
      // at the ninth sitting, 1063 at the tide pass — and the last third of the
      // ease-in is a cheaper thing to muddy than the first minute of the game is
      // to leave flat (`RUSH_FROM_MS`).
      for (let ms = 0; ms <= RUSH_FROM_MS; ms += 5_000) {
        expect(rushAt(ms, 0)).toBe(0);
        expect(arrivalRateAt(ms)).toBe(1);
      }
    });

    it('opens on a swell rather than on a lull', () => {
      // The whole of `RUSH_OPENS_AT`. A run used to join the cycle at phase 0
      // and meet thirty seconds of nothing, so the first swell was the second
      // half of the first period — 39 s past the anchor, which at 70 ms a point
      // is score 860 → 1414 spent being told the rush had started and shown
      // nothing. It now joins at the swell's foot and climbs from there.
      expect(arrivalRateAt(RUSH_FROM_MS)).toBe(1);

      // Nine seconds in — a fifth of the way to where the old shape's first
      // swell even began — the tide is already biting.
      expect(rushAt(RUSH_FROM_MS + RUSH_PERIOD_MS * 0.15, 0)).toBeGreaterThan(0.25);
      // And the flat stretch it replaced is gone: nothing in the opening
      // half-period reads as the dead lull the report was about.
      const opening = period(RUSH_FROM_MS, 60).slice(0, 30);
      expect(Math.max(...opening)).toBeGreaterThan(0.5);
    });

    it('comes in over half a period rather than switching on', () => {
      // Otherwise the run would step to an easier interval at the exact moment
      // the rush was added to stop it being flat. Half rather than the whole
      // period it used to be: opening on a swell (above) means the shape itself
      // starts at 0 and climbs, so the ease-in no longer has to stand in for a
      // smooth start — and left at a full period the two compounded, delivering
      // 0.15 of a tide to a player who had just been shown a doorway.
      expect(arrivalRateAt(RUSH_FROM_MS)).toBe(1);

      const early = arrivalRateAt(RUSH_FROM_MS + RUSH_PERIOD_MS * 0.25);
      const settled = arrivalRateAt(RUSH_FROM_MS + RUSH_PERIOD_MS * 1.25);

      // Same phase of the tide, one period apart: the later one swings harder.
      expect(early).toBeGreaterThan(1);
      expect(settled).toBeGreaterThan(early);
    });

    it('runs a full tide — a lull, a peak, and a way back', () => {
      const settled = period(RUSH_FROM_MS + RUSH_PERIOD_MS);

      expect(Math.min(...settled)).toBe(0);
      expect(Math.max(...settled)).toBe(1);
      // A third of the cycle is lull at the very least, which is what a ladder
      // gets built in. It used to be asserted at a half, and that was the
      // preview column read as though it were the whole table: the grown column
      // spends 22 s of the 60 in the lull rather than 30, having sold the other
      // eight to the peak. The floor under it is the ladder and it is pinned in
      // seconds by `lengthens the peak as the tide grows` — this end only has to
      // know that a lull is still most of the way to half the cycle wherever it
      // is read.
      expect(
        settled.filter((intensity) => intensity === 0).length,
      ).toBeGreaterThanOrEqual(settled.length / 3);
    });

    it('keeps the tide running past the backstop', () => {
      // `stageAt` clamps into the anchor table and the tide must not be clamped
      // with it, or the longest runs are the only ones that never see a rush.
      const past = period(LAST.atMs + RUSH_PERIOD_MS * 7);

      expect(Math.max(...past)).toBe(1);
      expect(Math.min(...past)).toBe(0);
    });

    it('fills the window faster at the peak and slower in the lull', () => {
      // The peak is sampled *earlier* on the ramp than the lull, which is the
      // harder way round to assert this and so the honest one: the baseline
      // interval shrinks as the ramp climbs, so the lull here starts from the
      // tighter number and the tide still has to overturn it. Sampled the other
      // way about, the ramp alone would carry the assertion and the tide could
      // stop working without this noticing (`RUSH_OPENS_AT` moved which of
      // these two phases is which, and it did exactly that for one run).
      const peak = stageAt(RUSH_FROM_MS + RUSH_PERIOD_MS * 2.25, 0).arrivalIntervalMs;
      const lull = stageAt(RUSH_FROM_MS + RUSH_PERIOD_MS * 2.75, 0).arrivalIntervalMs;

      expect(peak).toBeLessThan(lull);
      // A peak against an unchanged baseline is simply more game; the trough
      // has to be shallower for it to be a peak at all (design §7).
      expect(lull).toBeGreaterThan(LAST.arrivalIntervalMs);
    });

    /** Every floor the window is held at across one period, in order met. */
    const floorsOver = (from: number): number[] => [
      ...new Set(
        Array.from({ length: 600 }, (_unused, step) =>
          rushFloorAt(from + (RUSH_PERIOD_MS / 600) * step, 0),
        ),
      ),
    ];

    it('holds the window at a pair once the doorway reads as a crowd', () => {
      // The half of the tide a fast maker cannot serve away. A rate is
      // outrunnable — `arrivalGapMs` asks 6.4-8.0 s for a second child through
      // the early ramp, against a bench round trip of two or three — so the
      // rush was invisible to exactly the makers it was built for. The floor is
      // the part that cannot be outrun.
      //
      // Read over whole cycles rather than off intensities, because the floor
      // takes the ramp position now: intensity and growth are both functions of
      // it, and a test that fed them separately could assert a state no run
      // reaches (a full-strength crest at growth 0 is not a thing that happens).
      expect(floorsOver(RUSH_FROM_MS + RUSH_PERIOD_MS).sort()).toEqual([
        0,
        RUSH_QUEUE_FLOOR,
      ]);
      // A lull insists on nothing, and on more than a token stretch of the
      // cycle: the time a ladder gets built in is still the maker's own, at
      // either size of tide. (That a floor of 0 occurs at all is already in the
      // set above; this is how much of the cycle it holds for.)
      const unheld = (from: number): number => seconds(from, (i) => i < RUSH_FLOOR_FROM);

      expect(unheld(RUSH_FROM_MS + RUSH_PERIOD_MS)).toBeGreaterThan(20);
      expect(unheld(LAST.atMs + RUSH_PERIOD_MS * 3)).toBeGreaterThan(20);
    });

    it('holds it at three once the tide has grown, and not before', () => {
      // The other half of *longer and with more children*. Growth and intensity
      // are different questions and the floor is the one place both are asked:
      // a preview tide crests at 1 exactly like a full one, so intensity alone
      // cannot tell them apart, and a floor keyed on it would have put three
      // children at the window in the run's first minute.
      expect(floorsOver(LAST.atMs + RUSH_PERIOD_MS * 3).sort()).toEqual([
        0,
        RUSH_FULL_QUEUE_FLOOR,
      ]);
      // Not before: through the preview and the whole of the growth the window
      // is held at a pair, and the third child arrives with the Rush row rather
      // than partway up to it.
      expect(rushFloorAt(RUSH_FULL_MS - 1, 0)).toBeLessThan(RUSH_FULL_QUEUE_FLOOR);
      expect(rushFloorAt(RUSH_FULL_MS + RUSH_PERIOD_MS * 0.8, 0)).toBe(
        RUSH_FULL_QUEUE_FLOOR,
      );
    });

    it('lengthens the peak as the tide grows, and takes it out of the lull', () => {
      // The period is fixed, so a longer peak is a shorter lull and there is
      // nowhere else for the seconds to come from. What this pins is that the
      // trade lands where the table says: 12 s of plateau against 20 s, and a
      // lull that pays for it without going under what a ladder costs.
      const grown = LAST.atMs + RUSH_PERIOD_MS * 3;
      const peak = (from: number): number => seconds(from, (i) => i === 1);

      // A cycle read past the Rush row, where the tide is full.
      expect(peak(grown)).toBeGreaterThan(19);
      expect(peak(grown)).toBeLessThan(21);
      // One read while it is still growing is strictly shorter — and strictly
      // longer than the preview's twelve, which is what "grows" has to mean.
      const growing = peak(RUSH_FROM_MS + RUSH_PERIOD_MS);
      expect(growing).toBeLessThan(peak(grown));
      expect(growing).toBeGreaterThan(12);

      // The lull is the constraint, not a leftover: 22 s against the 8.6 s a
      // six-rung ladder takes at the Rush row's 125 ms still leaves room for
      // two, which is the claim the 30 s column makes and the reason the peak
      // did not simply take the whole of it.
      expect(seconds(grown, (i) => i === 0)).toBeGreaterThan(2 * 8.6);
    });

    it('asks the window for more over a cycle as it grows', () => {
      // The non-stochastic half of "the rush got bigger", and the one worth
      // reaching for first: a longer peak against a shorter lull is more demand
      // per cycle by construction, with no seeds in it and nothing to re-roll.
      // Measured over one period at 10 ms, the mean arrival rate goes **1.5275
      // at the preview shape → 1.7475 grown**, 14% more demand a minute.
      //
      // What the sweep then has to say separately — and does, in the plan's
      // preview-tide sitting — is that a maker with stock in hand serves much of
      // that surplus off the rack, so 14% more arrivals is not 14% harder.
      const meanRate = (from: number): number => {
        const samples = 600;
        let total = 0;
        for (let step = 0; step < samples; step += 1) {
          total += arrivalRateAt(from + (RUSH_PERIOD_MS / samples) * step);
        }

        return total / samples;
      };
      const grown = meanRate(LAST.atMs + RUSH_PERIOD_MS * 3);

      expect(grown).toBeGreaterThan(1.7);
      expect(grown).toBeLessThan(1.8);
      // And strictly more than the same cycle read while it is still growing,
      // which is what makes it a growth rather than a step at one anchor.
      expect(grown).toBeGreaterThan(meanRate(RUSH_FROM_MS + RUSH_PERIOD_MS));
    });

    it('keeps the swell nine seconds long however big the tide gets', () => {
      // The warning is sized against a whole ladder built from nothing, so a
      // rush that grew its peak by starting it sooner would be an ambush rather
      // than a bigger rush. Both columns of `RUSH_SHAPE` hold it at nine.
      //
      // The **rise** is measured on its own rather than every frame between 0
      // and 1, and the difference matters: swell and ebb together are 18 s in
      // both columns, so a shape that cut the warning to 6 s and let the ebb run
      // 12 would pass a test that only counted the pair. That is precisely the
      // ambush this exists to forbid. Sampled from the foot of a lull, the cycle
      // runs lull → swell → peak, so the rise is the gap between the last
      // unstarted frame and the first full-strength one.
      const rise = (fromLullFoot: number): number => {
        const cycle = period(fromLullFoot, 600);
        const crest = cycle.findIndex((intensity) => intensity === 1);
        const foot = cycle.lastIndexOf(0, crest);

        return ((crest - foot) * (RUSH_PERIOD_MS / 600)) / 1_000;
      };
      // Phase 0 of a cycle is half a period past the entry point, which is where
      // `RUSH_OPENS_AT` puts a run — so a lull foot is at the half-period marks.
      const grown = rise(LAST.atMs + RUSH_PERIOD_MS * 3.5);

      expect(grown).toBeGreaterThan(8.5);
      expect(grown).toBeLessThan(9.5);
      // And the same at a cycle read while the tide is still growing, within a
      // sample: its anchors are sliding under it as it runs.
      expect(
        Math.abs(grown - rise(RUSH_FROM_MS + RUSH_PERIOD_MS * 2.5)),
      ).toBeLessThanOrEqual(0.5);
    });

    it('engages that floor inside the very first tide, not a cycle later', () => {
      // The margin this pins is thinner than it looks and nothing else guards
      // it. `rushSwing` is still winding in across the whole first pass, so the
      // shape's first crest delivers **0.284** against a `RUSH_FLOOR_FROM` of
      // 1/3: the first tide crosses the threshold 1.5 s into the peak plateau
      // rather than at the crest. Nudge `RUSH_OPENS_AT`, `RUSH_SWING_PERIODS`,
      // `RUSH_CROWD` or either column of `RUSH_SHAPE` and a run's first held
      // window slips a whole cycle — 60 s of ramp — with every other assertion
      // in this file still green.
      const firstTide = Array.from({ length: 300 }, (_unused, step) =>
        rushAt(RUSH_FROM_MS + step * 100, 0),
      );
      const firstFloors = Array.from({ length: 300 }, (_unused, step) =>
        rushFloorAt(RUSH_FROM_MS + step * 100, 0),
      );

      expect(Math.max(...firstTide)).toBeGreaterThanOrEqual(RUSH_FLOOR_FROM);
      expect(firstFloors.some((floor) => floor === RUSH_QUEUE_FLOOR)).toBe(true);
    });

    it('puts a whole tide behind the reported score, not ahead of it', () => {
      // The report this pass answers arrived at 1063 points, which is ramp
      // position 74 410 ms. The tide pass pinned that this *instant* was a peak;
      // moving the start to the preview shifts every phase by a third of a
      // period and it is a lull again. That is not the regression it reads as,
      // and the reason is worth keeping: a third of every cycle is lull at the
      // very least, so no fixed score can be promised a peak, and a test that
      // demands one pins the phase rather than the mechanism.
      //
      // What the report was about is a chair that had never seen two children at
      // once, so that is what is asserted instead — by the reported score the run
      // has already been *through* a held window and out the other side.
      const reported = 74_410;
      const step = 100;
      const floors = Array.from(
        { length: Math.ceil((reported - RUSH_FROM_MS) / step) },
        (_unused, at) => rushFloorAt(RUSH_FROM_MS + at * step, 0),
      );
      const firstHeld = floors.findIndex((floor) => floor > 0) * step;
      const held = floors.filter((floor) => floor > 0).length * step;

      // The first held frame lands at ramp 50 s — score 714 against the 1063
      // that was reported, so the window was held a whole cycle before it.
      expect(RUSH_FROM_MS + firstHeld).toBe(50_000);
      expect(reported - (RUSH_FROM_MS + firstHeld)).toBeGreaterThan(RUSH_PERIOD_MS / 3);
      // And a whole peak plateau's worth of it, rather than a moment at a crest.
      expect(held).toBeGreaterThan(10_000);
    });

    it('never asks the window for more than the table allows', () => {
      // The floor says how empty the window may get, never how full: every row
      // of the ramp has room for it, so it can never fight `maxQueue`. Asserted
      // against the *grown* floor, which is the binding one — three of the
      // table's four places at the Rush row, and three of three back at the
      // handover, so it binds under the table everywhere on the curve.
      for (const anchor of RAMP) {
        expect(anchor.maxQueue).toBeGreaterThanOrEqual(RUSH_FULL_QUEUE_FLOOR);
      }
    });

    it('leans on the peak, because the window caps a peak and not a lull', () => {
      // The asymmetry is deliberate and it is the one thing a retune here has
      // to know. `admitCustomer` stops admitting at `maxQueue`, so surplus rate
      // at the peak is clipped the moment the window fills, while a longer lull
      // is recovery time paid to the maker in full. Balanced to cancel on paper
      // the rush made the game *easier* — median death 5.8 → 6.6 min.
      const lull = arrivalRateAt(RUSH_FROM_MS + RUSH_PERIOD_MS * 2.75);
      const peak = arrivalRateAt(RUSH_FROM_MS + RUSH_PERIOD_MS * 2.25);

      // Both directions still have to be real, or it is not a tide.
      expect(lull).toBeLessThan(1);
      expect(peak).toBeGreaterThan(2);
      expect(1 - lull).toBeLessThan(peak - 1);
    });
  });

  it('starts no harder than it ends', () => {
    expect(FIRST.arrivalIntervalMs).toBeGreaterThan(LAST.arrivalIntervalMs);
    expect(FIRST.patienceMs).toBeGreaterThan(LAST.patienceMs);
    expect(FIRST.maxQueue).toBeLessThan(LAST.maxQueue);
  });
});
