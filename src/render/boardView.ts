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
const BORDER = 0xc9b4dd;

/**
 * Hue carries meaning in this game, so only candies may spend it (design §4,
 * palette constraints). The head and sugar are not candies and are separated
 * by value instead: the head is the darkest thing on the board, sugar the
 * near-white of raw, unmixed sugar.
 *
 * SEGMENT_TINT is the one placeholder here — every Phase 1 segment is raw, so
 * this is the color `colors.ts` will own once segments carry their own.
 */
const SEGMENT_TINT = 0xf7b8d4;
const HEAD_TINT = 0x6e6478;
const SUGAR_TINT = 0xfff3df;
const SHARD_TINT = 0xffd9ea;

const SHATTER_MS = 280;

const Depth = { Floor: 0, Pickup: 1, Segment: 2, Head: 3, Shard: 4 } as const;

/** Anything that sits on a board cell — both Segment and Pickup qualify. */
interface Placed {
  readonly pos: Vec2;
}

/** A sprite mid-slide between the cell it left and the cell it is entering. */
interface Sliding {
  readonly image: Phaser.GameObjects.Image;
  from: Vec2;
  to: Vec2;
}

const cellToPixel = (cell: Vec2): Vec2 => ({
  x: BOARD_X + cell.x * CELL_SIZE + CELL_SIZE / 2,
  y: BOARD_Y + cell.y * CELL_SIZE + CELL_SIZE / 2,
});

const makeSprite = (
  scene: Phaser.Scene,
  key: TextureKey,
  tint: number,
  depth: number,
  at: Vec2,
): Phaser.GameObjects.Image =>
  scene.add.image(at.x, at.y, key).setScale(PIXEL_SCALE).setTint(tint).setDepth(depth);

/**
 * Whether two pixel positions are one cell apart — the only distance a sprite
 * ever travels in a tick. Anything else is a wrap across a service door, and
 * must not be slid across.
 */
const isOneCellApart = (a: Vec2, b: Vec2): boolean => {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return (dx === CELL_SIZE && dy === 0) || (dx === 0 && dy === CELL_SIZE);
};

/**
 * A reusable run of identical sprites. Sprites are shown and hidden rather
 * than created and destroyed, so a strand that grows and shatters repeatedly
 * does not churn game objects.
 */
class SpritePool {
  private readonly entries: Sliding[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly key: TextureKey,
    private readonly tint: number,
    private readonly depth: number,
    /**
     * Whether a sprite keeps its identity between ticks. The strand does — a
     * body segment slides into the cell ahead of it. Pickups do not: eating
     * splices the array and a fresh sugar takes the freed index, so sliding
     * would show new sugar gliding out of the snake's mouth.
     */
    private readonly slides: boolean,
  ) {}

  /** Points each sprite at its new cell. Call once per grid move. */
  retarget(items: readonly Placed[]): void {
    items.forEach((item, index) => {
      const to = cellToPixel(item.pos);
      const entry = this.entries[index];

      if (entry === undefined) {
        this.entries.push({
          image: makeSprite(this.scene, this.key, this.tint, this.depth, to),
          from: to,
          to,
        });
        return;
      }

      // A sprite that was hidden has a stale position, and a sprite that
      // wrapped is a whole board away: both appear rather than travel.
      const carriesOver =
        this.slides && entry.image.visible && isOneCellApart(entry.to, to);
      entry.from = carriesOver ? entry.to : to;
      entry.to = to;
      entry.image.setVisible(true).setPosition(entry.from.x, entry.from.y);
    });

    for (let index = items.length; index < this.entries.length; index += 1) {
      this.entries[index]?.image.setVisible(false);
    }
  }

  draw(progress: number): void {
    if (!this.slides) return;

    for (const entry of this.entries) {
      if (!entry.image.visible) continue;

      entry.image.setPosition(
        entry.from.x + (entry.to.x - entry.from.x) * progress,
        entry.from.y + (entry.to.y - entry.from.y) * progress,
      );
    }
  }
}

