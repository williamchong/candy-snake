import type Phaser from 'phaser';

import type { Vec2 } from '../core/types';
import { knockIntensity, type Flinger } from './burst';
import { adopt, makeSprite } from './drawn';
import { PIXEL_SCALE, type TextureKey } from './textures';

/**
 * The one-shot effects: something on screen coming apart where it stood. Pooled
 * and tween-driven, because these overlap — a piece fades for longer than a move
 * lasts, so a crumbling strand always has several in flight — and a game object
 * per piece is exactly the churn `SpritePool` exists to avoid.
 *
 * Machinery only. What an effect is tuned to lives with the depth table that
 * decides where it draws, so the board's numbers stay beside the board's layers
 * and the HUD's beside the HUD's (architecture §7).
 */

/** How a burst throws, or left out for one that stays where it fell. */
export interface Thrown {
  readonly pieces: number;
  /** How far each piece travels, in the host container's own pixels. */
  readonly distance: number;
  readonly fling: Flinger;
}

export interface BurstConfig {
  readonly key: TextureKey;
  readonly depth: number;
  readonly durationMs: number;
  /** Where a piece's scale ends up, as a multiple of where it started. */
  readonly growth: number;
  /**
   * Resting scale, for a sprite baked at other than half the size it is drawn
   * at. Defaults to what everything standing on a board cell uses.
   */
  readonly scale?: number;
  readonly ease?: string;
  readonly thrown?: Thrown;
}

/** How a piece eases out unless its config asks for something else. */
const DISSIPATES = 'Quad.easeOut';

/**
 * Knocks the scene's own camera, and nothing else's. `UIScene` runs in parallel
 * with a camera of its own — which architecture §6 says is exactly what the
 * two-scene split was for, "so the HUD ignores any camera effects applied to
 * the play field" — so the score and the queue stand still while the kitchen
 * takes the hit.
 *
 * A second knock inside the first is dropped rather than stacked: Phaser's
 * `force` defaults to false, and two impacts close together want one jolt, not
 * a longer one. The shards from both still fire, because where the strand broke
 * is information and the knock is not.
 */
export const knock = (scene: Phaser.Scene, pixels: number, durationMs: number): void => {
  const camera = scene.cameras.main;
  camera.shake(durationMs, knockIntensity(pixels, camera.width, camera.height));
};

/**
 * One pooled piece and whether it is spoken for. Claimed by this flag rather
 * than by visibility, which is how a host with no container has to do it:
 * `clear` needs to know what is in the air without asking the display list, and
 * a piece it has just hidden must not be handed straight back out.
 */
interface Piece {
  readonly image: Phaser.GameObjects.Image;
  busy: boolean;
}

/**
 * A pooled burst, firing in whatever coordinates its host works in.
 *
 * Hand it a container and it lives inside one: the board fits itself to the
 * device by moving and scaling a single container, so pieces in mid-air are
 * carried through a resize with everything else. The HUD has no such container
 * and positions every widget by hand, so a burst there is aimed at coordinates
 * the next layout pass invalidates — those hosts pass nothing and call `clear`
 * from their own `applyFrame` instead.
 */
export class Burst {
  private readonly pieces: Piece[] = [];
  /** How many bursts have been fired, which is what turns each one. */
  private fired = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly config: BurstConfig,
    private readonly root?: Phaser.GameObjects.Container,
  ) {}

  fire(at: Vec2, tint: number): void {
    const { thrown } = this.config;
    if (thrown === undefined) {
      this.piece(at, at, tint);
      return;
    }

    for (const fling of thrown.fling(thrown.pieces, this.fired)) {
      const to = {
        x: at.x + fling.x * thrown.distance,
        y: at.y + fling.y * thrown.distance,
      };
      this.piece(at, to, tint);
    }
    this.fired += 1;
  }

  /**
   * Takes every piece out of the air at once, doing by hand what the tweens
   * would have done on completion — `killTweensOf` does not run `onComplete`,
   * so a piece left claimed here is one the pool can never hand out again.
   */
  clear(): void {
    for (const piece of this.pieces) {
      if (!piece.busy) continue;

      this.scene.tweens.killTweensOf(piece.image);
      piece.image.setVisible(false);
      piece.busy = false;
    }
  }

  private piece(from: Vec2, to: Vec2, tint: number): void {
    const { durationMs, growth, ease } = this.config;
    const scale = this.config.scale ?? PIXEL_SCALE;
    const piece = this.claim(from, tint);

    piece.busy = true;
    piece.image
      .setPosition(from.x, from.y)
      .setTint(tint)
      .setAlpha(1)
      .setScale(scale)
      .setVisible(true);

    this.scene.tweens.add({
      targets: piece.image,
      x: to.x,
      y: to.y,
      alpha: 0,
      scale: scale * growth,
      duration: durationMs,
      ease: ease ?? DISSIPATES,
      onComplete: () => {
        piece.image.setVisible(false);
        piece.busy = false;
      },
    });
  }

  /**
   * A piece nothing else is using, building one if every piece is in the air.
   * Claiming one still fading would cut that piece short, and a piece outlives
   * a move — so the pool settles at the peak number of overlapping bursts.
   */
  private claim(at: Vec2, tint: number): Piece {
    const free = this.pieces.find((candidate) => !candidate.busy);
    if (free !== undefined) return free;

    const { key, depth } = this.config;
    const image = makeSprite(
      this.scene,
      key,
      tint,
      depth,
      at,
      this.config.scale ?? PIXEL_SCALE,
    );
    if (this.root !== undefined) adopt(this.root, image);

    const piece = { image, busy: false };
    this.pieces.push(piece);
    return piece;
  }
}
