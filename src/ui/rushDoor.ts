import type Phaser from 'phaser';

import { RUSH_CROWD, type RushMeter } from '../core/difficulty';
import { CHILD_TINT, HudDepth, makeSprite } from '../render/drawn';
import { TextureKey } from '../render/textures';
import { bodyY } from './customerView';
import { QUEUE_PITCH, type Frame } from './layout';

/**
 * The rush, telegraphed (design §7, §11): children gathering in the shop
 * doorway before the ones who count reach the window.
 *
 * The tide `core/difficulty.ts` runs from the one-minute mark is invisible on
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
 *
 * **It is the gauge as well as the telegraph, since the eleventh sitting.** The
 * chair asked three questions of the rush that a crowd fading in cannot answer —
 * *am I in one, does it end, when is the next* — and the reason it cannot is
 * that a rising crowd and a falling one look identical at any one moment. So it
 * is handed `Game.rushMeter` rather than `Game.rush`: a gauge that fills to
 * exactly the moment a rush starts, and drains to exactly the moment it ends.
 *
 * This is where those answers go rather than a bar somewhere on the HUD, and
 * that is measured rather than preferred. Design §11 puts announcements where
 * the player is already looking, and the free band under the hearts falls to
 * **16 px** on every phone held sideways (812×375, 736×414, 568×320) — so a new
 * widget would be fighting the one layout the plan already calls
 * over-subscribed, to say something at the far end of the screen from where it
 * is happening. The doorway is on the queue's own line, at the edge of the eye
 * that is steering, and it costs no geometry at all.
 */

/**
 * Enough to read as a crowd. More would not queue up outside the door — they
 * are placed back *into* the frame from the edge, so a fourth would stand
 * further across the line the waiting children are already on.
 *
 * Read from `core/difficulty.ts` rather than kept here, because the rule that
 * holds the window open is written in this number's units: `RUSH_FLOOR_FROM` is
 * `1 / RUSH_CROWD`, and it is the threshold the gauge's own edges are solved
 * against (`rushMeterAt`). So the doorway standing full and the window being
 * held open are one moment by construction, and a fourth figure kept here would
 * move the promise without moving the delivery — which is the exact drift the
 * floor exists to close.
 *
 * The tie is tighter than it was before the gauge, and worth stating as the
 * change it is: the door used to draw the raw intensity, so the *first* figure
 * landed on the moment the floor engaged and the other two said only "more".
 * Reading the gauge, all three land on it together.
 */
const CROWD = RUSH_CROWD;

/**
 * How tightly they stand, as a share of the queue's own pitch. Well under it on
 * purpose: a line at the queue's spacing is another queue, and what this has to
 * say is *crowd*. A share rather than a distance because the queue's step is
 * fitted to the lane (`layout.ts`'s `queueRun`) — a fixed huddle would read as a
 * crowd beside a roomy line and as one child beside a tight one.
 */
const HUDDLE_SHARE = 26 / QUEUE_PITCH;

/**
 * A silhouette rather than another child, *while the rush is still coming*.
 * They are behind the shop's own wall and are not waiting for anything yet, so
 * they never reach the presence of a customer at the window — which would read
 * as a queue of seven.
 */
const CALM_ALPHA = 0.5;

/**
 * And what they reach once the rush is actually on: through the wall, into the
 * room, wholly present.
 *
 * The step from one to the other is the whole of how this widget says *you are
 * in it now*, and it is carried by **value and position** because those are the
 * two channels design §4 leaves open — hue belongs to candies, and design §11
 * keeps prose off the play screen, so neither a colour nor the word is
 * available. Double the presence and a step forward is a large change at the
 * edge of vision, which is the only place this is ever read from.
 */
const RUSH_ALPHA = 1;

/**
 * How much further into the shop they stand once they are in it, as a share of
 * their own huddle. They came through the door, so they are past it — and half
 * a huddle is enough to read as movement without walking them into the back of
 * the queue, which is a whole `QUEUE_PITCH` away and drawn at full size.
 */
const STEP_IN = 0.5;

