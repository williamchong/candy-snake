import { PRIMARIES } from '../core/colors';
import { createRng } from '../core/rng';
import type { GameEvent } from '../core/types';

/**
 * Every sound the game makes, and which event makes it (design §12).
 *
 * Nothing here is loaded: a cue is a handful of numbers, and `audio/kitchen.ts`
 * bakes those numbers into a buffer at boot the same way `render/textures.ts`
 * bakes an ASCII pixel map into a texture. There are no audio assets in v1 for
 * the same reason there are no image assets — a sound described in code is a
 * sound that can be re-tuned in a diff, and one that costs the player nothing
 * to download.
 *
 * This file is the whole of the decision-making: what a cue sounds like, which
 * event fires it, how it is pitched, and what happens when several land in the
 * same tick. `kitchen.ts` beside it only calls `createBuffer` and `play`. That
 * is the split `render/burst.ts` and `render/effects.ts` already use, and it is
 * what lets the interesting half run under Node (architecture §2, §11).
 */

export const CueKey = {
  /** A sugar cube pulled into the strand. */
  Pull: 'cue-pull',
  /** The head opening a dye jar — one pitch per primary. */
  Plink: 'cue-plink',
  /** A jar that coloured nothing (design §5's wasted dye). */
  Waste: 'cue-waste',
  /** One candy off the block. */
  Pop: 'cue-pop',
  /** A candy pushed off the end of a full rack. */
  Stale: 'cue-stale',
  /** The strand breaking on itself. */
  Crack: 'cue-crack',
  /** The life that break cost, under the crack. */
  Life: 'cue-life',
  /** A child arriving at the window. */
  Arrive: 'cue-arrive',
  /** A child served — pitched by the streak it stands on. */
  Serve: 'cue-serve',
  /** A child who ran out of patience: design §12's muffled trombone. */
  Walkout: 'cue-walkout',
  /** The run ending. */
  Over: 'cue-over',
} as const;
export type CueKey = (typeof CueKey)[keyof typeof CueKey];

/**
 * How a cue behaves when it is asked for again while it is still sounding.
 *
 * Phase 7 learned this on the stale-candy toss: `candy-staled` fires once per
 * candy pushed off, and one chop can overflow a full rack several times inside
 * a single tick. Played straight they superimpose and eight losses read as one.
 * The rack staggers its tosses by how many are already in the air, capped
 * (`ui/shelfStrip.ts`) — and audio needs it more than the rack did, because
 * eight copies of one waveform starting together is not eight sounds, it is one
 * sound eight times as loud.
 */
export interface RepeatSpec {
  /** How far apart successive copies start. */
  readonly stepMs: number;
  /** Past this many, copies double up rather than the queue draining slower. */
  readonly maxSteps: number;
  /**
   * Semitones added per copy. Non-zero turns a stack into a run: several
   * candies off one chop become an arpeggio instead of a thud.
   */
  readonly semitones: number;
  /** Beyond this many at once the cue is dropped. Past it, it is mush anyway. */
  readonly voices: number;
}

export interface CueSpec {
  readonly durationMs: number;
  /** Where the voice starts, in Hz. */
  readonly hz: number;
  /**
   * Where it ends up, as a multiple of `hz`. Above 1 rises, below 1 falls, and
   * the sweep is exponential so it reads as a musical interval rather than as a
   * siren.
   */
  readonly bend: number;
  /** Amplitude of the fundamental and each partial above it. */
  readonly partials: readonly number[];
  /**
   * Where each partial sits, as a multiple of `hz`, index-aligned with
   * `partials`. Left out they fall on the **harmonic** series — one whole
   * number apiece, which is the physics of a string or a tube and so of
   * everything that can be plucked, blown or bowed.
   *
   * Brittle things *struck* — glass, ceramic, a slab of hard sugar — ring at
   * ratios that are not whole numbers at all, and that inharmonicity is the
   * whole of what the ear uses to tell "shattered" from "plucked". No tuning of
   * the numbers above reaches it, which is the reason this field exists: the
   * candy cues were unreachable from the table alone.
   */
  readonly ratios?: readonly number[];
  /** How much of the voice is noise rather than tone, 0..1. */
  readonly noise: number;
  /**
   * The corners, in Hz, the cue's noise is kept between. Left out it stays
   * white — flat, and so neither bright nor dull.
   *
   * It is the noise rather than the tone that decides what an impact is made
   * of, because it is the noise that carries the impact: a sugar crack lives at
   * the top of the range and a wet slap at the bottom, on otherwise similar
   * numbers.
   */
  readonly band?: readonly [number, number];
  /** Time to full volume, as a fraction of the duration. */
  readonly attack: number;
  /** Peak amplitude — how loud this cue sits against the others. */
  readonly gain: number;
  readonly repeat: RepeatSpec;
}

