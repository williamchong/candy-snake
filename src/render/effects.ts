import type Phaser from 'phaser';

import type { Vec2 } from '../core/types';
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
}

/** How a piece eases out unless its config asks for something else. */
const DISSIPATES = 'Quad.easeOut';

/**
 * A pooled puff. Fires in the coordinates of the container it was given, so a
 * host whose layout is a container position and scale — the board — carries its
 * pieces through a resize for free.
 */
export class Burst {
  private readonly sprites: Phaser.GameObjects.Image[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly root: Phaser.GameObjects.Container,
    private readonly config: BurstConfig,
  ) {}

  fire(at: Vec2, tint: number): void {
    const { key, depth, durationMs, growth, ease } = this.config;
    const scale = this.config.scale ?? PIXEL_SCALE;

    // Only a sprite whose tween has finished — it hides itself on complete —
    // may be reclaimed. Claiming one still fading would cut that piece short,
    // and a piece outlives a move, so there is always one in flight. The pool
    // therefore settles at the peak number of overlapping bursts.
    let sprite = this.sprites.find((candidate) => !candidate.visible);
    if (sprite === undefined) {
      sprite = makeSprite(this.scene, key, tint, depth, at, scale);
      adopt(this.root, sprite);
      this.sprites.push(sprite);
    }

    sprite
      .setPosition(at.x, at.y)
      .setTint(tint)
      .setAlpha(1)
      .setScale(scale)
      .setVisible(true);

    this.scene.tweens.add({
      targets: sprite,
      alpha: 0,
      scale: scale * growth,
      duration: durationMs,
      ease: ease ?? DISSIPATES,
      onComplete: () => sprite.setVisible(false),
    });
  }
}
