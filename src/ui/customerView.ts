import type Phaser from 'phaser';

import { colorInfo } from '../core/colors';
import { patienceFraction } from '../core/customers';
import { RAW, type ColorMask, type Customer } from '../core/types';
import {
  BORDER,
  CHILD_TINT,
  GLYPH_TINT,
  HudDepth,
  makeDrawn,
  makeSprite,
  paint,
  PANEL_FILL,
  place,
  show,
  type Drawn,
} from '../render/drawn';
import type { Burst } from '../render/effects';
import { TEXTURE_SIZE, TextureKey } from '../render/textures';

/**
 * One child at the serving window: they walk in from off-screen, stand in line
 * holding up the candy they came for, and walk off again — smiling if they got
 * it, cross if they gave up (design §5).
 *
 * Everything the card used to say in symbols is said by the character instead:
 * the order is a bubble over their head, the clock is a bar at their feet *and*
 * the look on their face. Nothing here is written in words, because the queue
 * is the one part of the HUD a player reads mid-turn, with no time to read.
 */

export const Mood = {
  Waiting: 'waiting',
  Impatient: 'impatient',
  Served: 'served',
  Walkout: 'walkout',
} as const;
export type Mood = (typeof Mood)[keyof typeof Mood];

const FACES: Record<Mood, TextureKey> = {
  [Mood.Waiting]: TextureKey.FaceCalm,
  [Mood.Impatient]: TextureKey.FaceWorried,
  [Mood.Served]: TextureKey.FaceHappy,
  [Mood.Walkout]: TextureKey.FaceCross,
};

/**
 * Bigger than the board's 2×, because a face is the whole point of this sprite
 * and the queue is what the player glances at rather than steers by.
 */
export const CHILD_SCALE = 3;
/** How tall a child is drawn — what anything standing one on the line needs. */
export const CHILD_HEIGHT = TEXTURE_SIZE * CHILD_SCALE;

/** The bubble is a panel like any other, and reads against the same ground. */
const BUBBLE_TINT = PANEL_FILL;

/**
 * Rows above the standing line, in screen pixels. `BODY_Y` is exported because
 * the doorway crowd stands on the same line and must not drift off it
 * (`ui/rushDoor.ts`) — they are the same children, one room back.
 */
export const BODY_Y = -CHILD_HEIGHT / 2;
const BUBBLE_Y = -CHILD_HEIGHT - 18;
/** The bubble's tail eats its bottom rows, so its hollow sits above centre. */
const CANDY_Y = BUBBLE_Y - 5;
const BAR_Y = 12;

const BAR_WIDTH = 34;
const BAR_HEIGHT = 5;

/** Below this much patience left the face gives it away before the bar does. */
const IMPATIENT_AT = 0.4;

/**
 * The last-call stage, and the one thing here counted in seconds rather than in
 * bar: the ramp takes patience from 35 s down to 22 s, so a fraction would
 * shrink the warning exactly as the game speeds up. What the player is deciding
 * is whether they can still get there, which is a question in seconds.
 *
 * `patienceFraction` is untouched by this on purpose — the bar and the score
 * bonus read it together (design §9), so the alarm reads the clock beside it
 * and never changes what a serve pays.
 */
const CRITICAL_MS = 5_000;

/**
 * The alarm, as a breath rather than a blink: design §2 asks for soft and slow,
 * and design §11 has the queue read in glances taken from steering — where a
 * texture swap is invisible and motion is not. Only the child actually inside
 * the window breathes; four at once would be noise rather than urgency.
 */
const BREATH_MS = 800;
const BREATH_AMOUNT = 0.12;

const WALK_SPEED = 260;
/** How long a step lasts, i.e. half a walk cycle. */
const STEP_MS = 140;
/** A beat to read the face on before they turn and go. */
const REACTION_MS = 500;

/**
 * How far a child on their way out steps clear of the line. The queue closes up
 * the moment someone is off it, so a leaver who kept the line's own lane would
 * be walked through by whoever is moving up; out of line and in front of it
 * (`HudDepth.Leaving*`) is how a crowd reads.
 */
