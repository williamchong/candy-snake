import { describe, expect, it } from 'vitest';

import { RAMP, SETTLED_MS, rampMs, stageAt } from './difficulty';
import { MIXING_STAGE } from './orders';

const FIRST = RAMP[0]!;
const LAST = RAMP[RAMP.length - 1]!;

/** Every knob, in the direction the ramp is supposed to move it (design §7). */
const HARDER = [
  {
    name: 'arrival interval',
    of: (ms: number) => stageAt(ms, 0).arrivalIntervalMs,
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

    expect(past.arrivalIntervalMs).toBe(LAST.arrivalIntervalMs);
    expect(past.patienceMs).toBe(LAST.patienceMs);
    expect(past.maxQueue).toBe(LAST.maxQueue);
  });

  it('reproduces every anchor exactly when it lands on one', () => {
    // Put the ramp position back on rather than stripping it off, so the
    // comparison is against the table row as written.
    for (const anchor of RAMP) {
      expect({ ...stageAt(anchor.atMs, 0), atMs: anchor.atMs }).toEqual(anchor);
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

  it('starts no harder than it ends', () => {
    expect(FIRST.arrivalIntervalMs).toBeGreaterThan(LAST.arrivalIntervalMs);
    expect(FIRST.patienceMs).toBeGreaterThan(LAST.patienceMs);
    expect(FIRST.maxQueue).toBeLessThan(LAST.maxQueue);
  });
});
