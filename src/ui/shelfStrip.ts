import type Phaser from 'phaser';

import { SHELF_SLOTS } from '../core/shelf';
import type { Candy, Vec2 } from '../core/types';
import { BORDER, makeDrawn, paint, show, type Drawn } from '../render/drawn';
import { TextureKey } from '../render/textures';

/**
 * The candy cache, drawn as a column of slots beside the board and level with
 * the bench. The rack has to sit on the same wall the block cuts against, or
 * the player makes candy at one edge of the board and hunts for where it went
 * at another — bench, rack and queue read down one side (design §10).
 */
const SLOT_SIZE = 40;
const SLOT_BORDER_WIDTH = 2;
const SHELF_PITCH = 44;

export class ShelfStrip {
  private readonly slots: Drawn[] = [];
  /** The shelf the slots currently show — see `render`. */
  private drawn: readonly Candy[] | undefined;

  constructor(scene: Phaser.Scene, at: Vec2) {
    for (let slot = 0; slot < SHELF_SLOTS; slot += 1) {
      const centre = { x: at.x, y: at.y + slot * SHELF_PITCH };

      scene.add
        .rectangle(centre.x, centre.y, SLOT_SIZE, SLOT_SIZE)
        // An empty slot is chrome, and chrome in this kitchen is one color.
        .setStrokeStyle(SLOT_BORDER_WIDTH, BORDER)
        .setDepth(0);

      this.slots.push(
        makeDrawn(scene, { key: TextureKey.Candy, depth: 1, glyphDepth: 2 }, centre),
      );
    }
  }

  /**
   * Oldest at the top, which is the order the core keeps the shelf in
   * (design §5).
   *
   * The core replaces the whole shelf array whenever a candy is racked, so an
   * unchanged reference means an unchanged shelf — and re-stamping six glyph
   * textures every frame to draw the same six candies is pure waste.
   */
  render(shelf: readonly Candy[]): void {
    if (shelf === this.drawn) return;
    this.drawn = shelf;

    this.slots.forEach((slot, index) => {
      const candy = shelf[index];
      show(slot, candy !== undefined);
      if (candy !== undefined) paint(slot, candy.color);
    });
  }
}
