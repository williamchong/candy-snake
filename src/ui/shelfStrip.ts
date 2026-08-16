import type Phaser from 'phaser';

import { SHELF_SLOTS } from '../core/shelf';
import type { Candy, ColorMask } from '../core/types';
import {
  BORDER,
  CHROME_WIDTH,
  HudDepth,
  makeDrawn,
  paint,
  place,
  scaleDrawn,
  show,
  type Drawn,
  type DrawnConfig,
} from '../render/drawn';
import { TextureKey } from '../render/textures';
import type { Frame } from './layout';

/**
 * The candy cache, drawn as a run of slots beside the board and under the
 * serving window. The rack has to sit on the same wall the block cuts against,
 * or the player makes candy at one edge of the board and hunts for where it
 * went at another — bench, child and rack read down one side (design §10).
 *
 * Which way the run goes, and how big a slot is, both come from the layout: on
 * a phone held sideways six slots at the desktop pitch would run off the bottom
 * of the screen, and turned upright the rack lies on its side under the board.
 */

/** The slot size the candy sprite is sized against — the roomiest the rack gets. */
const BASE_SLOT = 40;

/**
 * The same candy on two layers: one racked, one on its way off. Spelled out
 * side by side because the layer is the whole difference — a tossed candy flies
 * over the slots, and sharing `Icon` with them would leave which is on top to
 * display-list insertion order.
 */
const RACKED: DrawnConfig = {
  key: TextureKey.Candy,
  depth: HudDepth.Icon,
  glyphDepth: HudDepth.Glyph,
};
const FLYING: DrawnConfig = {
  key: TextureKey.Candy,
  depth: HudDepth.TossedIcon,
  glyphDepth: HudDepth.TossedGlyph,
};

/**
 * The toss: how far a stale candy rises out of the rack, and how long it takes
 * to go. Up rather than sideways, because the rack runs one way beside the board
 * and the other way beneath it, and up is off the rack in both — the layout never
 * has to say which end is the open one.
 */
const TOSS_RISE = 14;
const TOSS_MS = 320;
const TOSS_GROWTH = 1.2;
/**
 * One move can overflow a full rack once per severed piece in flight
 * (`consumeSevered`), and every one of those candies leaves the *same* slot — so
 * without a stagger they fly the same path at the same moment and several losses
 * read as one. Each waits on the ones already in the air instead, and the rack is
 * seen to shed them one by one.
 *
 * Capped, because the wait is not free: the drain is one candy per stagger, and
 * two long batches coming apart over a full rack deliver faster than that. Left
 * uncapped the queue only grows, and the last candy would fly seconds after the
 * loss it stands for. Past the cap they double up, which is the right thing to
 * lose first — a cascade still reads as several.
 */
const TOSS_STAGGER_MS = 70;
const TOSS_STAGGER_MAX = 3;

interface Slot {
  readonly box: Phaser.GameObjects.Rectangle;
  readonly candy: Drawn;
}

/**
 * A pooled candy for the toss, and whether it is spoken for. Claimed by this
 * flag rather than by visibility (which is how `ShardBurst` claims a puff): one
 * waiting out its stagger is deliberately not on screen yet, and would otherwise
 * be taken out from under itself by the next loss.
 */
interface Toss {
  readonly candy: Drawn;
  busy: boolean;
}