const LEAVING_LANE = 22;

export class CustomerView {
  private readonly scene: Phaser.Scene;
  private readonly body: Phaser.GameObjects.Image;
  private readonly face: Phaser.GameObjects.Image;
  private readonly bubble: Phaser.GameObjects.Image;
  private readonly want: Drawn;
  private readonly barTrack: Phaser.GameObjects.Rectangle;
  private readonly barFill: Phaser.GameObjects.Rectangle;
  /** The queue's send-off pool, shared by every child it ever builds. */
  private readonly cheers: Burst;

  /** The standing line: every child in the queue has their feet on it. */
  private footY: number;
  /**
   * Where a child is before they arrive and after they go: past the frame's own
   * edge, so nobody is ever seen to pop into or out of existence. They come from
   * the same side they leave by — the far end of the queue is the shop door, and
   * the near end is the window, so the line always faces the counter. Which edge
   * that is depends on the layout, so it is handed in rather than fixed.
   */
  private offstage: number;
  private x: number;
  private targetX: number;
  /** How far below the line they stand: nothing until they step out of it. */
  private lane = 0;
  private mood: Mood = Mood.Waiting;
  private pauseMs = 0;
  private leaving = false;
  /** Off the far edge and done with — the queue may hand this view out again. */
  private done = true;
  /** Whole pixels of bar drawn, so a sub-pixel drain writes nothing. */
  private shownBarWidth = -1;
  /** Down to the last seconds: the bubble breathes until they are served or go. */
  private alarmed = false;
  /** Whether the bubble is off its resting size, so settling it writes once. */
  private breathing = false;
  /** Which half of the walk cycle is on screen — see `draw`. */
  private stepping = false;
  /**
   * Whether this child's send-off has already been thrown. Reset in `arrive`
   * along with everything else that outlives one child: views are handed out
   * again, and a latch left set means the *next* child served by this one gets
   * no party at all — silently, with nothing to catch it.
   */
  private cheered = false;
  /** What they asked for, kept so the send-off can be thrown in that color. */
  private wanted: ColorMask = RAW;

  constructor(scene: Phaser.Scene, footY: number, offstage: number, cheers: Burst) {
    this.scene = scene;
    this.cheers = cheers;
    this.footY = footY;
    this.offstage = offstage;
    this.x = offstage;
    this.targetX = offstage;

    // Everything is born off-screen at the same scale, so the four sprites
    // differ only in what they are and where they sit in the stack.
    const off = { x: offstage, y: footY };
    const sprite = (
      key: TextureKey,
      tint: number,
      depth: number,
    ): Phaser.GameObjects.Image => makeSprite(scene, key, tint, depth, off, CHILD_SCALE);

    this.bubble = sprite(TextureKey.Bubble, BUBBLE_TINT, HudDepth.Slot);
    this.want = makeDrawn(
      scene,
      { key: TextureKey.Candy, depth: HudDepth.Icon, glyphDepth: HudDepth.Glyph },
      off,
    );
    this.body = sprite(TextureKey.Customer, CHILD_TINT, HudDepth.Icon);
    // Tinted like the skin it sits on: the features are drawn in the detail
    // gray, so the same tint lands them a step darker than the face.
    this.face = sprite(FACES[Mood.Waiting], CHILD_TINT, HudDepth.Glyph);

    this.barTrack = scene.add
      .rectangle(off.x, footY + BAR_Y, BAR_WIDTH, BAR_HEIGHT, BORDER)
      .setDepth(HudDepth.Icon);
    // Anchored at its left edge, so draining shortens it rather than shrinking
    // it toward the middle.
    this.barFill = scene.add
      .rectangle(off.x, footY + BAR_Y, BAR_WIDTH, BAR_HEIGHT, GLYPH_TINT)
      .setOrigin(0, 0.5)
      .setDepth(HudDepth.Glyph);

    this.hide();
  }

  /** Free to be handed to the next child — see `CustomerQueue`. */
  get isDone(): boolean {
    return this.done;
  }