const SEMITONE = 2 ** (1 / 12);

/** Semitones as a playback-rate multiplier, which is how a cue is re-pitched. */
export const semitones = (steps: number): number => SEMITONE ** steps;

/**
 * What a cue does when it lands on top of itself. Most cues cannot: a run is
 * over once, a child arrives one at a time. They take this so that a stall —
 * `GameScene` catches up as many as five ticks in one frame — still cannot
 * stack two copies exactly.
 */
const ONE_SHOT: RepeatSpec = { stepMs: 40, maxSteps: 2, semitones: 0, voices: 4 };

/**
 * The eleven voices. Values are in the units they are heard in — milliseconds
 * and Hz — so a cue that is too long or too shrill is fixed where it is read.
 */
export const CUES: Record<CueKey, CueSpec> = {
  // Short and soft: this is the most frequent sound in the game by a wide
  // margin, and anything with a tail would smear into the next pull. Sugar
  // being drawn is the one candy sound here that is not a strike, so it keeps
  // the harmonic series and takes the slowest attack in the table — a stretch
  // rather than a knock.
  [CueKey.Pull]: {
    durationMs: 95,
    hz: 500,
    bend: 1.16,
    partials: [1, 0.22],
    noise: 0.12,
    band: [400, 2600],
    attack: 0.08,
    gain: 0.3,
    repeat: ONE_SHOT,
  },
  // A glass jar tapped: partials near the 1 : 2.8 : 5.4 a struck tumbler rings
  // at, over a hiss of a strike banded up where the tap is and nowhere else.
  [CueKey.Plink]: {
    durationMs: 140,
    hz: 880,
    bend: 1,
    partials: [1, 0.45, 0.2],
    ratios: [1, 2.8, 5.4],
    noise: 0.08,
    band: [2500, 9000],
    attack: 0.004,
    gain: 0.34,
    repeat: ONE_SHOT,
  },
  // Low, dull and falling — the one dye sound that is not a bell, because it is
  // the one that reports a mistake. Dye going nowhere is a wet slap: mostly
  // noise, banded low so there is no ring on it at all.
  [CueKey.Waste]: {
    durationMs: 150,
    hz: 145,
    bend: 0.68,
    partials: [0.5, 0.1],
    noise: 0.6,
    band: [90, 800],
    attack: 0.01,
    gain: 0.38,
    repeat: ONE_SHOT,
  },
  // One chop cuts a whole batch, so this is the cue that stacks hardest. It
  // climbs a whole tone per candy: the batch is *counted* rather than smeared.
  // Shorter and drier than it was — a snip and a tick of hard sugar landing,
  // where a rising blip was a synthesiser doing an impression of one.
  [CueKey.Pop]: {
    durationMs: 70,
    hz: 700,
    bend: 1.15,
    partials: [0.6, 0.2],
    ratios: [1, 3.2],
    noise: 0.5,
    band: [900, 6000],
    attack: 0.002,
    gain: 0.36,
    repeat: { stepMs: 45, maxSteps: 5, semitones: 2, voices: 6 },
  },
  // A candy going over the end of the rack and clattering into whatever is
  // under it: the same falling shape as before, with the ring taken off it.
  [CueKey.Stale]: {
    durationMs: 150,
    hz: 280,
    bend: 0.6,
    partials: [0.6, 0.25],
    ratios: [1, 2.4],
    noise: 0.5,
    band: [220, 1600],
    attack: 0.015,
    gain: 0.3,
    // The rack's own numbers (`ui/shelfStrip.ts`): what the eye was given for
    // this exact event, so the ear is given the same and the two stay in step.
    repeat: { stepMs: 70, maxSteps: 3, semitones: -1, voices: 4 },
  },
  // Hard sugar shattering, and the cue this whole pass was asked for. Noise
  // banded where a fracture actually lives, over partials at the
  // 1 : 2.76 : 5.4 : 8.9 of a struck brittle plate. It was a 200 Hz thud, which
  // is a heavy thing breaking; this is a thin thing breaking, and the whole
  // difference between them is up here rather than in the loudness.
  //
  // The partials are written small on purpose, here and on the three cues above
  // that are also impacts. `samples` divides by the sum of everything mixed in,
  // so shrinking them is how the **noise** is made the thing that carries the
  // sound — which is what a fracture is. Left at the amplitudes a bell wants,
  // the noise sits at under a third of the voice and the crack pings.
  [CueKey.Crack]: {
    durationMs: 130,
    hz: 1100,
    bend: 0.95,
    partials: [0.5, 0.3, 0.2, 0.12],
    ratios: [1, 2.76, 5.4, 8.9],
    noise: 0.9,
    band: [1600, 9000],
    attack: 0.002,
    gain: 0.5,
    repeat: ONE_SHOT,
  },
  // Longer than the crack and quieter, so it is heard *under* it rather than
  // as a second impact: one thing happened, and it cost something. Banded below
  // where the crack sits for the same reason — the two share a moment and must
  // not share a register.
  [CueKey.Life]: {
    durationMs: 540,
    hz: 175,
    bend: 0.5,
    partials: [1, 0.5, 0.22],
    ratios: [1, 2.05, 3.1],
    noise: 0.06,
    band: [60, 900],
    attack: 0.05,
    gain: 0.34,
    repeat: ONE_SHOT,
  },
  // The copper bell over a shop door. A small bell is close to harmonic with
  // the upper partials pulled slightly sharp, which is what keeps it from
  // reading as an organ — and a clapper leaves a bright tick, which is what the
  // narrow band up top is.
  [CueKey.Arrive]: {
    durationMs: 300,
    hz: 740,
    bend: 1,
    partials: [1, 0.5, 0.3, 0.14],
    ratios: [1, 2.02, 3.01, 4.25],
    noise: 0.05,
    band: [3000, 10000],
    attack: 0.004,
    gain: 0.3,
    repeat: ONE_SHOT,
  },
  // Glass rather than bell, and deliberately the most consonant thing in the
  // table: it is the one cue that is a reward, it sounds up to sixteen
  // semitones higher on a streak, and partials far off the harmonic series
  // would turn that climb sour exactly as the player is doing well.
  [CueKey.Serve]: {
    durationMs: 320,
    hz: 660,
    bend: 1,
    partials: [1, 0.5, 0.28, 0.12],
    ratios: [1, 2.02, 3.05, 4.12],
    noise: 0.04,
    band: [2500, 9000],
    attack: 0.006,
    gain: 0.42,
    repeat: ONE_SHOT,
  },
  [CueKey.Walkout]: {
    durationMs: 640,
    hz: 205,
    // Down a major third, slowly, with the harmonics left in: as close to a
    // trombone as four sine partials get. The ratios stay whole numbers because
    // a trombone genuinely is harmonic — it is a tube — and the band is what
    // supplies design §12's *muffled*, which until now was only implied by
    // picking a low fundamental.
    bend: 0.79,
    partials: [1, 0.7, 0.5, 0.3],
    noise: 0.05,
    band: [70, 1100],
    attack: 0.09,
    gain: 0.4,
    repeat: ONE_SHOT,
  },
  // The shop closing: the walkout's shape, lower and longer, with the partials
  // pulled a hair sharp so it is warm rather than square.
  [CueKey.Over]: {
    durationMs: 950,
    hz: 320,
    bend: 0.5,
    partials: [1, 0.55, 0.28, 0.12],
    ratios: [1, 2.01, 3.02, 4.05],
    noise: 0.05,
    band: [60, 1500],
    attack: 0.035,
    gain: 0.45,
    repeat: ONE_SHOT,
  },
};

