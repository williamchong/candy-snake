import type Phaser from 'phaser';

import { CHOP_BLOCK_CELLS, COLS, ROWS } from '../core/board';
import { colorInfo, type Primary } from '../core/colors';
import {
  RAW,
  type ColorMask,
  type GameState,
  type Pickup,
  type Segment,
  type Severed,
  type SnakeState,
  type Vec2,
} from '../core/types';
import type { Frame } from '../ui/layout';
import {
  BORDER,
  makeDrawn,
  makeSprite,
  paint,
  place,
  show,
  type Drawn,
  type DrawnConfig,
} from './drawn';
import { meltedTints, mixTint, type CornerTints } from './melt';
import { strandSpriteAt } from './strand';
import { CELL_SIZE, PIXEL_SCALE, STRAND_TEXTURES, TextureKey } from './textures';

/**
 * The board draws itself in its own coordinates — origin at its top-left corner,
 * 16×16 cells of `CELL_SIZE` — and is fitted to the device by scaling the
 * container it all lives in (see `applyFrame`). Nothing in here knows the screen
 * size, which is what keeps `ui/layout.ts` the only file that does
 * (architecture §9).
 */
const BOARD_X = 0;
const BOARD_Y = 0;

/**
 * Chrome thickness in screen pixels. Held separately from `PIXEL_SCALE`: how
 * thick an outline should look is not a function of how many source texels a
 * sprite is authored at, and tying the two means re-authoring the sprites
 * silently redraws the furniture.
 */
const BOARD_BORDER_WIDTH = 4;

/**
 * Hue carries meaning in this game, so only candies may spend it (design §4,
 * palette constraints). The head is not a candy: it is separated by value, as
 * the darkest thing on the board.
 */
const HEAD_TINT = 0x6e6478;

/**
 * The bench sits between the head and the floor in value, and takes no hue —
 * it is furniture, and a candy resting on it has to stay the brighter thing.
 */
const BLOCK_TINT = 0xc4b2d2;

/** A sugar cube is raw sugar, so it takes raw's color from the palette. */
const SUGAR_TINT = colorInfo(RAW).hex;

const SHATTER_MS = 280;

/**
 * How long the head wears a jar's hue after opening it. It is a confirmation,
 * not a state — hue belongs to candies (design §4) — so it has to be over
 * before the first segment turns behind it, or the head is showing a candy
 * hue at the moment the player looks at the strand to read one. That deadline
 * is one grid move, and the difficulty ramp takes that down to 125 ms/cell
 * (design §7), so the flash stays under the *fastest* move rather than the
 * current one.
 */
const DYE_FLASH_MS = 120;

/** Enough to read debris as spilled sugar rather than as live strand. */
const DEBRIS_ALPHA = 0.5;

/** The pixel centre of a board row; `cellToPixel` is this plus the column. */
const rowToPixel = (row: number): number => BOARD_Y + row * CELL_SIZE + CELL_SIZE / 2;

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
} as const;

/**
 * Moves freshly built objects into the board's container. `scene.add.*` puts
 * them on the scene's own display list, so everything the board draws has to be
 * taken in here or it would sit outside the container and never be scaled with
 * the rest of it.
 *
 * A container keeps its children in insertion order, and the pools build theirs
 * lazily — so the sort is what stops a sprite spawned late from landing above
 * the layer that owns it. Cheap enough to do on every adoption: pools grow to
 * the run's peak and then stop.
 */
const adopt = (
  root: Phaser.GameObjects.Container,
  ...objects: readonly (Phaser.GameObjects.GameObject | undefined)[]
): void => {
  for (const object of objects) {
    if (object !== undefined) root.add(object);
  }
  root.sort('depth');
};

/**
 * Anything that sits on a board cell. `color` is what a sprite is tinted and
 * stamped from; the head and sugar have none and fall back to the pool's own
 * tint. `Segment` satisfies this as-is; a dye `Pickup` names the same value
 * `primary`, so `syncToState` relabels it.
 */
interface Placed {
  readonly pos: Vec2;
  readonly color?: ColorMask;
  /**
   * Overrides the pool's texture for this item. The strand needs it: which
   * piece of rope a cell draws depends on where its neighbours are, so one
   * pool stamps straights, elbows and the end cap (see `strand.ts`).
   */
  readonly key?: TextureKey;
  /** Rotation in degrees, for pieces authored in one orientation and turned. */
  readonly angle?: number;
  /** Per-corner tints, for sprites drawn as a gradient rather than flat. */
  readonly melt?: CornerTints;
}

