import { describe, expect, it } from 'vitest';

import {
  RAMP,
  SPEED_RUNGS,
  lerp,
  RUSH_FROM_MS,
  RUSH_PERIOD_MS,
  RUSH_QUEUE_FLOOR,
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

    it('leaves the window alone until the maker is up to speed', () => {
      // The opening minute is the speed ease-in (see `SETTLED_MS`), and a tide
      // laid over a strand still being brought up to pace would be two things
      // moving at once with no way to tell which one bit. Past that the tide
      // runs for the whole of the rest of the game — the ninth sitting's
      // report of staleness came at 400 points, which is inside ramp-minute
      // one, so a shape that waited for the three-minute mark was a shape most
      // runs barely met.
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
      // Half the cycle is lull, which is the half a ladder gets built in.
      expect(
        settled.filter((intensity) => intensity === 0).length,
      ).toBeGreaterThanOrEqual(settled.length / 2 - 1);
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

    it('holds the window at a pair once the doorway reads as a crowd', () => {
      // The half of the tide a fast maker cannot serve away. A rate is
      // outrunnable — `arrivalGapMs` asks 6.4-8.0 s for a second child through
      // the early ramp, against a bench round trip of two or three — so the
      // rush was invisible to exactly the makers it was built for. The floor is
      // the part that cannot be outrun.
      expect(rushFloorAt(0)).toBe(0);
      expect(rushFloorAt(RUSH_FLOOR_FROM)).toBe(RUSH_QUEUE_FLOOR);
      expect(rushFloorAt(1)).toBe(RUSH_QUEUE_FLOOR);
      // A lull insists on nothing: the half-cycle a ladder gets built in is
      // still the maker's own.
      expect(rushFloorAt(RUSH_FLOOR_FROM - 0.001)).toBe(0);
    });

    it('engages that floor inside the very first tide, not a cycle later', () => {
      // The margin this pins is thinner than it looks and nothing else guards
      // it. `rushSwing` is still winding in across the whole first pass, so the
      // first crest delivers **0.300** against a `RUSH_FLOOR_FROM` of 1/3: the
      // first tide crosses the threshold 1 s into the peak plateau rather than
      // at the crest. Nudge `RUSH_OPENS_AT`, `RUSH_SWING_PERIODS` or
      // `RUSH_CROWD` and a run's first held window slips a whole cycle — 60 s
      // of ramp — with every other assertion in this file still green.
      const firstTide = Array.from({ length: 300 }, (_unused, step) =>
        rushAt(RUSH_FROM_MS + step * 100, 0),
      );

      expect(Math.max(...firstTide)).toBeGreaterThanOrEqual(RUSH_FLOOR_FROM);
      expect(
        firstTide.some((intensity) => rushFloorAt(intensity) === RUSH_QUEUE_FLOOR),
      ).toBe(true);
    });

    it('puts the reported score inside a running tide', () => {
      // The report this pass answers arrived at 1063 points, which is ramp
      // position 74 410 ms. Under the old phase that was the dead middle of the
      // opening lull — intensity 0.00, one child at the window. It now sits on
      // the first peak plateau with the floor on.
      const reported = 74_410;

      expect(reported).toBeGreaterThan(RUSH_FROM_MS);
      expect(rushFloorAt(rushAt(reported, 0))).toBe(RUSH_QUEUE_FLOOR);
    });

    it('never asks the window for more than the table allows', () => {
      // The floor says how empty the window may get, never how full: every row
      // of the ramp has room for it, so it can never fight `maxQueue`.
      for (const anchor of RAMP) {
        expect(anchor.maxQueue).toBeGreaterThanOrEqual(RUSH_QUEUE_FLOOR);
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
