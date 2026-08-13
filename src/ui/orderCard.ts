import type Phaser from 'phaser';

import { primariesOf } from '../core/colors';
import { patienceFraction } from '../core/customers';
import type { Customer, Vec2 } from '../core/types';
import {
  BORDER,
  CHROME_WIDTH,
  GLYPH_TINT,
  HudDepth,
  makeDrawn,
  paint,
  show,
  type Drawn,
} from '../render/drawn';
import { TextureKey } from '../render/textures';

/**
 * One waiting child: the candy they asked for, the jars that go into it, and
 * the patience bar draining under both (design §5).
 *
 * The jars are the game's main teaching channel — a purple order shows the red
 * and the blue that make it, so mixing is learnt by reading the queue rather
 * than from a table (design §4). They are drawn as jars rather than plain dots
 * because a jar is the thing the player actually has to drive through.
 */
export const CARD_WIDTH = 78;
export const CARD_HEIGHT = 116;

/** Chrome: a shade off the page, outlined like every other slot. */
const CARD_FILL = 0xe7dcf0;

/** Rows within the card, from its top edge. */
const CANDY_Y = 30;
const JAR_Y = 68;
const BAR_Y = 100;

/** Two jars sit side by side; one sits in the middle. */
const JAR_SPREAD = 17;
const MAX_JARS = 2;

const BAR_WIDTH = 56;
const BAR_HEIGHT = 8;

export class OrderCard {
  private readonly centreX: number;
  private readonly background: Phaser.GameObjects.Rectangle;
  private readonly candy: Drawn;
  private readonly jars: Drawn[] = [];
  private readonly barTrack: Phaser.GameObjects.Rectangle;
  private readonly barFill: Phaser.GameObjects.Rectangle;
  /** Who the card is currently stamped for; re-stamping every frame is waste. */
  private shownId: number | undefined;
  /** Whole pixels of bar drawn, so a sub-pixel drain writes nothing. */
  private shownBarWidth = -1;
  private cleared = false;

  constructor(scene: Phaser.Scene, at: Vec2) {
    const top = at.y - CARD_HEIGHT / 2;
    this.centreX = at.x;

    this.background = scene.add
      .rectangle(at.x, at.y, CARD_WIDTH, CARD_HEIGHT, CARD_FILL)
      .setStrokeStyle(CHROME_WIDTH, BORDER)
      .setDepth(HudDepth.Slot);

    this.candy = makeDrawn(
      scene,
      { key: TextureKey.Candy, depth: HudDepth.Icon, glyphDepth: HudDepth.Glyph },
      { x: at.x, y: top + CANDY_Y },
    );

    for (let jar = 0; jar < MAX_JARS; jar += 1) {
      this.jars.push(
        makeDrawn(
          scene,
          { key: TextureKey.Dye, depth: HudDepth.Icon, glyphDepth: HudDepth.Glyph },
          { x: at.x, y: top + JAR_Y },
        ),
      );
    }

    this.barTrack = scene.add
      .rectangle(at.x, top + BAR_Y, BAR_WIDTH, BAR_HEIGHT, BORDER)
      .setDepth(HudDepth.Icon);
    // Anchored at its left edge, so draining shortens it rather than shrinking
    // it toward the middle.
    this.barFill = scene.add
      .rectangle(at.x - BAR_WIDTH / 2, top + BAR_Y, BAR_WIDTH, BAR_HEIGHT, GLYPH_TINT)
      .setOrigin(0, 0.5)
      .setDepth(HudDepth.Glyph);

    // Everything above is born visible, so an unused slot would show a blank
    // card for the frame between here and the first render.
    this.clear();
  }

  /** Draws the child at this slot, or clears the slot when there is none. */
  render(customer: Customer | undefined): void {
    if (customer === undefined) {
      this.clear();
      return;
    }

    if (customer.id !== this.shownId) {
      this.shownId = customer.id;
      this.stamp(customer);
    }

    if (customer.patience === undefined) return;

    // 56 px over 35 s is a fifth of a pixel a second, so all but one frame in
    // thirty would redraw the identical bar. Whole pixels also sit better
    // against the rest of the art.
    const width = Math.round(BAR_WIDTH * patienceFraction(customer.patience));
    if (width === this.shownBarWidth) return;

    this.shownBarWidth = width;
    this.barFill.setDisplaySize(width, BAR_HEIGHT);
  }

  /** The candy and the jars that go into it — only when the child changes. */
  private stamp(customer: Customer): void {
    this.cleared = false;
    this.background.setVisible(true);
    show(this.candy, true);
    paint(this.candy, customer.want);

    // An opening-level child has no clock at all, so the card shows no bar
    // rather than a full one that never moves (design §7). Patience is fixed
    // when a customer is created, so this never changes under the same id.
    const ticking = customer.patience !== undefined;
    this.barTrack.setVisible(ticking);
    this.barFill.setVisible(ticking);
    this.shownBarWidth = -1;

    const primaries = primariesOf(customer.want);
    this.jars.forEach((jar, index) => {
      const primary = primaries[index];
      show(jar, primary !== undefined);
      if (primary === undefined) return;

      paint(jar, primary);
      // One jar sits centred; two spread either side of the middle.
      const offset = primaries.length === 1 ? 0 : (index * 2 - 1) * JAR_SPREAD;
      jar.image.setX(this.centreX + offset);
      jar.glyph?.setX(this.centreX + offset);
    });
  }

  /** Guarded because an empty slot is redrawn every frame it stays empty. */
  private clear(): void {
    if (this.cleared) return;

    this.cleared = true;
    this.shownId = undefined;
    this.background.setVisible(false);
    show(this.candy, false);
    for (const jar of this.jars) show(jar, false);
    this.barTrack.setVisible(false);
    this.barFill.setVisible(false);
  }
}
