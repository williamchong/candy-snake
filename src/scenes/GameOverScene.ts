import Phaser from 'phaser';

import { TIERS, type ColorTier } from '../core/colors';
import { onceAnyInput } from '../input/anyInput';
import { recordScore, today } from '../persist/storage';
import { onScreenCentre } from '../ui/responsive';
import { TextStack, type StackRow } from '../ui/text';
import { SceneKey } from './keys';

/** What the run was worth, handed over by GameScene (architecture §6). */
export interface RunSummary {
  readonly score: number;
  readonly served: number;
  readonly servedByTier: Record<ColorTier, number>;
  readonly bestStreak: number;
  readonly elapsedMs: number;
}

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
  TIERS.filter((tier) => counts[tier] > 0)
    .map((tier) => `${TIER_WORDS[tier]} ${counts[tier]}`)
    .join('  ·  ');

/**
 * Where the run landed on the table, or nothing at all for one that missed it.
 * A screen the player is passing through on the way to the next run is no place
 * to be told they came fourteenth.
 */
const placing = (rank: number | undefined): string => {
  if (rank === undefined) return '';
  if (rank === 1) return 'a new best';

  return `#${rank} on the board`;
};

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
    { text: 'Shop closed', size: 40, gap: 0 },
    { text: `${summary.score}`, size: 64, gap: 64 },
    {
      text: `${summary.served} candies served · ${asClock(summary.elapsedMs)} on the floor`,
      size: 18,
      gap: 58,
    },
  ];

  // The breakdown is what the run *did*, as opposed to what it was paid, and a
  // run that did neither says neither.
  if (summary.served > 0) {
    spec.push({ text: tiers(summary.servedByTier), size: 18, gap: 27 });
  }
  // The count, not the multiplier it earned. `streakMultiplier` caps at ×2
  // (design §9), so a run of eight serves and a run of forty would print the
  // same number on the one screen whose job is to tell them apart — and the
  // multiplier is a step out besides, since `scoreServe` is paid at the streak
  // standing *before* each serve.
  if (summary.bestStreak > 0) {
    const runs = summary.bestStreak === 1 ? 'serve' : 'in a row';
    spec.push({ text: `best streak ${summary.bestStreak} ${runs}`, size: 18, gap: 27 });
  }

  const placed = placing(rank);
  if (placed !== '') spec.push({ text: placed, size: 22, gap: 44 });

  spec.push({ text: 'Press any key', size: 20, gap: 46 });

  let dy = 0;
  const stacked = spec.map(({ text, size, gap }) => {
    dy += gap;
    return { text, size, dy };
  });
  const half = dy / 2;

  return stacked.map((row) => ({ ...row, dy: row.dy - half }));
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
