import type Phaser from 'phaser';

import { COLS, ROWS } from '../core/board';
import { colorInfo } from '../core/colors';
import {
  RAW,
  type ColorMask,
  type GameState,
  type Pickup,
  type Segment,
  type Vec2,
} from '../core/types';
import {
  CELL_SIZE,
  PIXEL_SCALE,
  TextureKey,
  glyphTextureKey,
  type GlyphTextureKey,
} from './textures';

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
 * palette constraints). Nothing here is a candy: the head and the symbol ink
 * are separated by value — the darkest things on the board — and sugar is the
 * near-white of raw, unmixed sugar. Candy hues all come from `core/colors.ts`.
 */
const HEAD_TINT = 0x6e6478;
const GLYPH_TINT = 0x5f5668;

/** A sugar cube is raw sugar, so it takes raw's color from the palette. */
const SUGAR_TINT = colorInfo(RAW).hex;

/** Leaves a texture's own pixels alone, for sprites that tint per item. */
const NO_TINT = 0xffffff;

const SHATTER_MS = 280;

/**
 * Every glyph sits directly above the sprite it labels, so the layers pair up.
 */
const Depth = {
  Floor: 0,
  Pickup: 1,
  PickupGlyph: 2,
  Segment: 3,
  SegmentGlyph: 4,
  Head: 5,
  Shard: 6,
} as const;

/**
 * Anything that sits on a board cell. `color` is what a sprite is tinted and
 * stamped from; the head and sugar have none and fall back to the pool's own
 * tint. `Segment` satisfies this as-is; a dye `Pickup` names the same value
 * `primary`, so `syncToState` relabels it.
 */
interface Placed {
  readonly pos: Vec2;
  readonly color?: ColorMask;
}

/** A sprite mid-slide between the cell it left and the cell it is entering. */
interface Sliding {
  readonly image: Phaser.GameObjects.Image;
  /** The accessibility symbol riding along with it, when the pool wants one. */
  readonly glyph: Phaser.GameObjects.Image | undefined;
  from: Vec2;
  to: Vec2;
}

interface PoolConfig {
  readonly key: TextureKey;
  /**
   * For pools whose items carry no color of their own. Pools that do — the
   * strand and the dye jars — leave this out and are tinted per item instead.
   */
  readonly tint?: number;
  readonly depth: number;
  /**
   * Whether a sprite keeps its identity between ticks. The strand does — a
   * body segment slides into the cell ahead of it. Pickups do not: eating
   * splices the array and a fresh sugar takes the freed index, so sliding
   * would show new sugar gliding out of the snake's mouth.
   */
  readonly slides: boolean;
  /** Depth for the symbol glyph, or undefined to draw none (design §4). */
  readonly glyphDepth?: number;
}

const cellToPixel = (cell: Vec2): Vec2 => ({
  x: BOARD_X + cell.x * CELL_SIZE + CELL_SIZE / 2,
  y: BOARD_Y + cell.y * CELL_SIZE + CELL_SIZE / 2,
});

/** Glyphs are baked at their display size, so they draw unscaled. */
const GLYPH_SCALE = 1;

const makeSprite = (
  scene: Phaser.Scene,
  key: TextureKey | GlyphTextureKey,
  tint: number,
  depth: number,
  at: Vec2,
  scale = PIXEL_SCALE,
): Phaser.GameObjects.Image =>
  scene.add.image(at.x, at.y, key).setScale(scale).setTint(tint).setDepth(depth);

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
 * Moves a sprite and the glyph riding on it together, so they never drift.
 * Takes loose numbers because the per-frame path calls it for every visible
 * sprite, and a Vec2 per sprite per frame is pure garbage.
 */
const place = (entry: Sliding, x: number, y: number): void => {
  entry.image.setPosition(x, y);
  entry.glyph?.setPosition(x, y);
};

