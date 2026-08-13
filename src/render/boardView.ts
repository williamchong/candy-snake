import type Phaser from 'phaser';

import { COLS, ROWS } from '../core/board';
import type { GameState, Vec2 } from '../core/types';
import { CELL_SIZE, PIXEL_SCALE, TextureKey } from './textures';

/**
 * Board geometry. 16×16 cells at 32 px is 512×512, parked left of centre in
 * the 960×640 frame so the right column stays free for the HUD (design §10,
 * landscape). Temporary: `ui/layout.ts` becomes the only holder of screen
 * geometry once the board has to be responsive (architecture §9).
 */
const BOARD_X = 64;
const BOARD_Y = 64;
const BORDER = 0x4a3a7a;

/** Placeholder tints, until segments carry a color of their own. */
const SEGMENT_TINT = 0xf2e2b6;
const HEAD_TINT = 0xff8a5c;
const SUGAR_TINT = 0xffffff;

const Depth = { Floor: 0, Pickup: 1, Segment: 2, Head: 3 } as const;

/** Anything that sits on a board cell — both Segment and Pickup qualify. */
interface Placed {
  readonly pos: Vec2;
}

const cellToPixel = (cell: Vec2): Vec2 => ({
  x: BOARD_X + cell.x * CELL_SIZE + CELL_SIZE / 2,
  y: BOARD_Y + cell.y * CELL_SIZE + CELL_SIZE / 2,
});

/**
 * A reusable run of identical sprites. Sprites are shown and hidden rather
 * than created and destroyed, so a strand that grows and shatters repeatedly
 * does not churn game objects.
 */
class SpritePool {
  private readonly sprites: Phaser.GameObjects.Image[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly key: TextureKey,
    private readonly tint: number,
    private readonly depth: number,
  ) {}

  show(items: readonly Placed[]): void {
    items.forEach((item, index) => {
      const sprite = this.sprites[index] ?? this.create();
      const { x, y } = cellToPixel(item.pos);
      sprite.setVisible(true).setPosition(x, y);
    });

    for (let index = items.length; index < this.sprites.length; index += 1) {
      this.sprites[index]?.setVisible(false);
    }
  }

  private create(): Phaser.GameObjects.Image {
    const sprite = this.scene.add
      .image(0, 0, this.key)
      .setScale(PIXEL_SCALE)
      .setTint(this.tint)
      .setDepth(this.depth);

    this.sprites.push(sprite);
    return sprite;
  }
}

/** Draws the board from game state. Owns no rules — it only reflects state. */
export class BoardView {
  private readonly head: SpritePool;
  private readonly segments: SpritePool;
  private readonly pickups: SpritePool;

  constructor(scene: Phaser.Scene) {
    this.drawFloor(scene);
    this.pickups = new SpritePool(scene, TextureKey.Sugar, SUGAR_TINT, Depth.Pickup);
    this.segments = new SpritePool(
      scene,
      TextureKey.Segment,
      SEGMENT_TINT,
      Depth.Segment,
    );
    this.head = new SpritePool(scene, TextureKey.Head, HEAD_TINT, Depth.Head);
  }

  render(state: GameState): void {
    this.head.show([{ pos: state.snake.head }]);
    this.segments.show(state.snake.body);
    this.pickups.show(state.pickups);
  }

  /**
   * The floor is a baked texture rather than a drawn checkerboard because a
   * Graphics replays its whole command buffer every frame — 256 cells would
   * cost 500+ draw commands per frame forever. This is one quad.
   */
  private drawFloor(scene: Phaser.Scene): void {
    scene.add
      .image(BOARD_X, BOARD_Y, TextureKey.Floor)
      .setOrigin(0)
      .setScale(CELL_SIZE)
      .setDepth(Depth.Floor);

    scene.add
      .rectangle(BOARD_X, BOARD_Y, COLS * CELL_SIZE, ROWS * CELL_SIZE)
      .setOrigin(0)
      .setStrokeStyle(PIXEL_SCALE, BORDER)
      .setDepth(Depth.Floor);
  }
}
