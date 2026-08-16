import type Phaser from 'phaser';

import { HudDepth, makeSprite } from '../render/drawn';
import { TextureKey } from '../render/textures';
import { BODY_Y, CHILD_SCALE, CHILD_TINT } from './customerView';
import type { Frame } from './layout';

/**
 * The rush, telegraphed (design §7, §11): children gathering in the shop
 * doorway before the ones who count reach the window.
 *
 * The tide `core/difficulty.ts` runs past the three-minute mark is invisible on
 * its own — an arrival interval is a number, and a player has no way to see one
 * shorten. Seen coming, it is the thing that makes the rush worth having: a
 * maker who reads the doorway has nine seconds to build a ladder into the peak,
 * instead of discovering the peak by losing to it. Which is why the swell in
 * `RUSH_SHAPE` is nine seconds long rather than instant, and why this is not
 * optional decoration on top of the mechanic.
 *
 * No words, per design §11 — the queue is the one part of the HUD read in
 * glances taken from steering, so it is a drawn thing that *moves*. A texture
 * swap is invisible in peripheral vision, which is the lesson the urgency pulse
 * already recorded.
 */

/**
 * Enough to read as a crowd. More would not queue up outside the door — they
 * are placed back *into* the frame from the edge, so a fourth would stand
 * further across the line the waiting children are already on.
 */
const CROWD = 3;

/**
 * How tightly they stand. Well under the queue's own pitch on purpose: a line
 * at the queue's spacing is another queue, and what this has to say is *crowd*.
 */
const HUDDLE = 26;

/**
 * A silhouette rather than another child. They are behind the shop's own wall
 * and are not waiting for anything yet, so they never reach the presence of a
 * customer at the window — which would read as a queue of seven.
 */
const MAX_ALPHA = 0.5;

/**
 * A slow shuffle. Design §2's comfort constraint binds this the way it binds
 * the patience alarm: a breath, not a blink — and each of them on their own
 * phase, or three bobbing in lockstep reads as one object.
 */
const BOB_MS = 900;
const BOB_PX = 5;
/** Enough of a period to keep them out of step, and not a neat fraction of it. */
const BOB_STAGGER = 0.37;

export class RushDoor {
  private readonly scene: Phaser.Scene;
  private readonly figures: Phaser.GameObjects.Image[];

  private footY = 0;
  private door = 0;
  /**
   * Which way is *into* the shop from the door: the queue's own pitch runs the
   * other way, from the window toward the door, so this is its negation.
   */
  private intoShop = 1;
  /**
   * So a calm window — the first three minutes of a run, and half of every
   * period after — costs one comparison a frame rather than three writes.
   * Starts `false` against sprites built invisible, deliberately: the first
   * calm frame then does one redundant pass and leaves the two agreeing, where
   * starting `true` would trust a claim nothing had established.
   */
  private hidden = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.figures = Array.from({ length: CROWD }, () =>
      makeSprite(
        scene,
        TextureKey.Customer,
        CHILD_TINT,
        HudDepth.Doorway,
        { x: 0, y: 0 },
        CHILD_SCALE,
      ).setVisible(false),
    );
  }

  /**
   * The doorway moved. `door` is the layout's, not this widget's: where the
   * frame cuts the crowd is a measurement swept per viewport (`ui/layout.ts`),
   * because a doorway wholly on screen is another queue and one wholly off it
   * tells the player nothing.
   */
  applyFrame(frame: Frame): void {
    const { queue } = frame.hud;

    this.footY = queue.front.y;
    this.door = queue.door;
    this.intoShop = queue.pitch >= 0 ? -1 : 1;
  }

  /**
   * Draws the crowd at `intensity`, the tide's own 0…1 (`Game.rush`).
   *
   * Nothing is cached across a resize: while the doorway is showing, every
   * figure is placed from `door` and `footY` again each frame, so a device
   * turned mid-rush is already drawing against the new frame on the next one.
   * That is the trap the plan records for HUD effects — a pooled board effect
   * rides its container, and a HUD one is aimed at coordinates `applyFrame`
   * invalidates — sidestepped by never holding a position between frames.
   */
  render(intensity: number): void {
    if (intensity <= 0) {
      if (this.hidden) return;
      this.hidden = true;
      for (const figure of this.figures) figure.setVisible(false);
      return;
    }
    this.hidden = false;

    // The scene clock rather than an accumulator of its own, so the shuffle
    // keeps the same phase relationship as every other beat in the HUD.
    const now = this.scene.time.now;

    for (const [index, figure] of this.figures.entries()) {
      // They arrive one at a time as the swell builds, so the doorway fills
      // rather than switching on — the same reason the tide itself eases in.
      const share = (index + 1) / CROWD;
      const presence = Math.min(intensity / share, 1);
      // `% 1` is not wrapping the sine, which is periodic anyway — it keeps the
      // argument small as `scene.time.now` climbs into the millions, so the bob
      // does not coarsen over a long run.
      const bob =
        Math.sin(((now / BOB_MS + index * BOB_STAGGER) % 1) * 2 * Math.PI) * BOB_PX;

      figure
        .setVisible(true)
        .setAlpha(MAX_ALPHA * presence)
        .setPosition(
          this.door + this.intoShop * index * HUDDLE,
          // Stood on the queue's own line, at the same height off it a child in
          // the line is drawn: they are the same children, one room back.
          this.footY + BODY_Y + bob,
        );
    }
  }
}