/**
 * Noise is seeded rather than `Math.random`, so every boot bakes byte-identical
 * buffers and a cue that sounds wrong sounds wrong again next time
 * (architecture §2). It is baked once at boot, not per play, so this costs the
 * run nothing.
 */
const NOISE_SEED = 0x5ca1ab1e;

/** How sharply a voice falls away once the attack is over. */
const DECAY = 3;

/**
 * Zero at both ends, always. A buffer that starts or stops part-way up a
 * waveform clicks, and a click is the one flaw an ear finds instantly and a
 * waveform picture does not show at all — so it is a property of the envelope
 * rather than something to listen for.
 */
const envelope = (at: number, attack: number): number => {
  if (at <= 0 || at >= 1) return 0;
  if (attack > 0 && at < attack) return at / attack;

  const fallen = (at - attack) / (1 - attack);
  return (1 - fallen) * Math.exp(-DECAY * fallen);
};

/** The loudest the buffer ever gets, which is what a normalise divides by. */
export const peak = (data: Float32Array | Float64Array): number => {
  let loudest = 0;
  for (const sample of data) loudest = Math.max(loudest, Math.abs(sample));
  return loudest;
};

/**
 * One pole of low-pass, a sample at a time: the held value moved a fraction of
 * the way toward the new one. Shared by the cues' band and the bed's bloom
 * because it is the same filter — what differs between them is only what the
 * held value is primed with (`lowPass`).
 */
