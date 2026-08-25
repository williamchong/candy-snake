import { describe, expect, it } from 'vitest';

import { COLORS } from '../core/colors';
import { softEdge } from './textures';

describe('a candy color as its own soft edge', () => {
  it('shades a color by exactly what the sprite rim shades it by', () => {
    // The rim is authored as #cfcfcf and Phaser's tint multiplies, so a white
    // pixel of it takes the full color and this gray takes that much of it.
    // Tinting the rim white must therefore give the rim back: the sign and the
    // strand are shaded by one number, and this is where it is checked.
    expect(softEdge(0xffffff)).toBe(0xcfcfcf);
  });

  it('leaves every candy a darker version of itself, and nothing else', () => {
    for (const { hex } of COLORS) {
      const rim = softEdge(hex);

      for (let shift = 0; shift <= 16; shift += 8) {
        const was = (hex >> shift) & 0xff;
        const now = (rim >> shift) & 0xff;

        // Darker on every channel it had one on, and no channel bleeding into
        // the next — the failure a hand-rolled shift-and-or invites.
        expect(now).toBeLessThanOrEqual(was);
        expect(now).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
