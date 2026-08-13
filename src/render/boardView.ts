import type Phaser from 'phaser';

import { CHOP_BLOCK_CELLS, COLS, ROWS } from '../core/board';
import { colorInfo } from '../core/colors';
import { SHELF_SLOTS } from '../core/shelf';
import {
  RAW,
  type Candy,
  type ColorMask,
  type GameState,
  type Pickup,
  type Segment,
  type Severed,
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

/**
 * The bench sits between the head and the floor in value, and takes no hue —
 * it is furniture, and a candy resting on it has to stay the brighter thing.
 */
const BLOCK_TINT = 0xc4b2d2;

/** A sugar cube is raw sugar, so it takes raw's color from the palette. */
const SUGAR_TINT = colorInfo(RAW).hex;

/** Leaves a texture's own pixels alone, for sprites that tint per item. */
const NO_TINT = 0xffffff;

const SHATTER_MS = 280;

/** Enough to read debris as spilled sugar rather than as live strand. */
const DEBRIS_ALPHA = 0.5;

/**
 * The shelf strip: six slots in the free column beside the board. Deliberately
 * plain — the HUD moves into `UIScene` in Phase 4 (architecture §6), and this
 * holds no layout knowledge worth carrying over.
 */
const SHELF_X = BOARD_X + COLS * CELL_SIZE + 96;
const SHELF_TOP = BOARD_Y + 48;
const SHELF_PITCH = 48;
const SLOT_SIZE = 40;

/**
 * Every glyph sits directly above the sprite it labels, so the layers pair up.
 */
const Depth = {
  Floor: 0,
  /** The bench is part of the kitchen: everything else moves across it. */
  Station: 1,
  Pickup: 2,
  PickupGlyph: 3,
  /** A cut piece lies on the floor, so the live strand passes over it. */
  Cut: 4,
  CutGlyph: 5,
  Segment: 6,
  SegmentGlyph: 7,
  Head: 8,
  Shard: 9,
  /** Beside the board, not on it — the HUD never overlaps the play field. */
  Shelf: 10,
  ShelfGlyph: 11,
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

/** A sprite and the accessibility symbol stamped on it, moved as one. */
interface Drawn {
  readonly image: Phaser.GameObjects.Image;
  /** The symbol riding along with it, for layers that want one. */
  readonly glyph: Phaser.GameObjects.Image | undefined;
}

/** A sprite mid-slide between the cell it left and the cell it is entering. */
interface Sliding extends Drawn {
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
   * body segment slides into the cell ahead of it. Pickups do not: spending
   * one splices the array and a fresh sugar takes the freed index, so sliding
   * would show new sugar gliding out of the snake's mouth. Debris does not
   * either — it is frozen by definition.
   */
  readonly slides: boolean;
  /** Drawn at this alpha, for layers that must read as inert (debris). */
  readonly alpha?: number;
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
const place = (entry: Drawn, x: number, y: number): void => {
  entry.image.setPosition(x, y);
  entry.glyph?.setPosition(x, y);
};

const show = (entry: Drawn, visible: boolean): void => {
  entry.image.setVisible(visible);
  entry.glyph?.setVisible(visible);
};

/** Colorless items keep whatever tint they were built with. */
const paint = (entry: Drawn, color: ColorMask | undefined): void => {
  if (color === undefined) return;

  entry.image.setTint(colorInfo(color).hex);
  entry.glyph?.setTexture(glyphTextureKey(color));
};

/**
 * A sprite plus its symbol glyph, built as a pair so every layer that wants a
 * glyph gets the same alignment and the same alpha (design §4).
 */
const makeDrawn = (
  scene: Phaser.Scene,
  config: Pick<PoolConfig, 'key' | 'tint' | 'depth' | 'glyphDepth' | 'alpha'>,
  at: Vec2,
): Drawn => {
  const { key, tint, depth, glyphDepth, alpha } = config;

  return {
    image: makeSprite(scene, key, tint ?? NO_TINT, depth, at).setAlpha(alpha ?? 1),
    glyph:
      glyphDepth === undefined
        ? undefined
        : makeSprite(
            scene,
            glyphTextureKey(RAW),
            GLYPH_TINT,
            glyphDepth,
            at,
            GLYPH_SCALE,
          ).setAlpha(alpha ?? 1),
  };
};

/**
 * A reusable run of identical sprites. Sprites are shown and hidden rather
 * than created and destroyed, so a strand that grows and shatters repeatedly
 * does not churn game objects.
 */
class SpritePool {
  private readonly entries: Sliding[] = [];
  /**
   * How many entries are in use. Everything past it is already hidden, so
   * neither loop below has to walk it — and it can be a long tail now that
   * chopping empties the strand outright every batch.
   */
  private active = 0;

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

      paint(entry, item.color);
      show(entry, true);
      place(entry, entry.from.x, entry.from.y);
    });

    for (let index = items.length; index < this.active; index += 1) {
      const entry = this.entries[index];
      if (entry !== undefined) show(entry, false);
    }
    this.active = items.length;
  }

  draw(progress: number): void {
    if (!this.config.slides) return;

    for (let index = 0; index < this.active; index += 1) {
      const entry = this.entries[index];
      if (entry === undefined) continue;

      place(
        entry,
        entry.from.x + (entry.to.x - entry.from.x) * progress,
        entry.from.y + (entry.to.y - entry.from.y) * progress,
      );
    }
  }

  private spawn(at: Vec2): Sliding {
    return { ...makeDrawn(this.scene, this.config, at), from: at, to: at };
  }
}