const show = (entry: Sliding, visible: boolean): void => {
  entry.image.setVisible(visible);
  entry.glyph?.setVisible(visible);
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
    private readonly config: PoolConfig,
  ) {}

  /**
   * Points each sprite at its new cell and recolors it. Call once per grid
   * move — never per frame: a dye blends the whole strand at a tick boundary,
   * so this is exactly the cadence a tint changes on.
   */
  retarget(items: readonly Placed[]): void {
    items.forEach((item, index) => {
      const to = cellToPixel(item.pos);
      let entry = this.entries[index];

      if (entry === undefined) {
        entry = this.spawn(to);
        this.entries.push(entry);
      } else {
        // A sprite that was hidden has a stale position, and a sprite that
        // wrapped is a whole board away: both appear rather than travel.
        const carriesOver =
          this.config.slides && entry.image.visible && isOneCellApart(entry.to, to);
        entry.from = carriesOver ? entry.to : to;
        entry.to = to;
      }

      this.paint(entry, item.color);
      show(entry, true);
      place(entry, entry.from.x, entry.from.y);
    });

    for (let index = items.length; index < this.entries.length; index += 1) {
      const entry = this.entries[index];
      if (entry !== undefined) show(entry, false);
    }
  }

  draw(progress: number): void {
    if (!this.config.slides) return;

    for (const entry of this.entries) {
      if (!entry.image.visible) continue;

      place(
        entry,
        entry.from.x + (entry.to.x - entry.from.x) * progress,
        entry.from.y + (entry.to.y - entry.from.y) * progress,
      );
    }
  }

  private spawn(at: Vec2): Sliding {
    const { key, tint, depth, glyphDepth } = this.config;

    return {
      image: makeSprite(this.scene, key, tint ?? NO_TINT, depth, at),
      glyph:
        glyphDepth === undefined
          ? undefined
          : makeSprite(
              this.scene,
              glyphTextureKey(RAW),
              GLYPH_TINT,
              glyphDepth,
              at,
              GLYPH_SCALE,
            ),
      from: at,
      to: at,
    };
  }

  /** Colorless items keep the pool's own tint — see `PoolConfig.tint`. */
  private paint(entry: Sliding, color: ColorMask | undefined): void {
    if (color === undefined) return;

    entry.image.setTint(colorInfo(color).hex);
    entry.glyph?.setTexture(glyphTextureKey(color));
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
  /**
   * Where the next burst starts drawing from. Bursts overlap — a one-shard
   * dye splash can land while a shatter is still fading — and always starting
   * at index 0 would reclaim the shard that puff is mid-tween on. Walking the
   * pool means a sprite is only reused once everything else has been.
   */
  private cursor = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  /** Takes whole segments, so the puff shows the colors that were lost. */
  burst(segments: readonly Segment[]): void {
    segments.forEach((segment) => {
      const at = cellToPixel(segment.pos);
      const tint = colorInfo(segment.color).hex;
      const existing = this.sprites[this.cursor];
      const sprite =
        existing ?? makeSprite(this.scene, TextureKey.Segment, tint, Depth.Shard, at);
      if (existing === undefined) this.sprites.push(sprite);
      this.cursor = (this.cursor + 1) % this.sprites.length;

      // A second shatter can land while the first is still fading; without
      // this the two tweens fight over the same sprite.
      this.scene.tweens.killTweensOf(sprite);
      sprite
        .setPosition(at.x, at.y)
        .setTint(tint)
        .setAlpha(1)
        .setScale(PIXEL_SCALE)
        .setVisible(true);

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
  private readonly sugar: SpritePool;
  private readonly dyes: SpritePool;
  private readonly shards: ShardBurst;
  private previousPickups: readonly Pickup[] | undefined;

  constructor(private readonly scene: Phaser.Scene) {
    this.drawFloor();
    this.sugar = new SpritePool(scene, {
      key: TextureKey.Sugar,
      tint: SUGAR_TINT,
      depth: Depth.Pickup,
      slides: false,
    });
    // Jars carry their primary as their color, so one pool serves all three.
    this.dyes = new SpritePool(scene, {
      key: TextureKey.Dye,
      depth: Depth.Pickup,
      slides: false,
      glyphDepth: Depth.PickupGlyph,
    });
    this.segments = new SpritePool(scene, {
      key: TextureKey.Segment,
      depth: Depth.Segment,
      slides: true,
      glyphDepth: Depth.SegmentGlyph,
    });
    this.head = new SpritePool(scene, {
      key: TextureKey.Head,
      tint: HEAD_TINT,
      depth: Depth.Head,
      slides: true,
    });
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
    const shown = this.previousPickups ?? state.pickups;
    this.sugar.retarget(shown.filter((pickup) => pickup.kind === 'sugar'));
    this.dyes.retarget(
      shown
        .filter((pickup) => pickup.kind === 'dye')
        .map((pickup) => ({ pos: pickup.pos, color: pickup.primary })),
    );
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
  }

  /** A soft local puff where the strand broke, rather than a screen flash. */
  shatter(segments: readonly Segment[]): void {
    this.shards.burst(segments);
  }

  /** Dye eaten with no strand to knead it into: it splashes and is gone. */
  splash(pos: Vec2, color: ColorMask): void {
    this.shards.burst([{ pos, color }]);
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
