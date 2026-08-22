import type Phaser from 'phaser';

import { BORDER, GLYPH_TINT, HudDepth } from '../render/drawn';
import { COMBO_PIP, COMBO_PIPS, type Frame } from './layout';

/**
 * How long the lit run stays up before it starts to go. A batch drains one
 * candy per move, and a move is 125–200 ms across the whole speed ladder
 * (`difficulty.ts`'s rungs), so four candies land inside 800 ms at the very
 * slowest. Two seconds therefore holds the *whole* batch's run on screen and
 * still clears well before the next batch could reach the bench.
 */
const HOLD_MS = 2_000;
/**
 * And how long it takes to go once it starts. Long enough to read as a breath
 * rather than a blink (design §2) — the HUD is meant to feel like a kitchen
 * settling, not a scoreboard blanking.
 */
const FADE_MS = 600;

/**
 * The combo meter: one pip per child fed straight off the same chopped batch
 * (design §9). It is the drawn half of the batching bonus — the points land in
 * the score either way, but a flat term buried in a number that also carries
 * the tier, the patience bonus and the streak multiplier is a term nobody can
 * see themselves earning. The pips are what make it a mechanic rather than
 * arithmetic.
 *
 * Drawn, never written: design §11 keeps prose out of the HUD, and the score is
 * the only text on it. Four marks lighting left to right say "that batch fed
 * three children" without a word, and say it in the same visual language the
 * hearts beside them already use.
 *
 * It shows nothing at rest. A meter parked at zero all run would be a fifth
 * fixed thing on a HUD that is already full, and — worse — would read as a
 * gauge the player was failing to fill rather than as a reward that arrives.
 * So it lights, holds long enough to read, breathes out and goes.
 */
export class ComboMeter {
  private readonly tracks: Phaser.GameObjects.Rectangle[];
  private readonly fills: Phaser.GameObjects.Rectangle[];
  /**
   * The hold-and-fade in flight, kept so the next serve can cut it short —
   * `boardView`'s head flash keeps its own tween for the same reason. A batch
   * feeding four children shows one run climbing, not four ramps overlapping.
   */
  private breath?: Phaser.Tweens.Tween;

  constructor(private readonly scene: Phaser.Scene) {
    // Built at the origin and put somewhere by `applyFrame`, the way every
    // other widget in this directory is.
    const run = (color: number, depth: number): Phaser.GameObjects.Rectangle[] =>
      Array.from({ length: COMBO_PIPS }, () =>
        scene.add
          .rectangle(0, 0, COMBO_PIP, COMBO_PIP, color)
          .setDepth(depth)
          .setAlpha(0),
      );

    this.tracks = run(BORDER, HudDepth.ComboTrack);
    this.fills = run(GLYPH_TINT, HudDepth.ComboPip);
  }

  applyFrame(frame: Frame): void {
    const { at, pitch } = frame.hud.combo;

    // Both runs walk the same step, so the fill lands on its own track however
    // the screen has moved underneath them. Position only, so a resize mid-
    // breath has nothing to say to the tween running over alpha.
    [this.tracks, this.fills].forEach((marks) =>
      marks.forEach((mark, index) => mark.setPosition(at.x + index * pitch, at.y)),
    );
  }

  /**
   * A child was served off a batch that had already fed `combo - 1` others.
   * Lights that many pips at full strength and starts the breath over.
   *
   * The whole meter rides the fade, unlit slots included: what is left of the
   * run is what was left of the batch. Clamped at `COMBO_PIPS` rather than
   * asserted — the window's ceiling is what sets the pip count, and a rule
   * change that raised it should cost a full meter, not a crash.
   */
  play(combo: number): void {
    if (combo <= 0) return;

    this.breath?.stop();

    const lit = Math.min(combo, COMBO_PIPS);
    this.tracks.forEach((track) => track.setAlpha(1));
    this.fills.forEach((fill, index) => fill.setAlpha(index < lit ? 1 : 0));

    // The dark fills are left out of the ramp rather than faded from nothing:
    // a target already at 0 has nowhere to go.
    this.breath = this.scene.tweens.add({
      targets: [...this.tracks, ...this.fills.slice(0, lit)],
      alpha: 0,
      delay: HOLD_MS,
      duration: FADE_MS,
      ease: 'Quad.easeOut',
    });
  }
}