  /**
   * The screen changed shape under them. The standing line and the door both
   * move, and a child already walking out was headed for an edge that may now
   * be in the middle of the screen — so their exit is re-aimed at the new one.
   * Where they stand in the line is not set here: `CustomerQueue.render` walks
   * everyone to their slot every frame, so they slide across rather than jump.
   */
  relocate(footY: number, offstage: number): void {
    const leftFor = this.offstage;
    this.footY = footY;
    this.offstage = offstage;

    if (this.targetX === leftFor) this.targetX = offstage;
    if (this.done) this.x = offstage;

    // The patience bar hangs off the standing line rather than off the walk, so
    // nothing would move it until the next arrival without this.
    this.draw(this.stepping);
  }

  /** A child walks on from off-screen and heads for their place in line. */
  arrive(customer: Customer, slotX: number): void {
    this.done = false;
    this.leaving = false;
    this.pauseMs = 0;
    this.lane = 0;
    this.x = this.offstage;
    this.targetX = slotX;
    this.shownBarWidth = -1;
    this.alarmed = false;
    this.cheered = false;
    this.wanted = customer.want;
    this.body.setDepth(HudDepth.Icon);
    this.face.setDepth(HudDepth.Glyph);

    this.setMood(Mood.Waiting);
    paint(this.want, customer.want);
    this.bubble.setVisible(true);
    show(this.want, true);
    this.body.setVisible(true);
    this.face.setVisible(true);

    this.render(customer);
  }

  /** The queue moved up: walk to the new place rather than jumping to it. */
  moveTo(slotX: number): void {
    if (!this.leaving) this.targetX = slotX;
  }

  /** What the clock is doing, in the two places it shows: bar and face. */
  render(customer: Customer): void {
    const { patience } = customer;
    // An opening-level child has no clock at all, so they show no bar rather
    // than a full one that never moves, and never look worried (design §7).
    const ticking = patience !== undefined;
    this.barTrack.setVisible(ticking);
    this.barFill.setVisible(ticking);
    if (patience === undefined) return;

    const left = patienceFraction(patience);
    this.setMood(left <= IMPATIENT_AT ? Mood.Impatient : Mood.Waiting);
    // Two stages, deliberately measured against two different things: the face
    // turns at a fraction of the bar, the alarm at a count of seconds.
    this.alarmed = patience.remainingMs <= CRITICAL_MS;

    // 34 px over 35 s is a pixel a second, so all but one frame in sixty would
    // redraw the identical bar.
    const width = Math.round(BAR_WIDTH * left);
    if (width === this.shownBarWidth) return;

    this.shownBarWidth = width;
    this.barFill.setDisplaySize(width, BAR_HEIGHT);
  }

  /**
   * Served or walked out: the face says which, holds it long enough to read,
   * and then they leave. The bubble goes at once either way — whatever they
   * came for, they are no longer asking for it. No mood keeps the face they
   * were wearing, for a send-off nobody told us the reason for.
   */
  leave(mood?: Mood): void {
    if (mood !== undefined) this.setMood(mood);
    this.leaving = true;
    // Whatever they were waiting on is settled, one way or the other.
    this.alarmed = false;
    this.pauseMs = REACTION_MS;
    this.bubble.setVisible(false);
    show(this.want, false);
    this.barTrack.setVisible(false);
    this.barFill.setVisible(false);
    this.body.setDepth(HudDepth.LeavingIcon);
    this.face.setDepth(HudDepth.LeavingGlyph);
  }

