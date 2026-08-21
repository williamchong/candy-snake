import type Phaser from 'phaser';

import type { Vec2 } from '../core/types';
import { makeDrawn, paint, place, show, type Drawn } from '../render/drawn';
import { PARADE, paradePoses } from '../render/parade';

/**
 * The menu's parade, on screen: one sprite per member of the cast in
 * `render/parade.ts`, moved to wherever that module says they stand.
 *
 * There is no logic here on purpose. The cast never changes and the sprites are
 * built once, so this class holds nothing but the band it was handed and the
 * pool it fills — which is what leaves the whole of the animation somewhere
 * Node can test it (architecture §11).
 *
 * Nothing here tears the sprites down: Phaser destroys a scene's display list
 * when the scene shuts down, which is the same thing the text stack leans on.
 */
export class Parade {
  private readonly members: readonly Drawn[];
  /** The middle of the band, and the width its walkers cross. */
  private left = 0;
  private middle = 0;
  private width = 0;
  /**
   * Whether the frame gave the band room at all. Held here rather than left to
   * the caller to stop calling `update`: the poses set visibility per member,
   * so a screen with no band would put the parade back the moment it ticked.
   */
  private walking = true;

  constructor(scene: Phaser.Scene) {
    this.members = PARADE.map((member) => {
      const drawn = makeDrawn(
        scene,
        {
          key: member.key,
          tint: member.tint,
          depth: member.depth,
          glyphDepth: member.glyphDepth,
        },
        { x: 0, y: 0 },
      );

      drawn.image.setAngle(member.angle);
      // Once, not per frame: the cast is fixed, so every seam in the rope is
      // shaded the same way for as long as the screen is up.
      paint(drawn, member.color, member.corners);

      return drawn;
    });
  }

  /**
   * The band, given the middle of the frame and the room a line has in it. A
   * `dy` of undefined is a frame that had no room for one, and the parade puts
   * itself away — one call rather than two, because a band and whether there is
   * a band are the same answer.
   */
  centreOn({ x, y }: Vec2, width: number, dy: number | undefined): void {
    this.walking = dy !== undefined;
    if (dy === undefined) {
      for (const drawn of this.members) show(drawn, false);
      return;
    }

    this.left = x - width / 2;
    this.middle = y + dy;
    this.width = width;
  }

  /** `nowMs` is the scene clock, so a queue of walkers steps in time. */
  update(nowMs: number): void {
    if (!this.walking) return;

    paradePoses(nowMs, this.width).forEach((pose, index) => {
      const drawn = this.members[index];
      if (drawn === undefined) return;

      show(drawn, pose.visible);
      if (!pose.visible) return;

      drawn.image.setTexture(pose.key);
      place(drawn, this.left + pose.x, this.middle + pose.y);
    });
  }
}
