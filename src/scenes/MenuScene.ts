import Phaser from 'phaser';

import { onceAnyInput } from '../input/anyInput';
import { asDay, highScores, type ScoreEntry } from '../persist/storage';
import { EXIT_GAP, menuPlan, type MenuPlan } from '../ui/layout';
import { Parade } from '../ui/parade';
import { onScreenCentre } from '../ui/responsive';
import { TextStack, type StackRow } from '../ui/text';
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
 *
 * Between the tagline and the table walks the parade (`ui/parade.ts`), on the
 * frames with room to spare for one — the only part of this screen that shows
 * what the game looks like.
 */
const TITLE = 'Candy Snake';
const TAGLINE = 'Pull sugar · knead dye · chop candy';
const PROMPT = 'Press any key to open up';

const TAGLINE_SIZE = 20;
const PROMPT_SIZE = 22;
const HEADING_SIZE = 16;
const ENTRY_SIZE = 18;
/** How far the heading sits above the table's first entry. */
const HEADING_LIFT = 30;

const sameAs = (a: MenuPlan, b: MenuPlan | undefined): boolean =>
  b !== undefined &&
  a.size === b.size &&
  a.title === b.title &&
  a.top === b.top &&
  a.pitch === b.pitch &&
  a.shown === b.shown &&
  a.parade === b.parade;

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
    { text: 'Best runs', size: HEADING_SIZE, dy: top - HEADING_LIFT },
    ...table,
    { text: PROMPT, size: PROMPT_SIZE, dy: top + (shown - 1) * pitch + EXIT_GAP },
  ];
};

export class MenuScene extends Phaser.Scene {
  /** The stack and what it was laid out for — one field, because they move together. */
  private built: { readonly stack: TextStack; readonly laid: MenuPlan } | undefined;
  /**
   * Built once and only ever re-centred: what walks past does not depend on the
   * frame, so a window drag has no reason to rebuild it the way it can the text.
   */
  private parade: Parade | undefined;

  constructor() {
    super(SceneKey.Menu);
  }

  create(): void {
    const scores = highScores();
    // Phaser reuses the scene instance, so these outlive `create` and would
    // otherwise point at objects destroyed on the way out to the last run.
    this.built = undefined;
    this.parade = new Parade(this);

    onScreenCentre(this, (centre, width, height) => {
      const laid = menuPlan(height, scores.length);

      this.stackFor(scores, laid).centreOn(centre, width);
      this.parade?.centreOn(centre, width, laid.parade);
    });

    onceAnyInput(this, () => this.scene.start(SceneKey.Game));
  }

  /**
   * The one thing on this screen that moves. Off the scene clock rather than an
   * accumulated delta: the walkers' phases are functions of the time, so a
   * dropped frame costs a step rather than sliding the whole parade behind.
   */
  override update(time: number): void {
    this.parade?.update(time);
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