  /**
   * Walks whatever distance this frame allows. Motion is stepped by hand
   * rather than tweened because the two-frame walk and the bob have to run off
   * the same fact — that the child is actually moving — and a tween would own
   * that on its own clock.
   */
  step(dtMs: number): void {
    if (this.done) return;

    // The send-off waits until they have reached their place, so a child served
    // the instant they walk up — off a rack that already held their candy — is
    // still seen to walk up. The reaction beat then doubles as the step out of
    // the line: by the time the face has been read they are clear of the slot
    // the next child is walking into, and in front of it.
    if (this.pauseMs > 0 && this.x === this.targetX) {
      // The send-off waits for them to walk up, so the confetti waits with it:
      // a child served the instant they arrive is still off the frame's edge
      // on the move the event lands, and a burst thrown there is thrown
      // off-screen.
      if (!this.cheered && this.mood === Mood.Served) {
        this.cheered = true;
        this.cheers.fire(
          { x: this.x, y: this.footY + BUBBLE_Y },
          colorInfo(this.wanted).hex,
        );
      }
      this.pauseMs -= dtMs;
      this.lane = LEAVING_LANE * Math.min(1 - this.pauseMs / REACTION_MS, 1);
      if (this.pauseMs <= 0) this.targetX = this.offstage;
      this.draw(false);
      return;
    }

    const stride = (WALK_SPEED * dtMs) / 1_000;
    const gap = this.targetX - this.x;
    const walking = Math.abs(gap) > stride;
    this.x = walking ? this.x + Math.sign(gap) * stride : this.targetX;

    this.draw(walking);
    if (!walking && this.leaving && this.pauseMs <= 0) this.hide();
  }

  private setMood(mood: Mood): void {
    if (mood === this.mood) return;

    this.mood = mood;
    this.face.setTexture(FACES[mood]);
  }

  /**
   * Legs and a one-pixel bob, both off the same scene clock so a queue of
   * children walking at once steps in time rather than each on its own phase.
   */
  private draw(walking: boolean): void {
    const stepping = walking && Math.floor(this.scene.time.now / STEP_MS) % 2 === 1;
    // Guarded: a swap costs a texture lookup and a re-origin, and a child
    // standing in line holds the same frame for as long as they wait.
    if (stepping !== this.stepping) {
      this.stepping = stepping;
      this.body.setTexture(stepping ? TextureKey.CustomerStride : TextureKey.Customer);
    }

    // Whole pixels: the standing line is drawn art, and half a pixel of lane
    // would soften the one sprite the player is meant to read a face off.
    const floor = this.footY + Math.round(this.lane) + (stepping ? -1 : 0);
    this.body.setPosition(this.x, floor + BODY_Y);
    this.face.setPosition(this.x, floor + BODY_Y);
    this.bubble.setPosition(this.x, floor + BUBBLE_Y);
    this.breathe();
    place(this.want, this.x, floor + CANDY_Y);
    this.barTrack.setPosition(this.x, this.footY + BAR_Y);
    this.barFill.setPosition(this.x - BAR_WIDTH / 2, this.footY + BAR_Y);
  }

  /**
   * The last-seconds alarm: the bubble swells and settles, off the same scene
   * clock the walk cycle uses, so a row of children in trouble breathes in time
   * rather than each on its own phase.
   *
   * The bubble alone, and not what is inside it: the candy is the order the
   * player has to read off a glance, so it stays still and crisp while the
   * bubble moves around it.
   */
  private breathe(): void {
    if (!this.alarmed) {
      // The one write that settles it, on the frame the alarm ends and no
      // other. `breathing` is true exactly when the bubble is off its resting
      // size, so a view handed to the next child cannot inherit a swollen one.
      if (!this.breathing) return;

      this.breathing = false;
      this.bubble.setScale(CHILD_SCALE);
      return;
    }

    // Swells from the resting size and settles back to it, rather than either
    // side of it: a bubble that spends half the alarm *smaller* than normal
    // reads as receding, which is the opposite of what it is for.
    const phase = 1 - Math.cos((this.scene.time.now / BREATH_MS) * Math.PI * 2);
    this.breathing = true;
    this.bubble.setScale(CHILD_SCALE * (1 + (BREATH_AMOUNT * phase) / 2));
  }

  private hide(): void {
    this.done = true;
    this.leaving = false;
    this.bubble.setVisible(false);
    show(this.want, false);
    this.body.setVisible(false);
    this.face.setVisible(false);
    this.barTrack.setVisible(false);
    this.barFill.setVisible(false);
  }
}
