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
 * A pooled puff. Fires in the coordinates of the container it was given, so a
 * host whose layout is a container position and scale — the board — carries its
 * pieces through a resize for free.
 */
export class Burst {
  private readonly sprites: Phaser.GameObjects.Image[] = [];
  /** How many bursts have been fired, which is what turns each one. */
  private fired = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly root: Phaser.GameObjects.Container,
    private readonly config: BurstConfig,
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

  private piece(from: Vec2, to: Vec2, tint: number): void {
    const { key, depth, durationMs, growth, ease } = this.config;
    const scale = this.config.scale ?? PIXEL_SCALE;

    // Only a sprite whose tween has finished — it hides itself on complete —
    // may be reclaimed. Claiming one still fading would cut that piece short,
    // and a piece outlives a move, so there is always one in flight. The pool
    // therefore settles at the peak number of overlapping bursts.
    let sprite = this.sprites.find((candidate) => !candidate.visible);
    if (sprite === undefined) {
      sprite = makeSprite(this.scene, key, tint, depth, from, scale);
      adopt(this.root, sprite);
      this.sprites.push(sprite);
    }

    sprite
      .setPosition(from.x, from.y)
      .setTint(tint)
      .setAlpha(1)
      .setScale(scale)
      .setVisible(true);

    this.scene.tweens.add({
      targets: sprite,
      x: to.x,
      y: to.y,
      alpha: 0,
      scale: scale * growth,
      duration: durationMs,
      ease: ease ?? DISSIPATES,
      onComplete: () => sprite.setVisible(false),
    });
  }
}
