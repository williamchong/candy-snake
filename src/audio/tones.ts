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
  /** Amplitude of the fundamental and each harmonic above it. */
  readonly partials: readonly number[];
  /** How much of the voice is noise rather than tone, 0..1. */
  readonly noise: number;
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
  // margin, and anything with a tail would smear into the next pull.
  [CueKey.Pull]: {
    durationMs: 90,
    hz: 520,
    bend: 1.18,
    partials: [1, 0.25],
    noise: 0,
    attack: 0.06,
    gain: 0.3,
    repeat: ONE_SHOT,
  },
  [CueKey.Plink]: {
    durationMs: 120,
    hz: 660,
    bend: 1,
    partials: [1, 0.4, 0.15],
    noise: 0.02,
    attack: 0.02,
    gain: 0.34,
    repeat: ONE_SHOT,
  },
  // Low, dull and falling — the one dye sound that is not a bell, because it is
  // the one that reports a mistake.
  [CueKey.Waste]: {
    durationMs: 160,
    hz: 150,
    bend: 0.7,
    partials: [1, 0.2],
    noise: 0.25,
    attack: 0.02,
    gain: 0.38,
    repeat: ONE_SHOT,
  },
  // One chop cuts a whole batch, so this is the cue that stacks hardest. It
  // climbs a whole tone per candy: the batch is *counted* rather than smeared.
  [CueKey.Pop]: {
    durationMs: 110,
    hz: 420,
    bend: 1.6,
    partials: [1, 0.3],
    noise: 0.12,
    attack: 0.01,
    gain: 0.36,
    repeat: { stepMs: 45, maxSteps: 5, semitones: 2, voices: 6 },
  },
  [CueKey.Stale]: {
    durationMs: 170,
    hz: 300,
    bend: 0.6,
    partials: [1, 0.35],
    noise: 0.1,
    attack: 0.02,
    gain: 0.3,
    // The rack's own numbers (`ui/shelfStrip.ts`): what the eye was given for
    // this exact event, so the ear is given the same and the two stay in step.
    repeat: { stepMs: 70, maxSteps: 3, semitones: -1, voices: 4 },
  },
  [CueKey.Crack]: {
    durationMs: 260,
    hz: 200,
    bend: 0.45,
    partials: [1, 0.6, 0.3],
    noise: 0.7,
    attack: 0.005,
    gain: 0.5,
    repeat: ONE_SHOT,
  },
  // Longer than the crack and quieter, so it is heard *under* it rather than
  // as a second impact: one thing happened, and it cost something.
  [CueKey.Life]: {
    durationMs: 520,
    hz: 180,
    bend: 0.5,
    partials: [1, 0.5],
    noise: 0.05,
    attack: 0.04,
    gain: 0.34,
    repeat: ONE_SHOT,
  },
  [CueKey.Arrive]: {
    durationMs: 220,
    hz: 780,
    bend: 1,
    partials: [1, 0.5, 0.25],
    noise: 0,
    attack: 0.01,
    gain: 0.3,
    repeat: ONE_SHOT,
  },
  [CueKey.Serve]: {
    durationMs: 300,
    hz: 660,
    bend: 1,
    partials: [1, 0.6, 0.3, 0.12],
    noise: 0,
    attack: 0.008,
    gain: 0.42,
    repeat: ONE_SHOT,
  },
  [CueKey.Walkout]: {
    durationMs: 620,
    hz: 210,
    // Down a major third, slowly, with the harmonics left in: as close to a
    // trombone as three sine partials get.
    bend: 0.79,
    partials: [1, 0.7, 0.5, 0.3],
    noise: 0.03,
    attack: 0.08,
    gain: 0.4,
    repeat: ONE_SHOT,
  },
  [CueKey.Over]: {
    durationMs: 900,
    hz: 330,
    bend: 0.5,
    partials: [1, 0.5, 0.25],
    noise: 0.04,
    attack: 0.03,
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
  const rng = createRng(NOISE_SEED);
  const weight = spec.partials.reduce((sum, amp) => sum + Math.abs(amp), 0) + spec.noise;

  let phase = 0;
  for (let index = 0; index < count; index += 1) {
    const at = index / (count - 1);

    // Phase is accumulated rather than computed from `at`, so the bend cannot
    // introduce a discontinuity however steep it is.
    phase += (2 * Math.PI * (spec.hz * spec.bend ** at)) / rate;

    // Indexed rather than `forEach`: the callback would be a fresh closure per
    // sample, which across the eleven cues is a hundred and fifty thousand of
    // them, and it costs about a quarter of the whole boot-time bake.
    let voice = spec.noise * (rng.next() * 2 - 1);
    for (let harmonic = 0; harmonic < spec.partials.length; harmonic += 1) {
      voice += (spec.partials[harmonic] ?? 0) * Math.sin(phase * (harmonic + 1));
    }

    out[index] = (voice / weight) * spec.gain * envelope(at, spec.attack);
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
