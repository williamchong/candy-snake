import { describe, expect, it } from 'vitest';

import {
  RAMP,
  RUSH_FROM_MS,
  RUSH_PERIOD_MS,
  SETTLED_MS,
  arrivalRateAt,
  rampMs,
  rushAt,
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

  describe('serves and the clock, whichever fires first', () => {
    it('lets the clock carry a maker who serves nobody', () => {
      expect(rampMs(120_000, 0)).toBe(120_000);
    });

    it('lets serves carry a maker faster than the clock', () => {
      expect(rampMs(0, 40)).toBeGreaterThan(0);
      expect(rampMs(1_000, 40)).toBe(rampMs(0, 40));
    });

    it('takes whichever is further along, never the sum', () => {
      const both = rampMs(90_000, 5);
      expect(both).toBe(Math.max(90_000, rampMs(0, 5)));
    });
  });

  describe('the rush', () => {
    /** One period, sampled finely enough to catch the swell and the ebb. */
    const period = (from: number, samples = 240): number[] =>
      Array.from({ length: samples }, (_unused, step) =>
        rushAt(from + (RUSH_PERIOD_MS / samples) * step, 0),
      );

    it('leaves the window alone until the table runs out of new things', () => {
      // The whole case for it is that it goes *past* the last lever (design §7).
      // A tide before then would be one more number moving among four.
      for (let ms = 0; ms <= RUSH_FROM_MS; ms += 5_000) {
        expect(rushAt(ms, 0)).toBe(0);
        expect(arrivalRateAt(ms)).toBe(1);
      }
    });

    it('comes in over its own first period rather than switching on', () => {
      // Otherwise the run would step to an easier interval at the exact moment
      // the rush was added to stop it being flat.
      expect(arrivalRateAt(RUSH_FROM_MS)).toBe(1);

      const early = arrivalRateAt(RUSH_FROM_MS + RUSH_PERIOD_MS * 0.75);
      const settled = arrivalRateAt(RUSH_FROM_MS + RUSH_PERIOD_MS * 1.75);

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
      const lull = stageAt(RUSH_FROM_MS + RUSH_PERIOD_MS * 2, 0).arrivalIntervalMs;
      const peak = stageAt(RUSH_FROM_MS + RUSH_PERIOD_MS * 2.75, 0).arrivalIntervalMs;

      expect(peak).toBeLessThan(lull);
      // A peak against an unchanged baseline is simply more game; the trough
      // has to be shallower for it to be a peak at all (design §7).
      expect(lull).toBeGreaterThan(LAST.arrivalIntervalMs);
    });

    it('leans on the peak, because the window caps a peak and not a lull', () => {
      // The asymmetry is deliberate and it is the one thing a retune here has
      // to know. `admitCustomer` stops admitting at `maxQueue`, so surplus rate
      // at the peak is clipped the moment the window fills, while a longer lull
      // is recovery time paid to the maker in full. Balanced to cancel on paper
      // the rush made the game *easier* — median death 5.8 → 6.6 min.
      const lull = arrivalRateAt(RUSH_FROM_MS + RUSH_PERIOD_MS * 2);
      const peak = arrivalRateAt(RUSH_FROM_MS + RUSH_PERIOD_MS * 2.75);

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