/**
 * The one-cell puff: a block of debris coming apart, or a wasted dye. Pooled
 * because these overlap — a puff fades for longer than a move lasts, so a
 * crumbling strand always has several in flight — and creating a game object
 * per puff is exactly the churn SpritePool exists to avoid.
 */
class ShardBurst {
  private readonly sprites: Phaser.GameObjects.Image[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  /** Takes a whole segment, so the puff shows the color that was lost. */
  burst(segment: Segment): void {
    const at = cellToPixel(segment.pos);
    const tint = colorInfo(segment.color).hex;

    // Only a sprite whose tween has finished — it hides itself on complete —
    // may be reclaimed. Claiming one still fading would cut that puff short,
    // and a puff outlives a move, so there is always one in flight. The pool
    // therefore settles at the peak number of overlapping puffs.
    let sprite = this.sprites.find((candidate) => !candidate.visible);
    if (sprite === undefined) {
      sprite = makeSprite(this.scene, TextureKey.Segment, tint, Depth.Shard, at);
      this.sprites.push(sprite);
    }

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
  }
}

/**
 * The two fates draw differently — spilled sugar fades, a waiting batch does
 * not — so one pass sorts the cut pieces into the pool each belongs to.
 */
const splitByFate = (
  pieces: readonly Severed[],
): { crumble: Segment[]; chop: Segment[] } => {
  const crumble: Segment[] = [];
  const chop: Segment[] = [];

  for (const piece of pieces) {
    const into = piece.fate === 'crumble' ? crumble : chop;
    into.push(...piece.segments);
  }

  return { crumble, chop };
};

/**
 * The candy cache, drawn beside the board: one sprite per slot, shown only
 * while a candy occupies it. Oldest sits at the top, which is the order the
 * core keeps the shelf in (design §5).
 */
class ShelfStrip {
  private readonly slots: Drawn[] = [];
  /** The shelf the slots currently show — see `render`. */
  private drawn: readonly Candy[] | undefined;

  constructor(scene: Phaser.Scene) {
    for (let slot = 0; slot < SHELF_SLOTS; slot += 1) {
      const at = { x: SHELF_X, y: SHELF_TOP + slot * SHELF_PITCH };

      scene.add
        .rectangle(at.x, at.y, SLOT_SIZE, SLOT_SIZE)
        // The board's own outline: an empty slot is chrome, and chrome on this
        // board is one color.
        .setStrokeStyle(PIXEL_SCALE / 2, BORDER)
        .setDepth(Depth.Floor);

      this.slots.push(
        makeDrawn(
          scene,
          {
            key: TextureKey.Candy,
            depth: Depth.Shelf,
            glyphDepth: Depth.ShelfGlyph,
          },
          at,
        ),
      );
    }
  }

  /**
   * The core replaces the whole shelf array whenever a candy is racked, so an
   * unchanged reference means an unchanged shelf — and re-stamping six glyph
   * textures every grid move to draw the same six candies is pure waste.
   */
  render(shelf: readonly Candy[]): void {
    if (shelf === this.drawn) return;
    this.drawn = shelf;

    this.slots.forEach((slot, index) => {
      const candy = shelf[index];
      show(slot, candy !== undefined);
      if (candy !== undefined) paint(slot, candy.color);
    });
  }
}

/** Draws the board from game state. Owns no rules — it only reflects state. */
export class BoardView {
  private readonly head: SpritePool;
  private readonly segments: SpritePool;
  private readonly sugar: SpritePool;
  private readonly dyes: SpritePool;
  private readonly debris: SpritePool;
  private readonly batch: SpritePool;
  private readonly shelf: ShelfStrip;
  private readonly shards: ShardBurst;
  private previousPickups: readonly Pickup[] | undefined;

  constructor(private readonly scene: Phaser.Scene) {
    this.drawFloor();
    this.drawStations();
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
    // Severed sugar is still sugar, so it reuses the strand's sprite and
    // keeps its color — but it is frozen where it broke and never slides.
    // Faded, because a block the player no longer steers must not read as
    // part of the strand: hue is spoken for by the color system (design §4),
    // so the separation has to come from value.
    this.debris = new SpritePool(scene, {
      key: TextureKey.Segment,
      depth: Depth.Cut,
      slides: false,
      glyphDepth: Depth.CutGlyph,
      alpha: DEBRIS_ALPHA,
    });
    // A batch waiting at the block is the same frozen piece as debris, but it
    // is product rather than spill: full strength, and already wearing the
    // candy shape it is about to leave as.
    this.batch = new SpritePool(scene, {
      key: TextureKey.Candy,
      depth: Depth.Cut,
      slides: false,
      glyphDepth: Depth.CutGlyph,
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
    this.shelf = new ShelfStrip(scene);
    this.shards = new ShardBurst(scene);
  }

  /** Call when the core has moved the snake to a new set of cells. */
  syncToState(state: GameState): void {
    this.head.retarget([{ pos: state.snake.head }]);
    this.segments.retarget(state.snake.body);

    const { crumble, chop } = splitByFate(state.severed);
    this.debris.retarget(crumble);
    this.batch.retarget(chop);
    this.shelf.render(state.shelf);

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

  /**
   * A soft local puff at one cell, rather than a screen flash — a block of
   * debris coming apart, or a dye that found no strand to knead itself into.
   */
  splash(pos: Vec2, color: ColorMask): void {
    this.shards.burst({ pos, color });
  }

  private drawStations(): void {
    for (const cell of CHOP_BLOCK_CELLS) {
      makeSprite(
        this.scene,
        TextureKey.Block,
        BLOCK_TINT,
        Depth.Station,
        cellToPixel(cell),
      );
    }
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