/** A sprite mid-slide between the cell it left and the cell it is entering. */
interface Sliding extends Drawn {
  from: Vec2;
  to: Vec2;
}

interface PoolConfig extends DrawnConfig {
  /**
   * Whether a sprite keeps its identity between ticks. The strand does — a
   * body segment slides into the cell ahead of it. Pickups do not: spending
   * one splices the array and a fresh sugar takes the freed index, so sliding
   * would show new sugar gliding out of the snake's mouth. Debris does not
   * either — it is frozen by definition.
   */
  readonly slides: boolean;
}

const cellToPixel = (cell: Vec2): Vec2 => ({
  x: BOARD_X + cell.x * CELL_SIZE + CELL_SIZE / 2,
  y: rowToPixel(cell.y),
});

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
  /**
   * How many entries are in use. Everything past it is already hidden, so
   * neither loop below has to walk it — and it can be a long tail now that
   * chopping empties the strand outright every batch.
   */
  private active = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly root: Phaser.GameObjects.Container,
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

      paint(entry, item.color, item.melt);
      entry.image.setTexture(item.key ?? this.config.key);
      // Only the sprite turns. The glyph riding on it stays upright, because a
      // symbol the player has to read must not rotate with the rope (design §4).
      entry.image.setAngle(item.angle ?? 0);
      show(entry, true);
      place(entry, entry.from.x, entry.from.y);
    });

    for (let index = items.length; index < this.active; index += 1) {
      const entry = this.entries[index];
      if (entry !== undefined) show(entry, false);
    }
    this.active = items.length;
  }

  /**
   * Overrides the tint of every live sprite. Only a pool whose items carry no
   * color of their own can use this — `retarget` repaints the others from
   * state on the next move and would wipe it out.
   */
  wash(tint: number): void {
    for (let index = 0; index < this.active; index += 1) {
      this.entries[index]?.image.setTint(tint);
    }
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
    const drawn = makeDrawn(this.scene, this.config, at);
    adopt(this.root, drawn.image, drawn.glyph);

    return { ...drawn, from: at, to: at };
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

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly root: Phaser.GameObjects.Container,
  ) {}

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
      adopt(this.root, sprite);
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
 * Resolves the strand into rope pieces. Each segment is drawn from where its
 * neighbours sit — the segment ahead of it (the head, for the first) and the
 * one behind (nothing, for the loose end) — which is what makes the body one
 * continuous pull of sugar rather than a row of beads (design §2).
 */
const strandPieces = ({ head, body }: SnakeState): Placed[] =>
  body.map((segment, index) => {
    // At index 0 there is no `body[-1]`, so this already falls back to the
    // head — which is exactly the segment ahead of the first one.
    const ahead = body[index - 1];
    const behind = body[index + 1];
    const sprite = strandSpriteAt(segment.pos, ahead?.pos ?? head, behind?.pos);

    return {
      pos: segment.pos,
      color: segment.color,
      key: STRAND_TEXTURES[sprite.piece],
      angle: sprite.angle,
      melt: meltedTints(segment.color, sprite, ahead?.color, behind?.color),
    };
  });

/** Draws the board from game state. Owns no rules — it only reflects state. */
export class BoardView {
  /**
   * Everything the board draws, held as one object so the whole kitchen is
   * fitted to the device by a single position and scale (see `applyFrame`).
   */
  private readonly root: Phaser.GameObjects.Container;
  private readonly head: SpritePool;
  private readonly segments: SpritePool;
  private readonly sugar: SpritePool;
  private readonly dyes: SpritePool;
  private readonly debris: SpritePool;
  private readonly batch: SpritePool;
  private readonly shards: ShardBurst;
  private previousPickups: readonly Pickup[] | undefined;
  /** The head's dye flash, held so a second jar can cut the first one short. */
  private headFlash: Phaser.Tweens.Tween | undefined;