const toward = (held: number, sample: number, pole: number): number =>
  held + (1 - pole) * (sample - held);

/**
 * The pole that puts a one-pole corner at `hz`. This way round so that a band
 * is written in the units it is heard in, like everything else in this file: a
 * bare coefficient is a number nobody can read a frequency off, which is why
 * the bed's own 0.9 needs a sentence explaining where it sits.
 */
const poleFor = (hz: number, rate: number): number =>
  Math.exp((-2 * Math.PI * hz) / rate);

/**
 * Keeps noise between two corners: one pole of low-pass at the top, less the
 * same again at the bottom, which is a high-pass. Six dB a side — the gentle
 * slope the bed already uses, and enough to carry a burst from bright to dull,
 * which is all the ear is being asked for here.
 *
 * `low` below `high`, which the type cannot say: given them the other way round
 * the two poles cancel to a residue, and `noiseFor` then normalises that residue
 * back up to full scale — a loud, arbitrary bed rather than an error. The cue
 * table is asserted against that in `tones.test.ts` rather than guarded here,
 * where the check would run on every cue at boot to catch a typo made once.
 *
 * Run over the noise alone and **never** over a finished cue. `envelope` is
 * what makes every buffer start and end at exactly zero, and a filter
 * downstream of it would leave a small non-zero tail — which is a click, the
 * one flaw an ear finds instantly and a picture of the waveform does not show
 * at all.
 */
const bandLimit = (
  data: Float64Array,
  rate: number,
  [low, high]: readonly [number, number],
): void => {
  const top = poleFor(high, rate);
  const bottom = poleFor(low, rate);

  let above = 0;
  let below = 0;
  for (let index = 0; index < data.length; index += 1) {
    above = toward(above, data[index] ?? 0, top);
    below = toward(below, above, bottom);
    data[index] = above - below;
  }
};

/**
 * The noise a cue is mixed with, rendered ahead of the voice rather than inside
 * it: colouring it means filtering it, and a filter needs the sample before the
 * one it is on, which the loop below does not keep.
 *
 * Normalised back to full scale once the band is taken out, and that is
 * load-bearing rather than tidiness. `samples` divides by the total weight of
 * everything summed into the voice, which is what makes clipping impossible,
 * and that sum takes the noise term at ±1. A narrow band throws most of the
 * energy away — so without this a banded cue would simply come out quiet, and
 * quiet in a way that moved with the corners rather than with `gain`.
 */
