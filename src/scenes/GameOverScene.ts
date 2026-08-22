import Phaser from 'phaser';

import { TIER_ORDER, type ColorTier } from '../core/colors';
import type { RunSummary } from '../core/types';
import { onceAnyInput } from '../input/anyInput';
import { recordScore, today } from '../persist/storage';
import { centredColumn, EXIT_GAP } from '../ui/layout';
import { onScreenCentre } from '../ui/responsive';
import { TextStack, type StackRow } from '../ui/text';
import { SceneKey } from './keys';

const asClock = (elapsedMs: number): string => {
  const seconds = Math.floor(elapsedMs / 1_000);
  return `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')}`;
};

/**
 * Design §9's scoring table in the words it uses for it. Tiers are named rather
 * than numbered because a tier number is a thing the game never showed the
 * player — what they saw was how hard the color was to mix.
 */
const TIER_WORDS: Record<ColorTier, string> = {
  1: 'raw',
  2: 'primary',
  3: 'secondary',
  mistake: 'mystery',
};

/** Only what happened: a run with no over-mix in it does not read "mystery 0". */
const tiers = (counts: Record<ColorTier, number>): string =>
  TIER_ORDER.filter((tier) => counts[tier] > 0)
    .map((tier) => `${TIER_WORDS[tier]} ${counts[tier]}`)
    .join('  ·  ');

/**
 * The best batch, if there was one, as a clause on the streak's line rather
 * than a line of its own — this screen centres its rows without fitting them to
 * the frame's *height*, and a ninth row puts the fullest run past a small phone
 * held sideways. Hung off the streak safely: a batch worth reporting takes at
 * least two serves, which is a streak of at least two, so the line it joins is
 * always there.
 *
 * Nothing below 2, because every serve straight off the block scores 1 — a run
 * reporting "best combo 1" would be reporting that it was played.
 *
 * Level 4 teaches a batch of two but does not force one (design §7): a maker
 * who chops one candy at a time finishes it having fed each child separately.
 * Measured on the reference grinder, 193 tutorials in 200 end at a combo of 1,
 * so 2 is still something a run earned rather than something it was handed —
 * this floor was briefly raised on the opposite assumption and it was wrong.
 */
const bestBatch = ({ bestCombo }: RunSummary): string =>
  bestCombo > 1 ? `  ·  best batch fed ${bestCombo}` : '';

/**
 * Where the run landed on the table, or nothing at all for one that missed it.
 * A screen the player is passing through on the way to the next run is no place
 * to be told they came fourteenth.
 */
const placing = (rank: number | undefined): string | undefined => {
  if (rank === undefined) return undefined;
  if (rank === 1) return 'a new best';

  return `#${rank} on the board`;
};

const CLOSED_SIZE = 40;
const SCORE_SIZE = 64;
const STAT_SIZE = 18;
const PLACING_SIZE = 22;
const PROMPT_SIZE = 20;
/** Between the run's own stats, which read as one paragraph. */
const STAT_GAP = 27;

/** A row and the air above it, before the stack knows where it starts. */
interface Line {
  readonly text: string;
  readonly size: number;
  readonly gap: number;
}

/**
 * Centred off the middle of the visible frame — see `MenuScene` for the why.
 *
 * Rows are stacked by the air between them and only then centred, rather than
 * placed at fixed offsets: half of them are conditional, and a run that served
 * nobody would otherwise leave the hole where its breakdown would have been.
 */
const lines = (summary: RunSummary, rank: number | undefined): readonly StackRow[] => {
  const spec: Line[] = [
    { text: 'Shop closed', size: CLOSED_SIZE, gap: 0 },
    { text: `${summary.score}`, size: SCORE_SIZE, gap: 64 },
    {
      text: `${summary.served} candies served · ${asClock(summary.elapsedMs)} on the floor`,
      size: STAT_SIZE,
      gap: 58,
    },
  ];

  // The breakdown is what the run *did*, as opposed to what it was paid, and a
  // run that did neither says neither.
  if (summary.served > 0) {
    spec.push({ text: tiers(summary.servedByTier), size: STAT_SIZE, gap: STAT_GAP });
  }
  // The count, not the multiplier it earned. `streakMultiplier` caps at ×2
  // (design §9), so a run of eight serves and a run of forty would print the
  // same number on the one screen whose job is to tell them apart — and the
  // multiplier is a step out besides, since `scoreServe` is paid at the streak
  // standing *before* each serve.
  if (summary.bestStreak > 0) {
    const runs = summary.bestStreak === 1 ? 'serve' : 'in a row';
    spec.push({
      text: `best streak ${summary.bestStreak} ${runs}${bestBatch(summary)}`,
      size: STAT_SIZE,
      gap: STAT_GAP,
    });
  }

  const placed = placing(rank);
  if (placed !== undefined) spec.push({ text: placed, size: PLACING_SIZE, gap: 44 });

  spec.push({ text: 'Press any key', size: PROMPT_SIZE, gap: EXIT_GAP });

  const offsets = centredColumn(spec.map(({ gap }) => gap));

  return spec.map(({ text, size }, index) => ({ text, size, dy: offsets[index] ?? 0 }));
};

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.GameOver);
  }

  create(summary: RunSummary): void {
    // Saved on arrival, not on a prompt: design §11 wants the table entry-free.
    const rank = recordScore({ score: summary.score, at: today() });

    const stack = new TextStack(this, lines(summary, rank));
    onScreenCentre(this, (centre, width) => stack.centreOn(centre, width));

    onceAnyInput(this, () => this.scene.start(SceneKey.Menu));
  }
}