  constructor(private readonly scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0);
    this.drawFloor();
    this.drawStations();
    this.sugar = new SpritePool(scene, this.root, {
      key: TextureKey.Sugar,
      tint: SUGAR_TINT,
      depth: Depth.Pickup,
      slides: false,
    });
    // Jars carry their primary as their color, so one pool serves all three.
    this.dyes = new SpritePool(scene, this.root, {
      key: TextureKey.Dye,
      depth: Depth.Pickup,
      slides: false,
      glyphDepth: Depth.PickupGlyph,
    });
    // Severed sugar is still sugar and keeps its color, but it is no longer
    // rope: a broken piece comes apart as lozenges, frozen where it broke, and
    // never slides. Faded too, because a block the player no longer steers
    // must not read as part of the strand — hue is spoken for by the color
    // system (design §4), so the separation has to come from value.
    this.debris = new SpritePool(scene, this.root, {
      key: TextureKey.Segment,
      depth: Depth.Cut,
      slides: false,
      glyphDepth: Depth.CutGlyph,
      alpha: DEBRIS_ALPHA,
    });
    // A batch waiting at the block is the same frozen piece as debris, but it
    // is product rather than spill: full strength, and already wearing the
    // candy shape it is about to leave as.
    this.batch = new SpritePool(scene, this.root, {
      key: TextureKey.Candy,
      depth: Depth.Cut,
      slides: false,
      glyphDepth: Depth.CutGlyph,
    });
    // Every item overrides this with the rope piece its neighbours call for;
    // the straight is only the pool's starting texture.
    this.segments = new SpritePool(scene, this.root, {
      key: TextureKey.StrandStraight,
      depth: Depth.Segment,
      slides: true,
      glyphDepth: Depth.SegmentGlyph,
    });
    this.head = new SpritePool(scene, this.root, {
      key: TextureKey.Head,
      tint: HEAD_TINT,
      depth: Depth.Head,
      slides: true,
    });
    this.shards = new ShardBurst(scene, this.root);
  }

  /** Call when the core has moved the snake to a new set of cells. */
  syncToState(state: GameState): void {
    this.head.retarget([{ pos: state.snake.head }]);
    this.segments.retarget(strandPieces(state.snake));

    const { crumble, chop } = splitByFate(state.severed);
    this.debris.retarget(crumble);
    this.batch.retarget(chop);

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

  /**
   * The maker takes the jar's color for a moment and washes back to its own —
   * confirmation that the pickup landed, on the move it landed, since the
   * strand itself does not start turning until the move after (design §4).
   * Borrowed, never kept: `HEAD_TINT` is where it always ends up, so the head
   * cannot be mistaken for a candy hue once the tween is done.
   */
  flashHead(primary: Primary): void {
    // Taking a second jar mid-flash restarts from that jar's color rather than
    // leaving two tweens writing the same tint on the same frame.
    this.headFlash?.stop();

    const wash = { t: 0 };
    const from = colorInfo(primary).hex;

    this.head.wash(from);
    this.headFlash = this.scene.tweens.add({
      targets: wash,
      t: 1,
      duration: DYE_FLASH_MS,
      ease: 'Quad.easeIn',
      onUpdate: () => this.head.wash(mixTint(from, HEAD_TINT, wash.t)),
      onComplete: () => this.head.wash(HEAD_TINT),
    });
  }

  /**
   * Fits the kitchen to the device. The board is authored at one fixed cell
   * size and everything in it positioned in those units, so the whole of the
   * responsive pass on this side is a position and a scale — which is what
   * keeps `CELL_SIZE` a constant, and the accessibility glyphs baked at the
   * size they are stamped at (design §4).
   *
   * Safe to call mid-run and as often as the device fires resizes: it moves the
   * container and touches nothing else, so a strand mid-slide carries on from
   * where it was.
   */
  applyFrame(frame: Frame): void {
    this.root.setPosition(frame.board.x, frame.board.y).setScale(frame.board.scale);
  }

  private drawStations(): void {
    for (const cell of CHOP_BLOCK_CELLS) {
      adopt(
        this.root,
        makeSprite(
          this.scene,
          TextureKey.Block,
          BLOCK_TINT,
          Depth.Station,
          cellToPixel(cell),
        ),
      );
    }
  }

  private drawFloor(): void {
    const floor = this.scene.add
      .image(BOARD_X, BOARD_Y, TextureKey.Floor)
      .setOrigin(0)
      .setScale(CELL_SIZE)
      .setDepth(Depth.Floor);

    const border = this.scene.add
      .rectangle(BOARD_X, BOARD_Y, COLS * CELL_SIZE, ROWS * CELL_SIZE)
      .setOrigin(0)
      .setStrokeStyle(BOARD_BORDER_WIDTH, BORDER)
      .setDepth(Depth.Floor);

    adopt(this.root, floor, border);
  }
}
