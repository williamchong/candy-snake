import { GLYPH_TINT } from '../render/drawn';

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
