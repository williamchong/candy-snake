import type Phaser from 'phaser';

import { SHELF_SLOTS } from '../core/shelf';
import type { Candy } from '../core/types';
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
} from '../render/drawn';
import { TextureKey } from '../render/textures';
import type { Frame } from './layout';

/**
 * The candy cache, drawn as a run of slots beside the board and level with the
 * bench. The rack has to sit on the same wall the block cuts against, or the
 * player makes candy at one edge of the board and hunts for where it went at
 * another — bench, rack and queue read down one side (design §10).
 *
 * Which way the run goes, and how big a slot is, both come from the layout: on
 * a phone held sideways six slots at the desktop pitch would run off the bottom
 * of the screen, and turned upright the rack lies on its side under the board.
 */

/** The slot size the candy sprite is sized against — the roomiest the rack gets. */
const BASE_SLOT = 40;

interface Slot {
  readonly box: Phaser.GameObjects.Rectangle;
  readonly candy: Drawn;
}

export class ShelfStrip {
  private readonly slots: readonly Slot[];
  /** The shelf the slots currently show — see `render`. */
  private drawn: readonly Candy[] | undefined;

  constructor(scene: Phaser.Scene) {
    // Built off-screen at a placeholder size; `applyFrame` is what puts them
    // anywhere, and it runs before the first frame is drawn.
    this.slots = Array.from({ length: SHELF_SLOTS }, () => ({
      box: scene.add
        .rectangle(0, 0, BASE_SLOT, BASE_SLOT)
        // An empty slot is chrome, and chrome in this kitchen is one color.
        .setStrokeStyle(CHROME_WIDTH, BORDER)
        .setDepth(HudDepth.Slot),
      candy: makeDrawn(
        scene,
        { key: TextureKey.Candy, depth: HudDepth.Icon, glyphDepth: HudDepth.Glyph },
        { x: 0, y: 0 },
      ),
    }));
  }

  /** Lays the run out along the axis the frame asks for, at the size it asks for. */
  applyFrame(frame: Frame): void {
    const { at, pitch, axis, slot } = frame.hud.shelf;
    // The candy shrinks with the slot it sits in, symbol and all — a glyph that
    // kept its desktop size would break out of a phone-sized frame.
    const ratio = slot / BASE_SLOT;

    this.slots.forEach(({ box, candy }, index) => {
      const step = index * pitch;
      const x = axis === 'column' ? at.x : at.x + step;
      const y = axis === 'column' ? at.y + step : at.y;

      box.setPosition(x, y).setSize(slot, slot);
      scaleDrawn(candy, ratio);
      place(candy, x, y);
    });
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
}