/**
 * The self-hit puff. Pooled like the strand: a hit near the head destroys
 * almost the whole body, so one event can light up ~250 cells at once, and
 * creating that many game objects in a single frame is exactly the churn
 * SpritePool exists to avoid.
 */
class ShardBurst {
  private readonly sprites: Phaser.GameObjects.Image[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  burst(cells: readonly Vec2[]): void {
    cells.forEach((cell, index) => {
      const at = cellToPixel(cell);
      const existing = this.sprites[index];
      const sprite =
        existing ??
        makeSprite(this.scene, TextureKey.Segment, SHARD_TINT, Depth.Shard, at);
      if (existing === undefined) this.sprites.push(sprite);

      // A second shatter can land while the first is still fading; without
      // this the two tweens fight over the same sprite.
      this.scene.tweens.killTweensOf(sprite);
      sprite.setPosition(at.x, at.y).setAlpha(1).setScale(PIXEL_SCALE).setVisible(true);

      this.scene.tweens.add({
        targets: sprite,
        alpha: 0,
        scale: PIXEL_SCALE * 1.5,
        duration: SHATTER_MS,
        ease: 'Quad.easeOut',
        onComplete: () => sprite.setVisible(false),
      });
    });
  }
}

/** Draws the board from game state. Owns no rules — it only reflects state. */
export class BoardView {
  private readonly head: SpritePool;
  private readonly segments: SpritePool;
  private readonly pickups: SpritePool;
  private readonly shards: ShardBurst;
  private previousPickups: readonly Placed[] | undefined;

  constructor(private readonly scene: Phaser.Scene) {
    this.drawFloor();
    this.pickups = new SpritePool(
      scene,
      TextureKey.Sugar,
      SUGAR_TINT,
      Depth.Pickup,
      false,
    );
    this.segments = new SpritePool(
      scene,
      TextureKey.Segment,
      SEGMENT_TINT,
      Depth.Segment,
      true,
    );
    this.head = new SpritePool(scene, TextureKey.Head, HEAD_TINT, Depth.Head, true);
    this.shards = new ShardBurst(scene);
  }

  /** Call when the core has moved the snake to a new set of cells. */
  syncToState(state: GameState): void {
    this.head.retarget([{ pos: state.snake.head }]);
    this.segments.retarget(state.snake.body);

    // The strand is drawn *arriving* at the cell it already occupies
    // logically, so it trails the simulation by one move. Pickups have to
    // trail by the same move or sugar vanishes a whole cell before the head
    // visibly reaches it. Pickup objects are immutable, so a shallow copy of
    // the array the core keeps mutating is enough.
    this.pickups.retarget(this.previousPickups ?? state.pickups);
    this.previousPickups = [...state.pickups];
  }

  /**
   * Call every frame. The core moves in whole cells five times a second,
   * which on its own reads as a strobe, so the view draws the snake part-way
   * between the cell it left and the cell it is entering.
   */
  render(progress: number): void {
    this.head.draw(progress);
    this.segments.draw(progress);
    this.pickups.draw(progress);
  }

  /** A soft local puff where the strand broke, rather than a screen flash. */
  shatter(cells: readonly Vec2[]): void {
    this.shards.burst(cells);
  }

  private drawFloor(): void {
    this.scene.add
      .image(BOARD_X, BOARD_Y, TextureKey.Floor)
      .setOrigin(0)
      .setScale(CELL_SIZE)
      .setDepth(Depth.Floor);

    this.scene.add
      .rectangle(BOARD_X, BOARD_Y, COLS * CELL_SIZE, ROWS * CELL_SIZE)
      .setOrigin(0)
      .setStrokeStyle(PIXEL_SCALE, BORDER)
      .setDepth(Depth.Floor);
  }
}
