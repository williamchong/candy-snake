import Phaser from 'phaser';

import { CHOP_BLOCK_TOP } from '../core/board';
import { RED } from '../core/colors';
import { STARTING_LIVES, type Game } from '../core/game';
import type { GameEvent } from '../core/types';
import { BOARD_RIGHT, rowToPixel } from '../render/boardView';
import { GLYPH_TINT, HudDepth, makeSprite } from '../render/drawn';
import { glyphTextureKey } from '../render/textures';
import { CustomerQueue } from '../ui/customerQueue';
import { Mood } from '../ui/customerView';
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

const SCORE_Y = 40;
const LIVES_Y = 84;
const LIVES_PITCH = 26;

const SHELF_X = COLUMN_X + 28;
const SHELF_TOP = rowToPixel(CHOP_BLOCK_TOP);

/**
 * Where the child at the head of the queue stands: a floor line set by eye just
 * inside the bottom of the kitchen, with the line running back from there
 * toward the door, so the whole column reads top to bottom as one path —
 * bench, rack, child. Fixed like the rest of the geometry here until
 * `ui/layout.ts` takes it over (architecture §9).
 */
const QUEUE_FRONT = { x: COLUMN_X + 42, y: 556 };

/** The window's own events: everything the queue plays rather than draws. */
type WindowEvent = Extract<
  GameEvent,
  { type: 'customer-arrived' | 'customer-served' | 'customer-left' }
>;

export class UIScene extends Phaser.Scene {
  private core!: Game;
  private scoreText!: Phaser.GameObjects.Text;
  private lives: Phaser.GameObjects.Image[] = [];
  private queue!: CustomerQueue;
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
    this.queue = new CustomerQueue(this, QUEUE_FRONT);
  }

  /**
   * Patience drains every frame, so the HUD redraws every frame — but each
   * piece guards on what it last drew, so a still queue costs a few
   * comparisons rather than a re-layout. `setText` does its own unchanged
   * check, so the score needs no guard here.
   */
  update(_time: number, delta: number): void {
    const { state } = this.core;

    this.scoreText.setText(`${state.score}`);
    this.shelf.render(state.shelf);
    // Real elapsed time, not the core's fixed slice: the children walk on the
    // display's clock, the way every other tween in the HUD does.
    this.queue.render(state.customers, delta);

    if (state.lives !== this.shownLives) {
      this.shownLives = state.lives;
      this.lives.forEach((heart, life) => heart.setVisible(life < state.lives));
    }
  }

  /**
   * Who is waiting is state and is drawn from it, but walking on and walking
   * off are one-shots — so they hang off the event stream GameScene is already
   * walking, rather than being guessed at from a customer appearing in or
   * vanishing from the queue (architecture §6, §7).
   */
  play(event: WindowEvent): void {
    switch (event.type) {
      case 'customer-arrived':
        this.queue.admit(event.customer);
        return;

      case 'customer-served':
        this.queue.depart(event.customer.id, Mood.Served);
        return;

      case 'customer-left':
        this.queue.depart(event.customer.id, Mood.Walkout);
        return;
    }
  }
}