/**
 * How much of the gauge a figure takes to arrive or leave — and it is small on
 * purpose, because what this widget is being asked for is a **count**.
 *
 * The first cut ramped each figure across its whole share of the gauge, which
 * meant three figures at three different alphas for most of a cycle: at the
 * half mark, one solid, one at three quarters and one at a half. That is not a
 * crowd of two or of three, it is a smear, and a smear is not something an eye
 * taken off the strand for a fifth of a second can read. The chair's report was
 * that the doorway was too subtle, and this is the half of it that is not about
 * contrast at all — there was never a countable number up there.
 *
 * So a figure is at 0 or 1 for about ninety per cent of the gauge and crosses in
 * between, which at the grown shape is a second or two either way: quick enough
 * that the count is always crisp, slow enough that nobody pops into existence
 * (design §2's comfort constraint, and the same reason nothing else here cuts).
 */
const FADE = 0.06;

/**
 * The gauge reading at which figure `index` starts to arrive, while the crowd is
 * still gathering. Figure *n* is fully in at `(n + 1) / CROWD`, so the last of
 * them lands exactly as the gauge reaches 1 — which is exactly when the rush
 * starts, by construction (`rushMeterAt` solves its edges against
 * `RUSH_FLOOR_FROM`).
 */
const arrivesAt = (index: number): number => (index + 1) / CROWD - FADE;

/**
 * The earliest gauge reading that draws anything at all, so the guard in
 * `render` can say "nobody yet" without walking the crowd to find out.
 *
 * **Taken from `arrivesAt` rather than written out again**, which is the whole
 * point: the guard and the crowd have to agree about when the first figure is
 * due, and a second copy of that arithmetic would let them drift on any reshape
 * of the threshold — leaving a doorway that hid past the point somebody was
 * supposed to be standing in it, with nothing to catch it but this paragraph.
 */
const FIRST_IN = arrivesAt(0);

/**
 * The shuffle, and **it only runs while a rush does**.
 *
 * That is the whole of how this widget says *now*, and it is the channel the
 * file's own opening paragraph says to spend: a texture swap is invisible in
 * peripheral vision, and the doorway is only ever read peripherally, by an eye
 * that is steering. Motion is the one thing that survives out there.
 *
 * So the crowd **gathers still** and **moves once it is a rush**. Half a
 * silhouette's alpha and half a huddle of step were what the first cut spent,
 * and read from the corner of the eye they were not enough — the chair's report
 * was that the two states looked alike. Stillness against motion is a change
 * nobody has to be looking at to notice, and it costs no geometry.
 *
 * It is deliberately *this* way round rather than the reverse. Bobbing while
 * waiting and planting on arrival is the more literal reading of children in a
 * doorway, and it puts the loud channel on the quiet state: a lull would twitch
 * for thirty seconds and the rush would be the moment everything went still,
 * which is a signal the eye is built to ignore.
 *
 * Design §2's comfort constraint binds the numbers the way it binds the patience
 * alarm: a breath, not a blink. 1.4 Hz is well under anything that could read as
 * a strobe, and each figure keeps its own phase — three bobbing in lockstep is
 * one object, not a crowd.
 */
const BOB_MS = 700;
const BOB_PX = 7;
/** Enough of a period to keep them out of step, and not a neat fraction of it. */
const BOB_STAGGER = 0.37;

export class RushDoor {
  private readonly scene: Phaser.Scene;
  private readonly figures: Phaser.GameObjects.Image[];

  private footY = 0;
  private door = 0;
  /** How far off the standing line their heads are drawn — the queue's own. */
  private head = 0;
  private huddle = 0;
  /**
   * Which way is *into* the shop from the door: the queue's own pitch runs the
   * other way, from the window toward the door, so this is its negation.
   */
  private intoShop = 1;
  /**
   * So a doorway with nobody in it — the run's first minute, before the tide
   * exists at all, and the head of every lull after it — costs one comparison a
   * frame rather than three writes.
   *
   * It nearly stopped doing the second of those. A gauge *fills* through a lull
   * where the raw intensity this widget used to read sat flat at zero, so for
   * one revision the short-circuit fired on none of a 15-minute run's 42 999
   * frames past the preview mark, against 15 717 before. Making the crowd a
   * countable number rather than a fade gave **part** of it back — measured,
   * **5 490 frames, 12.8%** — because below `FIRST_IN` there is genuinely
   * nobody to draw, whatever the gauge reads. That is the first 27% of every
   * lull, which is `FIRST_IN` itself and is the honest ceiling on it: the rest
   * of a lull now has somebody standing in the doorway, and drawing them is the
   * point rather than a cost.
   *
   * The cycles are not why it is here. 5 490 skipped frames at 26 ns is 0.14 ms
   * across a fifteen-minute run, which is nothing; the guard earns its place by
   * saying that an empty doorway is a state rather than a crowd of nobody.
   *
   * Starts `false` against sprites built invisible, deliberately: the first
   * calm frame then does one redundant pass and leaves the two agreeing, where
   * starting `true` would trust a claim nothing had established.
   */
  private hidden = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // Sized in `applyFrame` with everything else about them: the doorway is
    // never drawn before the first layout pass has said how big a child is.
    this.figures = Array.from({ length: CROWD }, () =>
      makeSprite(scene, TextureKey.Customer, CHILD_TINT, HudDepth.Doorway, {
        x: 0,
        y: 0,
      }).setVisible(false),
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
    this.head = bodyY(queue.scale);
    this.huddle = Math.round(Math.abs(queue.pitch) * HUDDLE_SHARE);
    for (const figure of this.figures) figure.setScale(queue.scale);
  }

