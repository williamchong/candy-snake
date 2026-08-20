import { describe, expect, it } from 'vitest';

import { PRIMARIES, RED } from '../core/colors';
import { RAW, type Customer, type GameEvent } from '../core/types';
import {
  AMBIENCE_RATE,
  ambience,
  CUES,
  CueKey,
  cueFor,
  repeat,
  peak,
  samples,
  semitones,
  swell,
} from './tones';

const RATE = 44100;

const CUE_KEYS = Object.values(CueKey);

const at = { x: 3, y: 4 };

const child = (id: number): Customer => ({ id, want: RAW, patience: undefined });

/** A serve of the given streak — the only field the cue reads. */
const served = (streak: number): GameEvent => ({
  type: 'customer-served',
  customer: child(streak),
  points: 10,
  streak,
  fromShelf: false,
});

/** The cue an event makes, or a failure that names itself. */
const cueOf = (event: GameEvent): { key: CueKey; rate: number } => {
  const cue = cueFor(event);
  if (cue === undefined) throw new Error(`${event.type} made no sound`);
  return cue;
};

describe('samples', () => {
  it.each(CUE_KEYS)('renders %s to a buffer with something in it', (key) => {
    expect(peak(samples(CUES[key], RATE))).toBeGreaterThan(0);
  });

  it.each(CUE_KEYS)('never clips %s', (key) => {
    // A cue at the edge is inaudibly wrong on its own and ugly the moment two
    // overlap — which is the case that is hardest to reproduce on purpose.
    expect(peak(samples(CUES[key], RATE))).toBeLessThanOrEqual(1);
  });

  it.each(CUE_KEYS)('starts and ends %s at silence', (key) => {
    // A buffer that begins or ends part-way up a waveform clicks. An ear finds
    // that instantly and a picture of the waveform does not show it at all.
    // Through `Math.abs`, because silence arrived at by multiplying a falling
    // waveform by a zero envelope is spelled `-0`, and it is just as silent.
    const data = samples(CUES[key], RATE);

    expect(Math.abs(data[0] ?? NaN)).toBe(0);
    expect(Math.abs(data[data.length - 1] ?? NaN)).toBe(0);
  });

  it.each(CUE_KEYS)('gives %s the length it asks for', (key) => {
    const spec = CUES[key];
    expect(samples(spec, RATE)).toHaveLength(Math.round((spec.durationMs / 1000) * RATE));
  });

  it('bakes the same buffer every time', () => {
    // The noise is seeded (`core/rng.ts`), so a cue that sounds wrong today
    // sounds wrong again tomorrow rather than being chased around
    // (architecture §2).
    expect([...samples(CUES[CueKey.Crack], RATE)]).toStrictEqual([
      ...samples(CUES[CueKey.Crack], RATE),
    ]);
  });

  it('renders at whatever rate the hardware is running at', () => {
    // The context's rate is the device's, not ours: 48 kHz is as common as 44.1.
    expect(samples(CUES[CueKey.Pop], 48000).length).toBeGreaterThan(
      samples(CUES[CueKey.Pop], RATE).length,
    );
  });
});

describe('cueFor', () => {
  it('gives every jar its own pitch', () => {
    // Three plinks a player can tell apart with their eyes on the strand.
    const pitches = PRIMARIES.map(
      (primary) => cueOf({ type: 'dye-opened', pos: at, primary }).rate,
    );

    expect(new Set(pitches).size).toBe(3);
  });

  it('speaks up for a dye that kneaded nothing, and not for one that landed', () => {
    // Design §5's wasted dye — the same test `GameScene.play` splashes on.
    const spent = { type: 'dye-spent', pos: at, primary: RED } as const;

    expect(cueFor({ ...spent, kneaded: 0 })?.key).toBe(CueKey.Waste);
    expect(cueFor({ ...spent, kneaded: 3 })).toBeUndefined();
  });

  it('climbs the serve chime with the streak', () => {
    const rising = [1, 2, 3, 4].map((streak) => cueOf(served(streak)).rate);

    expect(rising).toStrictEqual([...rising].sort((left, right) => left - right));
    expect(new Set(rising).size).toBe(rising.length);
  });

  it('stops climbing where the streak bonus stops growing', () => {
    // Design §9 caps the multiplier at ×2, reached at eight serves. A chime
    // that kept rising past it would promise a bonus that is not being paid.
    expect(cueOf(served(8)).rate).toBeCloseTo(cueOf(served(30)).rate);
  });

  it('keeps a long strand in hearing', () => {
    // Pull pitch wraps rather than climbing forever: the point is the sense of
    // gathering, not the number, and a hundred-long strand must not whistle.
    const rates = Array.from(
      { length: 40 },
      (_unused, length) =>
        cueOf({ type: 'sugar-pulled', pos: at, length: length + 1 }).rate,
    );

    expect(Math.max(...rates)).toBeLessThan(2);
  });

  it('stays silent for what the board already says', () => {
    // The same silences `GameScene.play` documents, plus the crumble: it fires
    // once per block of a severed strand and the crack has spoken for it.
    const silent: GameEvent[] = [
      { type: 'strand-cut', batch: [] },
      { type: 'dye-kneaded', pos: at, primary: RED, color: RED },
      { type: 'sugar-spawned', pos: at },
      { type: 'dye-spawned', pos: at, primary: RED },
      { type: 'debris-crumbled', segment: { pos: at, color: RAW } },
    ];

    for (const event of silent) expect(cueFor(event)).toBeUndefined();
  });
});

