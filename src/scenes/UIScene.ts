import Phaser from 'phaser';

import { CHOP_BLOCK_TOP } from '../core/board';
import { RED } from '../core/colors';
import { STARTING_LIVES, type Game } from '../core/game';
import { BOARD_RIGHT, rowToPixel } from '../render/boardView';
import { GLYPH_TINT, HudDepth, makeSprite } from '../render/drawn';
import { glyphTextureKey } from '../render/textures';
import { GAME_WIDTH } from '../ui/layout';
import { CARD_HEIGHT, CARD_WIDTH, OrderCard } from '../ui/orderCard';
import { ShelfStrip } from '../ui/shelfStrip';
import { textStyle } from '../ui/text';
import { SceneKey } from './keys';

/**
 * The HUD, running in parallel above GameScene (architecture §6) so that camera
 * effects on the play field never move the score.
 *
 * Everything here reads core state and draws it; nothing writes back. The
 * layout is the landscape column from design §10 — score, lives, the rack level
 * with the bench, then the queue below it, so a candy's whole path reads down
 * one side. Geometry is fixed at 960×640 until `ui/layout.ts` takes it over in
 * the mobile phase (architecture §9).
 */
const COLUMN_MARGIN = 24;
const COLUMN_X = BOARD_RIGHT + COLUMN_MARGIN;
const COLUMN_WIDTH = GAME_WIDTH - COLUMN_X - COLUMN_MARGIN;

const SCORE_Y = 40;
const LIVES_Y = 84;
const LIVES_PITCH = 26;

const SHELF_X = COLUMN_X + 28;
const SHELF_TOP = rowToPixel(CHOP_BLOCK_TOP);

/** Four slots: the queue cap grows to 3–4 as the ramp bites (design §7). */
const MAX_CARDS = 4;
const CARD_PITCH = CARD_WIDTH + 6;
const CARDS_TOP = 424;
const CAPTION_Y = CARDS_TOP + CARD_HEIGHT + 20;

/**
 * What each opening level is teaching, in the order they are played
 * (design §7). These are the three contextual hints design §11 asks for — as
 * captions on levels that always run, rather than first-run toasts that can be
 * missed.
 */
const LEVEL_CAPTIONS = [
  'Drive over sugar to pull the strand, then into the block to chop it.',
  'Sugar first, then the jar — a dye colors the strand you already have.',
  'Two jars in one strand blend into one color.',
];

export class UIScene extends Phaser.Scene {
  private core!: Game;
  private scoreText!: Phaser.GameObjects.Text;
  private caption!: Phaser.GameObjects.Text;
  private lives: Phaser.GameObjects.Image[] = [];
  private cards: OrderCard[] = [];
  private shelf!: ShelfStrip;
  /**
   * Hearts last drawn. Reset in `create`, not at the field: Phaser reuses the
   * scene instance between runs, so a value carried over from the last run
   * would suppress the first draw of a fresh one.
   */
  private shownLives = -1;

  constructor() {
    super(SceneKey.UI);
  }

  create(data: { core: Game }): void {
    this.core = data.core;

    this.shownLives = -1;
    this.scoreText = this.add
      .text(COLUMN_X, SCORE_Y, '0', textStyle(30))
      .setOrigin(0, 0.5);
    this.caption = this.add
      .text(COLUMN_X, CAPTION_Y, '', textStyle(14, { wordWrap: { width: COLUMN_WIDTH } }))
      .setOrigin(0, 0);

    // Hearts in ink rather than red: a life is not a candy, and hue in this
    // game belongs to candies alone (design §4, palette constraints). The heart
    // is red's accessibility symbol, so the shape is already baked.
    this.lives = Array.from({ length: STARTING_LIVES }, (_unused, life) =>
      makeSprite(this, glyphTextureKey(RED), GLYPH_TINT, HudDepth.Icon, {
        x: COLUMN_X + 8 + life * LIVES_PITCH,
        y: LIVES_Y,
      }),
    );

    this.shelf = new ShelfStrip(this, { x: SHELF_X, y: SHELF_TOP });

    this.cards = Array.from(
      { length: MAX_CARDS },
      (_unused, slot) =>
        new OrderCard(this, {
          x: COLUMN_X + CARD_WIDTH / 2 + slot * CARD_PITCH,
          y: CARDS_TOP + CARD_HEIGHT / 2,
        }),
    );
  }

  /**
   * Patience drains every frame, so the HUD redraws every frame — but each
   * piece guards on what it last drew, so a still queue costs a few
   * comparisons rather than a re-layout. `setText` does its own unchanged
   * check, so score and caption need no guard here.
   */
  update(): void {
    const { state } = this.core;

    this.scoreText.setText(`${state.score}`);
    this.shelf.render(state.shelf);
    this.cards.forEach((card, slot) => card.render(state.customers[slot]));

    if (state.lives !== this.shownLives) {
      this.shownLives = state.lives;
      this.lives.forEach((heart, life) => heart.setVisible(life < state.lives));
    }

    // Only while the opening levels are actually running — past them the
    // column carries the queue and nothing else.
    const level = this.core.openingLevel;
    this.caption.setText(
      level === undefined ? '' : (LEVEL_CAPTIONS[state.tutorialIndex] ?? ''),
    );
  }
}
