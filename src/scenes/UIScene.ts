import Phaser from 'phaser';

import { RED } from '../core/colors';
import { STARTING_LIVES, type Game } from '../core/game';
import type { GameEvent } from '../core/types';
import { bindHotkey, HotKey } from '../input/keyboard';
import { GLYPH_TINT, HudDepth, makeSprite } from '../render/drawn';
import { glyphTextureKey } from '../render/textures';
import { CheatSheet } from '../ui/cheatSheet';
import { CustomerQueue } from '../ui/customerQueue';
import { Mood } from '../ui/customerView';
import { onFrame } from '../ui/responsive';
import { ShelfStrip } from '../ui/shelfStrip';
import { textStyle } from '../ui/text';
import { SceneKey } from './keys';

/**
 * The HUD, running in parallel above GameScene (architecture §6) so that camera
 * effects on the play field never move the score.
 *
 * Everything here reads core state and draws it; nothing writes back. Where any
 * of it goes is `ui/layout.ts`'s to say (architecture §9) — beside the board on
 * a wide screen and beneath it on a tall one, so that a candy's whole path still
 * reads as one run from the bench to the child (design §10).
 *
 * The HUD is deliberately *not* scaled with the board: it is a separate scene
 * with its own camera, so text stays at a readable size and a tap target stays
 * a tap target however far the kitchen has had to shrink.
 */

/** The HUD's own events: everything over here that is played rather than drawn. */
type HudEvent = Extract<
  GameEvent,
  {
    type: 'customer-arrived' | 'customer-served' | 'customer-left' | 'candy-staled';
  }
>;

export class UIScene extends Phaser.Scene {
  private core!: Game;
  private scoreText!: Phaser.GameObjects.Text;
  private lives: Phaser.GameObjects.Image[] = [];
  private queue!: CustomerQueue;
  private shelf!: ShelfStrip;
  private sheet!: CheatSheet;
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
    this.scoreText = this.add.text(0, 0, '0', textStyle(30)).setOrigin(0, 0.5);

    // Hearts in ink rather than red: a life is not a candy, and hue in this
    // game belongs to candies alone (design §4, palette constraints). The heart
    // is red's accessibility symbol, so the shape is already baked.
    this.lives = Array.from({ length: STARTING_LIVES }, () =>
      makeSprite(this, glyphTextureKey(RED), GLYPH_TINT, HudDepth.Icon, {
        x: 0,
        y: 0,
      }),
    );

    this.shelf = new ShelfStrip(this);
    this.queue = new CustomerQueue(this);
    // Built fresh here rather than held at the field, for the same reason the
    // hearts are reset above: the scene instance outlives the run. Whether the
    // player wants the sheet is remembered by `cheatSheet.ts` itself, which is
    // what survives instead.
    this.sheet = new CheatSheet(this);
    bindHotkey(this, HotKey.CheatSheet, () => {
      this.sheet.toggle();
    });

    // Everything above is built at the origin and put somewhere by the layout
    // pass, which runs once here and again whenever the device changes shape.
    //
    // Pure repositioning: what each piece *shows* is drawn from core state
    // every frame regardless, so nothing here has to know what a run is
    // currently doing.
    onFrame(this, (frame) => {
      const { score, lives } = frame.hud;

      this.scoreText.setPosition(score.x, score.y);
      this.lives.forEach((heart, life) =>
        heart.setPosition(lives.at.x + life * lives.pitch, lives.at.y),
      );

      this.shelf.applyFrame(frame);
      this.queue.applyFrame(frame);
      this.sheet.applyFrame(frame);
    });
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
    this.sheet.render(delta);

    if (state.lives !== this.shownLives) {
      this.shownLives = state.lives;
      this.lives.forEach((heart, life) => heart.setVisible(life < state.lives));
    }
  }

  /**
   * What the window and the rack *hold* is state and is drawn from it, but a
   * child walking on, a child walking off and a candy pushed off the end are
   * one-shots — so they hang off the event stream GameScene is already walking,
   * rather than being guessed at from something appearing in or vanishing from
   * a list (architecture §6, §7).
   */
  play(event: HudEvent): void {
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

      case 'candy-staled':
        this.shelf.toss(event.color);
        return;

      default:
        // Widening `HudEvent` without handling the new member becomes a type
        // error here rather than a one-shot that quietly never plays — the same
        // guard `GameScene.play` keeps over the whole event union.
        event satisfies never;
        return;
    }
  }

  /**
   * A turn the player asked for and the queue accepted. GameScene's second
   * one-way channel into the HUD, and the only thing here that hangs off input
   * rather than off state: the cheat sheet takes itself down once the player is
   * playing, which is a fact about the player and not about the run.
   */
  steered(): void {
    this.sheet.steered();
  }
}