const noiseFor = (
  band: readonly [number, number] | undefined,
  count: number,
  rate: number,
): Float64Array => {
  // Doubles, where the cue it feeds is floats: this is scratch rather than
  // output, and rounding it to the buffer's precision before the filter has run
  // would put a rounding step *inside* the arithmetic rather than at the end of
  // it. It is also what keeps an unbanded cue bit-for-bit what it was before
  // there was a band to put it through — the property the whole re-voicing was
  // measured against.
  const out = new Float64Array(count);
  const rng = createRng(NOISE_SEED);

  for (let index = 0; index < count; index += 1) out[index] = rng.next() * 2 - 1;
  if (band === undefined) return out;

  bandLimit(out, rate, band);

  const loudest = peak(out);
  if (loudest > 0) {
    for (let index = 0; index < count; index += 1)
      out[index] = (out[index] ?? 0) / loudest;
  }

  return out;
};

/**
 * One cue, rendered to mono samples at the rate the hardware is running at.
 *
 * Peak amplitude cannot exceed `gain`, because the voice is divided by the
 * total weight of everything summed into it. Clipping is inaudible on one cue
 * and ugly the moment two overlap, which is exactly the case that is hardest to
 * reproduce on purpose.
 */
export const samples = (spec: CueSpec, rate: number): Float32Array => {
  const count = Math.max(2, Math.round((spec.durationMs / 1000) * rate));
  const out = new Float32Array(count);
  const weight = spec.partials.reduce((sum, amp) => sum + Math.abs(amp), 0) + spec.noise;
  const noise = noiseFor(spec.band, count, rate);

  // The voice resolved once, per cue rather than per sample: `ratios` carries
  // the harmonic default for any partial the table did not place.
  //
  // Typed arrays rather than `map`, and that is measured rather than reflex. A
  // plain array comes out holding small integers for a cue that takes the
  // default and doubles for one that does not, which makes the load in the
  // inner loop polymorphic across the eleven bakes; typing them is about six
  // percent of the whole boot-time bake, the same order as the `forEach` that
  // loop is already written to avoid.
  const voices = spec.partials.length;
  const ratios = new Float64Array(voices);
  const amplitudes = new Float64Array(voices);
  for (let harmonic = 0; harmonic < voices; harmonic += 1) {
    ratios[harmonic] = spec.ratios?.[harmonic] ?? harmonic + 1;
    amplitudes[harmonic] = spec.partials[harmonic] ?? 0;
  }

  let phase = 0;
  for (let index = 0; index < count; index += 1) {
    const at = index / (count - 1);

    // Phase is accumulated rather than computed from `at`, so the bend cannot
    // introduce a discontinuity however steep it is.
    phase += (2 * Math.PI * (spec.hz * spec.bend ** at)) / rate;

    // Indexed rather than `forEach`: the callback would be a fresh closure per
    // sample, which across the eleven cues is a hundred and fifty thousand of
    // them, and it costs about a quarter of the whole boot-time bake.
    let voice = spec.noise * (noise[index] ?? 0);
    for (let harmonic = 0; harmonic < voices; harmonic += 1) {
      voice += (amplitudes[harmonic] ?? 0) * Math.sin(phase * (ratios[harmonic] ?? 1));
    }

    out[index] = (voice / weight) * spec.gain * envelope(at, spec.attack);
  }

  return out;
};

/**
 * The kitchen's own room tone (design §12): a quiet bed under everything, loud
 * enough to notice when it stops and never enough to listen to.
 *
 * Baked at a fraction of the hardware's rate. There is nothing above a few
 * hundred Hz in it, so the samples the extra bandwidth would buy are samples
 * spent on silence — and a bed is minutes long in aggregate where a cue is a
 * tenth of a second, so it is the one thing here whose size is worth minding.
 * Web Audio resamples it on the way out.
 */