describe('repeat', () => {
  it('staggers a stack of stale candies the way the rack does', () => {
    // `ui/shelfStrip.ts` gives the eye 70 ms a candy, capped at three. The ear
    // gets the same, so the two never disagree about how many were lost.
    expect(
      [0, 1, 2, 3].map((waiting) => repeat(CueKey.Stale, waiting)?.delayMs),
    ).toStrictEqual([0, 70, 140, 210]);
  });

  it('counts a batch of candies out rather than smearing them', () => {
    const rates = [0, 1, 2].map((waiting) => repeat(CueKey.Pop, waiting)?.rate ?? 0);

    expect(rates[1]).toBeCloseTo(semitones(2));
    expect(rates[2]).toBeCloseTo(semitones(4));
  });

  it('drops a copy once the cue is full', () => {
    // Past a point more voices are not more information, they are mush — and
    // one chop can overflow a full rack several times inside a single tick.
    expect(repeat(CueKey.Stale, CUES[CueKey.Stale].repeat.voices)).toBeUndefined();
  });

  it.each(CUE_KEYS)('never stacks two copies of %s at the same instant', (key) => {
    // `GameScene` catches up as many as five ticks in one frame after a stall,
    // so even a once-a-run cue can be asked for twice with no time in between.
    expect(repeat(key, 1)?.delayMs).toBeGreaterThan(0);
  });
});

/** The biggest jump between one sample and the next, anywhere inside the loop. */
const widestStep = (data: Float32Array): number => {
  let widest = 0;
  for (let i = 1; i < data.length; i += 1) {
    widest = Math.max(widest, Math.abs((data[i] ?? 0) - (data[i - 1] ?? 0)));
  }
  return widest;
};

describe('ambience', () => {
  it('joins to itself no harder than it joins to itself anywhere else', () => {
    // The whole reason the bed needs no crossfade, and the one property that
    // cannot be heard until it has been wrong for a minute: the wrap has to be
    // an ordinary step, not a step at all out of the ordinary. A filter begun
    // from silence would fail this — its first samples would not match its
    // last — which is what the pre-roll in `lowPass` is for.
    const bed = ambience();
    const seam = Math.abs((bed[0] ?? 0) - (bed[bed.length - 1] ?? 0));

    expect(seam).toBeLessThan(widestStep(bed));
  });

  it('stays under the cues it plays beneath', () => {
    // A bed anybody notices is a bed in the way (design §12: *light*).
    const loudest = peak(ambience());

    expect(loudest).toBeGreaterThan(0);
    expect(loudest).toBeLessThan(peak(samples(CUES[CueKey.Pull], RATE)));
  });

  it('breathes a whole number of times, so the swell wraps with the noise', () => {
    // Where the envelope is at the end of the loop has to be where it is at the
    // start, or the bed steps in volume every four seconds however cleanly the
    // noise underneath it joins — a fault the seam test cannot see, because it
    // compares two samples and this is a difference between two averages.
    //
    // Asked of the envelope directly. Measuring it off the noise was tried and
    // is not sensitive enough: a window narrow enough to be local to the seam
    // is dominated by which sample happened to land loudest in it, and one wide
    // enough to be stable averages over most of a turn — which is exactly how a
    // half-turn hides.
    const bed = ambience();

    expect(swell(bed.length, bed.length)).toBeCloseTo(swell(0, bed.length), 10);
  });

  it('bakes the same bed every time', () => {
    expect([...ambience()]).toStrictEqual([...ambience()]);
  });

  it("is rendered at its own rate, well under the hardware's", () => {
    // There is nothing above a few hundred Hz in it, so the bandwidth the
    // device would give it is bandwidth spent on silence.
    expect(AMBIENCE_RATE).toBeLessThan(RATE);
    expect(ambience()).toHaveLength(AMBIENCE_RATE * 4);
  });
});
