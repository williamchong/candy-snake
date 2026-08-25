import { describe, expect, it } from 'vitest';

import { COLORS } from '../core/colors';
import { softEdge } from './textures';

const channelsOf = (color: number): readonly number[] =>
  [16, 8, 0].map((shift) => (color >> shift) & 0xff);

describe('a candy color as its own soft edge', () => {
  it('shades a color by exactly what the sprite rim shades it by', () => {
    // The rim is authored as one gray and Phaser's tint multiplies, so a white
    // pixel of a sprite takes the full color and a rim pixel takes this much of
    // it. Tinting the rim white must therefore give the rim back: the sign and
    // the strand are shaded by one number, and this is where that is checked.
    expect(softEdge(0xffffff)).toBe(0xcfcfcf);
  });

  it('brings every candy back darker on every channel it had', () => {
    for (const { hex } of COLORS) {
      const was = channelsOf(hex);

      // Nothing in the palette is dark enough for the multiply to round back to
      // where it started, so a channel that did not move is a channel that was
      // never shaded.
      channelsOf(softEdge(hex)).forEach((level, at) => {
        expect(level).toBeLessThan(was[at] ?? 0);
      });
    }
  });
});