export const AMBIENCE_KEY = 'cue-ambience';
export const AMBIENCE_RATE = 11025;
const AMBIENCE_SECONDS = 4;
const AMBIENCE_SEED = 0x0ddba11;

/**
 * Where the bed's hiss is taken off, in the same units a cue's `band` is written
 * in. Two passes at this makes a gentle 12 dB slope, leaving a room rather than
 * a noise.
 *
 * It was the coefficient 0.9 with a comment saying "somewhere under 200 Hz",
 * from before there was anything to convert one into the other. That guess was
 * right to four figures — `poleFor(185, AMBIENCE_RATE)` is 0.8999 — so this
 * says the frequency now and lets the arithmetic do what the sentence was for.
 */
const AMBIENCE_CORNER_HZ = 185;

/**
 * Long enough for the filter to forget where it started. Its memory is a few
 * samples deep at this pole, so this is generous by two orders of magnitude —
 * cheap insurance on the one property the whole bed depends on.
 */
const AMBIENCE_WARMUP = 512;

/** How far the bed breathes, and how many times per loop. Integer, or it clicks. */
const AMBIENCE_SWELL = 0.3;
const AMBIENCE_SWELLS = 3;

/** Peak amplitude. Under every cue, because it is never the thing being said. */
const AMBIENCE_GAIN = 0.16;

/**
 * One pole of low-pass, run so that it *starts* in the state it will end in.
 *
 * This is the whole trick, and it is why the bed needs no crossfade. A filter
 * begun from silence takes a moment to settle, so its first samples do not
 * match its last — and that mismatch is the click a loop makes every time it
 * comes round. Priming it on the tail first means the state at sample 0 is
 * already the state sample 0 *would* have if the buffer were playing for the
 * second time. Which it is.
 */
const lowPass = (data: Float32Array, pole: number): void => {
  let held = 0;
  for (let i = Math.max(0, data.length - AMBIENCE_WARMUP); i < data.length; i += 1) {
    held = toward(held, data[i] ?? 0, pole);
  }

  for (let i = 0; i < data.length; i += 1) {
    held = toward(held, data[i] ?? 0, pole);
    data[i] = held;
  }
};

/**
 * How loud the bed is at one point in its loop — a slow rise and fall over the
 * noise, so that four seconds of it does not sit as flat as a hum.
 *
 * Split out because it carries a condition the arithmetic cannot state: the
 * turn count must be a whole number, or the envelope arrives back at the loop
 * point somewhere other than where it left, and that is a step in the bed's
 * volume however cleanly the noise underneath it joins. A test asks this
 * function what it is worth at either end rather than measuring the noise for
 * it — the envelope is exact where a measurement of filtered noise is an
 * estimate, and the estimate turns out to be too coarse to see a half-turn.
 */
export const swell = (index: number, count: number): number =>
  1 -
  AMBIENCE_SWELL *
    (0.5 - 0.5 * Math.cos((2 * Math.PI * AMBIENCE_SWELLS * index) / count));

/**
 * The bed, rendered once at boot. Noise rather than tone: a kitchen is a room
 * before it is an instrument, and anything with a pitch in it would sit in the
 * same ear the cues are trying to reach.
 */
export const ambience = (): Float32Array => {
  const count = AMBIENCE_SECONDS * AMBIENCE_RATE;
  const out = new Float32Array(count);
  const rng = createRng(AMBIENCE_SEED);

  for (let i = 0; i < count; i += 1) out[i] = rng.next() * 2 - 1;

  const pole = poleFor(AMBIENCE_CORNER_HZ, AMBIENCE_RATE);
  lowPass(out, pole);
  lowPass(out, pole);

  const loudest = peak(out);
  const scale = loudest > 0 ? AMBIENCE_GAIN / loudest : 0;

  for (let i = 0; i < count; i += 1) {
    out[i] = (out[i] ?? 0) * scale * swell(i, count);
  }

  return out;
};

/** A cue, and the rate it is played at — which is the only thing that varies. */
export interface Play {
  readonly key: CueKey;
  readonly rate: number;
}

