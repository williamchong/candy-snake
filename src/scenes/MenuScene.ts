import Phaser from 'phaser';

import { onceAnyInput } from '../input/anyInput';
import { asDay, highScores, type ScoreEntry } from '../persist/storage';
import { scoreboard } from '../ui/layout';
import { onScreenCentre } from '../ui/responsive';
import { MARGIN, TextStack, type StackRow } from '../ui/text';
import { SceneKey } from './keys';

/**
 * The front of the shop. The run itself opens with three teaching levels
 * (design §7), so this screen has no tutorial work to do — what earns it its
 * keep is the high-score table, which is the only place a run that is over is
 * still worth anything.
 *
 * The stack is placed off the middle of the visible frame rather than off fixed
 * coordinates, so it reads the same on a phone as it does in a window. Starting
 * the run is a tap anywhere (`onceAnyInput`), which is as large as a touch
 * target can be.
 */
const TITLE = 'Candy Snake';
const TAGLINE = 'Pull sugar · knead dye · chop candy';
const PROMPT = 'Press any key to open up';

/**
 * The title shrinks before the table does. `TextStack` scales a line that is too
 * wide for the frame but knows nothing about its height, so a phone held
 * sideways would wear the title off the top of the screen — and of the two, the
 * word the player is already looking at is the one that can afford to give way.
 */
const TITLE_SIZE = { tall: 56, short: 40 } as const;
const SHORT_FRAME = 420;

/**
 * Half a rendered line, as a share of its nominal size — what the top row has to
 * clear the frame's edge by. Derived rather than tabulated beside `TITLE_SIZE`:
 * a second table of hand-kept numbers is one a changed size silently invalidates.
 */
const HALF_LINE = 0.6;

/** How far the title would like to sit above the middle, given the room. */
const TITLE_DY = -140;
/** Below the tagline, above the table's heading. */
const TITLE_TO_TABLE = 72;
const TAGLINE_SIZE = 20;
const PROMPT_SIZE = 22;
const HEADING_SIZE = 16;
const ENTRY_SIZE = 18;
/** Air between the last entry and the line that says how to leave. */
const PROMPT_GAP = 46;

/**
 * Where the screen's rows fall, given the room. Separated from the rows
 * themselves because it is also the answer to "has anything actually moved?" —
 * `Scale.RESIZE` fires on every frame of a window drag, and rebuilding a stack
 * of text objects thirteen times a second to move them a pixel is work nobody
 * asked for.
 */
interface MenuPlan {
  readonly size: number;
  readonly title: number;
  readonly top: number;
  readonly pitch: number;
  readonly shown: number;
}

const plan = (height: number, count: number): MenuPlan => {
  const size = TITLE_SIZE[height < SHORT_FRAME ? 'short' : 'tall'];
  // As high as it wants to sit, or as high as the frame lets it, whichever is
  // lower down. Rounded because it is compared, not just drawn: an offset that
  // slides a fraction with every pixel of a window drag is one that reports a
  // new layout on every frame, which is the rebuild `sameAs` exists to prevent.
  const title = Math.round(Math.max(TITLE_DY, -(height / 2 - MARGIN - size * HALF_LINE)));
  const top = title + size + TITLE_TO_TABLE;

  return {
    size,
    title,
    top,
    ...scoreboard(height / 2 - top - PROMPT_GAP - MARGIN, count),
  };
};

const sameAs = (a: MenuPlan, b: MenuPlan | undefined): boolean =>
  b !== undefined &&
  a.size === b.size &&
  a.title === b.title &&
  a.top === b.top &&
  a.pitch === b.pitch &&
  a.shown === b.shown;

/**
 * The whole screen, laid out downward from the title. Everything below it is
 * measured from the title rather than from the middle, so a frame that had to
 * compress the top does not open a gap under it.
 */
const rows = (scores: readonly ScoreEntry[], laid: MenuPlan): readonly StackRow[] => {
  const { size, title, top, pitch, shown } = laid;
  const head: readonly StackRow[] = [
    { text: TITLE, size, dy: title },
    { text: TAGLINE, size: TAGLINE_SIZE, dy: title + size * 0.8 },
  ];

  // No table: a first run, or a frame with no room for one. Either way the head
  // keeps the offsets the frame gave it — falling back to a fixed layout here is
  // how the title ends up back off the top of the screen it was clamped for.
  if (shown === 0) {
    return [...head, { text: PROMPT, size: PROMPT_SIZE, dy: top }];
  }

  const table = scores.slice(0, shown).map((entry, index) => ({
    // Rank is carried by the order rather than printed: `TextStack` centres
    // every line on one point, so a leading `1.` would only sit under a `10.`.
    text: `${entry.score} \u00b7 ${asDay(entry.at)}`,
    size: ENTRY_SIZE,
    dy: top + index * pitch,
  }));

  return [
    ...head,
    { text: 'Best runs', size: HEADING_SIZE, dy: top - 30 },
    ...table,
    { text: PROMPT, size: PROMPT_SIZE, dy: top + (shown - 1) * pitch + PROMPT_GAP },
  ];
};

export class MenuScene extends Phaser.Scene {
  /** The stack and what it was laid out for — one field, because they move together. */
  private built: { readonly stack: TextStack; readonly laid: MenuPlan } | undefined;

  constructor() {
    super(SceneKey.Menu);
  }

  create(): void {
    const scores = highScores();
    // Phaser reuses the scene instance, so this outlives `create` and would
    // otherwise point at text destroyed on the way out to the last run.
    this.built = undefined;

    onScreenCentre(this, (centre, width, height) => {
      this.stackFor(scores, plan(height, scores.length)).centreOn(centre, width);
    });

    onceAnyInput(this, () => this.scene.start(SceneKey.Game));
  }

  /**
   * The stack for this layout, rebuilt only when the layout actually moved.
   * `Scale.RESIZE` fires on every frame of a window drag and every `Text` owns a
   * canvas and a GPU texture, so re-centring the ones already standing is much
   * the cheaper of the two answers and much the commoner.
   */
  private stackFor(scores: readonly ScoreEntry[], laid: MenuPlan): TextStack {
    if (this.built !== undefined && sameAs(laid, this.built.laid)) {
      return this.built.stack;
    }

    this.built?.stack.destroy();
    this.built = { stack: new TextStack(this, rows(scores, laid)), laid };

    return this.built.stack;
  }
}
