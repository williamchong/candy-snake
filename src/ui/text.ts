import type Phaser from 'phaser';

import type { Vec2 } from '../core/types';
import { GLYPH_TINT } from '../render/drawn';
import { TEXT_MARGIN } from './layout';

/**
 * The same ink the accessibility symbols are stamped in, written as CSS — one
 * value in two syntaxes rather than two values that can drift. Text is chrome,
 * so like every other non-candy element it is separated by value and spends no
 * hue (design §4, palette constraints).
 */
export const INK = `#${GLYPH_TINT.toString(16).padStart(6, '0')}`;

/**
 * Screen text, in one place so the HUD and the surrounding screens cannot pick
 * different fonts. A bitmap face is the polish pass's business (Phase 7); what
 * matters now is that there is a single answer to "what does text look like".
 */
export const textStyle = (
  sizePx: number,
  extra: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: 'sans-serif',
  fontSize: `${sizePx}px`,
  color: INK,
  ...extra,
});

/**
 * Shrink-to-fit: a line too wide for `width` (less the margins) is scaled
 * down to it rather than being clipped at both ends — the alternative is
 * picking a font size that fits the smallest screen and looks lost on every
 * other one. Measured unscaled, or a line that was shrunk once would keep
 * shrinking.
 */
export const fitLine = (line: Phaser.GameObjects.Text, width: number): void => {
  const room = width - 2 * TEXT_MARGIN;

  line.setScale(1);
  if (line.width > room) line.setScale(room / line.width);
};

export interface StackRow {
  readonly text: string;
  readonly size: number;
  /** Where the line sits relative to the middle of the frame, in pixels. */
  readonly dy: number;
}

/**
 * A stack of centred lines, which is the whole of what both message screens
 * are. Re-centring is the cheap path and the usual one — on a phone the middle
 * of the screen moves when the device is turned over, and nothing else about
 * the text has to. A screen whose *rows* depend on the frame rebuilds instead,
 * which is what `destroy` is for.
 */
export class TextStack {
  private readonly lines: readonly {
    readonly line: Phaser.GameObjects.Text;
    readonly dy: number;
  }[];

  constructor(scene: Phaser.Scene, rows: readonly StackRow[]) {
    this.lines = rows.map(({ text, size, dy }) => ({
      line: scene.add.text(0, 0, text, textStyle(size)).setOrigin(0.5),
      dy,
    }));
  }

  /** `width` is what each line has to fit inside — see `fitLine`. */
  centreOn({ x, y }: Vec2, width: number): void {
    for (const { line, dy } of this.lines) {
      fitLine(line, width);
      line.setPosition(x, y + dy);
    }
  }

  /**
   * For the one screen whose rows depend on the frame: a table that fits fewer
   * entries sideways than upright has to be rebuilt when the phone is turned
   * over, and its old lines have to go with it.
   */
  destroy(): void {
    for (const { line } of this.lines) line.destroy();
  }
}
