import type Phaser from 'phaser';

import { colorInfo, RAINBOW } from '../core/colors';
import type { Vec2 } from '../core/types';
import { softEdge } from '../render/textures';
import { letterOffsets } from './layout';
import { css, fitScale, textStyle } from './text';

/**
 * The shop's sign: the game's name with one candy color per letter, running
 * the palette's wheel order (`RAINBOW`) and wrapping when the word outlasts it.
 *
 * **Hue on a word, when hue belongs to candies (design §4).** That constraint
 * is a rule about the kitchen: on the board a color is the thing the player
 * mixes and matches, so anything else wearing one is a candy the player cannot
 * serve. The menu holds no board and nothing to match — and the parade already
 * walks these same six past, in this same order, a few lines below. So the sign
 * is the strand read left to right, which is as close to "in theme" as a word
 * can get, and the rule keeps the whole of the play screen it was written for.
 *
 * **Each letter is edged the way the rope is.** A candy on the board is a flat
 * fill with a soft edge that is a deeper shade of its own color — the gray rim
 * in the texture, multiplied by the tint (design §2) — and a letter outlined in
 * `softEdge` is the same thing drawn with a pen instead of a sprite. The first
 * cut used the symbols' dark ink instead, which does carry a pale color against
 * a pale ground but makes the word a piece of chrome with candy poured into it.
 * The sign is pulled sugar, so it is shaded like pulled sugar.
 *
 * One `Text` per letter, because a `Text` has exactly one fill. That leaves the
 * word its own little layout problem, and the two answers with a decision in
 * them are settled where they belong: which color a letter wears, here, and
 * where it stands, in `layout.ts` with the rest of the screen's geometry.
 */

/**
 * The edge around a letter, as a share of its size. Half of it is covered by
 * the fill drawn over it, so what shows is a rim of about the same weight the
 * rope carries at the size the sign is set in.
 */
const STROKE = 1 / 12;

export interface Letter {
  readonly char: string;
  /** The candy color it is filled with, as a plain hex number. */
  readonly hex: number;
}

/**
 * The word, colored. The cycle steps on letters only, so the space between the
 * two words costs the rainbow nothing and `Snake` picks up where `Candy` left
 * off rather than starting again a color later.
 */
export const letters = (word: string): readonly Letter[] => {
  let at = 0;

  return [...word].map((char) => {
    // The fallback is unreachable past the modulo; it satisfies the compiler.
    const hex = colorInfo(RAINBOW[at % RAINBOW.length] ?? 0).hex;
    if (char !== ' ') at += 1;

    return { char, hex };
  });
};

export class Wordmark {
  private readonly glyphs: readonly {
    readonly glyph: Phaser.GameObjects.Text;
    /** Where it stands relative to the middle of the word, in pixels. */
    readonly dx: number;
  }[];
  /** How wide the word is with its edge on — what it has to be fitted against. */
  private readonly span: number;

  constructor(scene: Phaser.Scene, word: string, size: number) {
    const stroke = Math.max(1, Math.round(size * STROKE));
    const drawn = letters(word).map(({ char, hex }) =>
      scene.add
        .text(
          0,
          0,
          char,
          textStyle(size, {
            color: css(hex),
            fontStyle: 'bold',
            stroke: css(softEdge(hex)),
            strokeThickness: stroke,
          }),
        )
        .setOrigin(0.5),
    );

    // Phaser widens a stroked `Text` by exactly its thickness so the edge is
    // not clipped, which is width the letter does not advance by: laying the
    // word out on those numbers would space it by how heavily it is edged
    // rather than by how it is cut. The edge comes back on once for the whole
    // word, which is what it actually costs — half a stroke past either end.
    const widths = drawn.map(({ width }) => width - stroke);

    const offsets = letterOffsets(widths);

    this.span = widths.reduce((sum, width) => sum + width, 0) + stroke;
    this.glyphs = drawn.map((glyph, at) => ({ glyph, dx: offsets[at] ?? 0 }));
  }

  /**
   * The word, centred on `dy` off a point and shrunk to fit `width` the way
   * `fitLine` shrinks a line — one scale for all of it, or the letters would be
   * sized against each other rather than against the frame. Measured once at
   * construction: a `Text`'s `width` is the unscaled one, so nothing here has to
   * be undone before it can be redone.
   */
  centreOn({ x, y }: Vec2, width: number, dy: number): void {
    const scale = fitScale(this.span, width);

    for (const { glyph, dx } of this.glyphs) {
      glyph.setScale(scale);
      glyph.setPosition(x + dx * scale, y + dy);
    }
  }

  /** As `TextStack.destroy`: for the screen that rebuilds when the frame moves. */
  destroy(): void {
    for (const { glyph } of this.glyphs) glyph.destroy();
  }
}