/**
 * Pulls climb a pentatonic run and start over. Keyed to the strand's length so
 * that growing is audible, wrapped because an unbounded climb would put a long
 * strand out of hearing — the point is the sense of gathering, not the number.
 */
const PULL_SCALE = [0, 2, 4, 7, 9];

/** One interval per primary, so the three jars are told apart with eyes shut. */
const DYE_STEPS = [0, 4, 7];

/**
 * The serve chime, one step per consecutive serve. Design §9 caps the streak
 * multiplier at ×2, which a run of eight serves reaches, so the scale is eight
 * long and settles at the top: the cue stops climbing exactly where the bonus
 * stops growing.
 *
 * This is the one number on the HUD a player cannot look at — the queue is read
 * in glances taken from steering (design §11) — so pitch is where it can go.
 */
const STREAK_SCALE = [0, 2, 4, 7, 9, 12, 14, 16];

const scaled = (scale: readonly number[], step: number): number =>
  semitones(scale[Math.min(Math.max(step, 0), scale.length - 1)] ?? 0);

/**
 * Which cue an event makes, if any. Closed by `event satisfies never`, like the
 * two switches it shadows (`GameScene.play`, `UIScene.play`), so a new
 * `GameEvent` member is a compile error here too rather than a silence nobody
 * notices.
 *
 * The silences are the same ones the board already keeps, and for the same
 * reason: a cut is spoken for by the candies it produces, a knead recolours the
 * segment in front of the player, and a pickup appearing is a thing appearing.
 * `debris-crumbled` joins them here though it does not there — it fires once per
 * block of a severed strand, and the crack has already said what happened.
 */
export const cueFor = (event: GameEvent): Play | undefined => {
  switch (event.type) {
    case 'sugar-pulled':
      return {
        key: CueKey.Pull,
        rate: scaled(PULL_SCALE, event.length % PULL_SCALE.length),
      };

    case 'dye-opened':
      return {
        key: CueKey.Plink,
        rate: scaled(DYE_STEPS, PRIMARIES.indexOf(event.primary)),
      };

    case 'dye-spent':
      // A dye that landed needs nothing: the strand audibly did not change, and
      // it visibly did. One that kneaded nothing has to say so (design §5) —
      // the same test `GameScene.play` splashes on.
      return event.kneaded === 0 ? { key: CueKey.Waste, rate: 1 } : undefined;

    case 'candy-chopped':
      return { key: CueKey.Pop, rate: 1 };

    case 'candy-staled':
      return { key: CueKey.Stale, rate: 1 };

    case 'strand-broken':
      return { key: CueKey.Crack, rate: 1 };

    case 'life-lost':
      return { key: CueKey.Life, rate: 1 };

    case 'customer-arrived':
      return { key: CueKey.Arrive, rate: 1 };

    case 'customer-served':
      return { key: CueKey.Serve, rate: scaled(STREAK_SCALE, event.streak - 1) };

    case 'customer-left':
      return { key: CueKey.Walkout, rate: 1 };

    case 'game-over':
      return { key: CueKey.Over, rate: 1 };

    case 'strand-cut':
    case 'dye-kneaded':
    case 'sugar-spawned':
    case 'dye-spawned':
    case 'debris-crumbled':
      return undefined;

    default:
      event satisfies never;
      return undefined;
  }
};

/** Where a copy lands when the cue is already sounding, or nothing if it is full. */
export interface Repeat {
  readonly delayMs: number;
  /** Stacked on top of the cue's own rate. */
  readonly rate: number;
}

/**
 * The Nth simultaneous copy of a cue. `waiting` is how many are already in the
 * air — the count `ui/shelfStrip.ts` takes off its own pool, arrived at here by
 * asking when the last ones will have finished.
 */
export const repeat = (key: CueKey, waiting: number): Repeat | undefined => {
  const spec = CUES[key].repeat;
  if (waiting >= spec.voices) return undefined;

  const step = Math.min(Math.max(waiting, 0), spec.maxSteps);
  return { delayMs: step * spec.stepMs, rate: semitones(step * spec.semitones) };
};