  /**
   * Draws the crowd at `meter`, the tide's own gauge (`Game.rushMeter`).
   *
   * One run of figures, read two ways. **Filling**, they arrive one at a time
   * as the gauge climbs, so the doorway is full at the instant the rush starts;
   * **running**, they are lit and moving, and leave one at a time as the gauge
   * drains, so the doorway is empty at the instant it ends.
   *
   * The two directions walk **different** ladders — `arrivesAt` gathering,
   * `index / CROWD` running — and that is what makes the count line up rather
   * than something to be corrected for. Read across the boundary at a full
   * gauge both ladders show three, so the crowd does not flicker at the one
   * moment the player is being told something; all that changes there is that
   * they start moving.
   *
   * The ladder is also the promise this widget makes and `difficulty.ts` keeps.
   * `RUSH_CROWD` is read from there rather than kept here because the floor
   * under the window is defined in this number's units (`RUSH_FLOOR_FROM`), and
   * the gauge is solved against that same threshold — so a doorway that is full
   * and a window that is being held open are, by construction, the same moment.
   *
   * Nothing is cached across a resize: while the doorway is showing, every
   * figure is placed from `door` and `footY` again each frame, so a device
   * turned mid-rush is already drawing against the new frame on the next one.
   * That is the trap the plan records for HUD effects — a pooled board effect
   * rides its container, and a HUD one is aimed at coordinates `applyFrame`
   * invalidates — sidestepped by never holding a position between frames.
   */
  render(meter: RushMeter): void {
    const { on, fill } = meter;
    // Nothing to draw until the first figure is due, and never while a rush is
    // running: a rush down to its last figure is still a rush, and hiding it a
    // frame early would take the doorway down before the bell says it is over.
    if (!on && fill < FIRST_IN) {
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
      // One figure per step of the gauge, arriving and leaving one at a time.
      //
      // **The two states step at different marks, and that is what lines the
      // ends up.** Gathering, they arrive on `arrivesAt`'s ladder, whose last
      // rung is the gauge reaching 1. Running, a figure stays while the gauge is
      // over `n / CROWD`, so the crowd goes 3, 2, 1 as the rush spends itself
      // and the doorway is empty as it ends.
      //
      // Read across the boundary the count does not jump: a full doorway
      // gathering becomes a full doorway rushing, and the only thing that
      // changes at that instant is that they start moving.
      const lo = on ? index / CROWD : arrivesAt(index);
      const presence = Math.min(Math.max((fill - lo) / FADE, 0), 1);
      // Still until the rush is actually on (`BOB_MS`). `% 1` is not wrapping
      // the sine, which is periodic anyway — it keeps the argument small as
      // `scene.time.now` climbs into the millions, so the bob does not coarsen
      // over a long run.
      const bob = on
        ? Math.sin(((now / BOB_MS + index * BOB_STAGGER) % 1) * 2 * Math.PI) * BOB_PX
        : 0;

      figure
        .setVisible(true)
        .setAlpha((on ? RUSH_ALPHA : CALM_ALPHA) * presence)
        .setPosition(
          this.door + this.intoShop * (index + (on ? STEP_IN : 0)) * this.huddle,
          // Stood on the queue's own line, at the same height off it a child in
          // the line is drawn: they are the same children, one room back.
          this.footY + this.head + bob,
        );
    }
  }
}
