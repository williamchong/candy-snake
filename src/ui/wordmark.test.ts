import { describe, expect, it } from 'vitest';

import { BROWN, colorInfo, RAINBOW } from '../core/colors';
import { letters } from './wordmark';

const TITLE = 'Candy Snake';

const hues = (word: string): readonly number[] => letters(word).map(({ hex }) => hex);

describe('the wordmark letters', () => {
  it('keeps every character of the word, in order', () => {
    expect(
      letters(TITLE)
        .map(({ char }) => char)
        .join(''),
    ).toBe(TITLE);
  });

  it('runs the palette in wheel order and wraps when the word outlasts it', () => {
    const wheel = RAINBOW.map((color) => colorInfo(color).hex);

    expect(hues('abcdefgh')).toEqual([...wheel, wheel[0], wheel[1]]);
  });

  it('spends no color on a space, so the second word carries on the first', () => {
    // The space is a gap in the rope rather than a bead of it: take it out of
    // the name and every remaining letter must still wear what it wore.
    expect(hues(TITLE).filter((_, at) => TITLE[at] !== ' ')).toEqual(
      hues(TITLE.replace(' ', '')),
    );
  });

  it('never letters the name in the mistake color', () => {
    // Design §4: brown is what an over-mix produces, and the sign is not the
    // place to advertise one. It is out of `RAINBOW`, and this says so.
    expect(hues(TITLE)).not.toContain(colorInfo(BROWN).hex);
  });
});