export class ShelfStrip {
  private readonly scene: Phaser.Scene;
  private readonly slots: readonly Slot[];
  /** The shelf the slots currently show — see `render`. */
  private drawn: readonly Candy[] | undefined;
  /**
   * Candies in mid-air, on their way off the rack. Pooled for the same reason
   * `ShardBurst` pools its puffs: several can be lost off one move, so they
   * overlap, and a game object per loss is the churn a pool exists to avoid.
   */
  private readonly tossed: Toss[] = [];
  /** How far the rack is currently shrunk, so a tossed candy matches it. */
  private ratio = 1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // Built off-screen at a placeholder size; `applyFrame` is what puts them
    // anywhere, and it runs before the first frame is drawn.
    this.slots = Array.from({ length: SHELF_SLOTS }, () => ({
      box: scene.add
        .rectangle(0, 0, BASE_SLOT, BASE_SLOT)
        // An empty slot is chrome, and chrome in this kitchen is one color.
        .setStrokeStyle(CHROME_WIDTH, BORDER)
        .setDepth(HudDepth.Slot),
      candy: makeDrawn(scene, RACKED, { x: 0, y: 0 }),
    }));
  }

  /** Lays the run out along the axis the frame asks for, at the size it asks for. */
  applyFrame(frame: Frame): void {
    const { at, pitch, axis, slot } = frame.hud.shelf;
    // The candy shrinks with the slot it sits in, symbol and all — a glyph that
    // kept its desktop size would break out of a phone-sized frame.
    this.ratio = slot / BASE_SLOT;

    this.slots.forEach(({ box, candy }, index) => {
      const step = index * pitch;
      const x = axis === 'column' ? at.x : at.x + step;
      const y = axis === 'column' ? at.y + step : at.y;

      box.setPosition(x, y).setSize(slot, slot);
      scaleDrawn(candy, this.ratio);
      place(candy, x, y);
    });

    // A toss is aimed at the rack it left, and that rack has just moved. The
    // slots slide across (`CustomerQueue` does the same); a candy in mid-air has
    // nothing left to slide *from*, so it is cut rather than stranded at
    // coordinates that no longer mean anything. `Scale.RESIZE` fires this on
    // every frame of a window drag, so the cheap thing is also the right one.
    this.clearTosses();
  }

  /**
   * Oldest first, which is the order the core keeps the shelf in (design §5).
   *
   * The core replaces the whole shelf array whenever a candy is racked, so an
   * unchanged reference means an unchanged shelf — and re-stamping six glyph
   * textures every frame to draw the same six candies is pure waste.
   */
  render(shelf: readonly Candy[]): void {
    if (shelf === this.drawn) return;
    this.drawn = shelf;

    this.slots.forEach(({ candy }, index) => {
      const held = shelf[index];
      show(candy, held !== undefined);
      if (held !== undefined) paint(candy, held.color);
    });
  }

  /**
   * A full rack pushed its oldest candy off (design §5). It leaves the way it
   * was lost — visibly — so that a rack overflowing reads as a cost rather than
   * as six candies silently becoming six other candies.
   *
   * The event carries only a color, which is all it needs to: the shelf always
   * discards oldest-first, so the candy that went is always the one that was in
   * the first slot. It flies as a sprite of its own, over a rack that `render`
   * will have redrawn shifted along by the end of the frame.
   */
  toss(color: ColorMask): void {
    // `SHELF_SLOTS` is a constant 6, so this is `noUncheckedIndexedAccess`
    // being satisfied rather than a case that can happen.
    const from = this.slots[0]?.box;
    if (from === undefined) return;

    const { flying, waiting } = this.claim(from);
    flying.busy = true;

    const { candy } = flying;
    const { image, glyph } = candy;
    paint(candy, color);
    scaleDrawn(candy, this.ratio);
    place(candy, from.x, from.y);
    image.setAlpha(1);
    glyph?.setAlpha(1);
    // Not shown until it is actually its turn: a candy parked on slot 0 through
    // its stagger would be covering the *next* candy, which by then is a
    // different one — and the rack is the one thing here drawn purely from
    // state.
    show(candy, false);

    // The pair is tweened as a pair, so the symbol never separates from the
    // candy it names (design §4). Same shape as the board's puff: whatever is
    // lost rises, swells and thins out.
    this.scene.tweens.add({
      targets: glyph === undefined ? [image] : [image, glyph],
      y: from.y - TOSS_RISE,
      alpha: 0,
      scale: (target: Phaser.GameObjects.Image) => target.scale * TOSS_GROWTH,
      duration: TOSS_MS,
      delay: Math.min(waiting, TOSS_STAGGER_MAX) * TOSS_STAGGER_MS,
      ease: 'Quad.easeOut',
      onStart: () => show(candy, true),
      onComplete: () => {
        show(candy, false);
        flying.busy = false;
      },
    });
  }

  /**
   * A free candy to fly, plus how many are already spoken for — the stagger this
   * one has to wait out. One pass, because the two answers come off the same
   * walk and this runs on an event rather than on a frame.
   */
  private claim(from: Phaser.GameObjects.Rectangle): { flying: Toss; waiting: number } {
    let free: Toss | undefined;
    let waiting = 0;

    for (const entry of this.tossed) {
      if (entry.busy) waiting += 1;
      else free ??= entry;
    }

    if (free === undefined) {
      free = {
        candy: makeDrawn(this.scene, FLYING, { x: from.x, y: from.y }),
        busy: false,
      };
      this.tossed.push(free);
    }

    return { flying: free, waiting };
  }

  /** Takes every toss out of the air at once — see `applyFrame`. */
  private clearTosses(): void {
    for (const entry of this.tossed) {
      if (!entry.busy) continue;

      const { image, glyph } = entry.candy;
      // Killing a tween does not run its `onComplete`, so the tidying up that
      // one would have done is done here instead.
      this.scene.tweens.killTweensOf(glyph === undefined ? [image] : [image, glyph]);
      show(entry.candy, false);
      entry.busy = false;
    }
  }
}
