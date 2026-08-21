import type Phaser from 'phaser';

import { CHOP_BLOCK_CELLS, COLS, ROWS, eq } from '../core/board';
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
import { ring } from './burst';
import {
  BORDER,
  adopt,
  makeDrawn,
  makeSprite,
  paint,
  place,
  show,
  type Drawn,
  type DrawnConfig,
} from './drawn';
import {
  deformX,
  deformY,
  pullAmount,
  pullShapeOf,
  swallowAmount,
  PullShape,
  SWALLOW_MS,
} from './deform';
import { Burst, knock, type BurstConfig } from './effects';
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
/**
 * The head's gear-change pulse. Longer than the dye flash and deliberately so:
 * a jar landing is confirmation of something the player just did and only has
 * to keep up with them, where a rung of the speed ladder is news they did not
 * ask for and have to catch while steering (design §11's glance).
 */
const QUICKEN_FLASH_MS = 260;
/**
 * What the head goes to. Pale ink rather than a hue — the strand runs hotter,
 * and heat is the one thing in this kitchen that could reasonably be drawn in
 * orange, which is exactly why it is not: colour belongs to candies (design §4)
 * and a head that flashed a secondary would read as a candy being made.
 */
const QUICKEN_TINT = 0xf2ecf7;

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
  /**
   * Which way this piece may be drawn out as it travels, or absent for anything
   * that must not deform at all. The head leaves it out: it is the maker rather
   * than sugar — the thing doing the pulling is not the thing being pulled —
   * and scaling it unevenly would smear the two dots it has for eyes.
   */
  readonly pull?: PullShape;
}

/** A sprite mid-slide between the cell it left and the cell it is entering. */
interface Sliding extends Drawn {
  from: Vec2;
  to: Vec2;
  pull: PullShape | undefined;
  /**
   * Scene time the swallow ends at, or 0 for a sprite that is not swallowing.
   * A deadline rather than a tween: `draw` already writes this sprite's scale
   * every frame, and a tween on the same property would be fighting it.
   */
  swallowUntil: number;
  /**
   * Whether the sprite is off its resting size. The strand is at rest for most
   * of most frames, so this is what makes settling a single write rather than
   * one per sprite per frame — the same latch `CustomerView` keeps for its
   * breathing bubble, for the same reason.
   */
  deformed: boolean;
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
      // Only `draw` ever writes scale, and only for a sprite carrying a pull
      // shape — so this is what stops one handed back to the pool as a
      // different segment from inheriting the stretch the last one was wearing.
      entry.image.setScale(PIXEL_SCALE);
      entry.pull = item.pull;
      entry.swallowUntil = 0;
      entry.deformed = false;
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

    const now = this.scene.time.now;
    for (let index = 0; index < this.active; index += 1) {
      const entry = this.entries[index];
      if (entry === undefined) continue;

      place(
        entry,
        entry.from.x + (entry.to.x - entry.from.x) * progress,
        entry.from.y + (entry.to.y - entry.from.y) * progress,
      );
      if (entry.pull !== undefined) {
        this.deform(entry, entry.pull, index, progress, now);
      }
    }
  }

  /**
   * Draws one piece out along itself as the maker hauls on the strand, and
   * swells it where a cube has just gone in. Both at once, multiplied together
   * rather than one taking the sprite from the other — a swallow lands on a
   * segment that may well be mid-slide, and neither has to know about the other
   * for the two to compose.
   *
   * `fromHead` is the pool's own loop index, which means distance from the
   * maker for the strand and nothing at all for any other pool — those are
   * spared by carrying no pull shape rather than by knowing that.
   *
   * The write is on `entry.image` and never through `place` or `scaleDrawn`:
   * the glyph riding on it must not deform, for exactly the reason `retarget`
   * above already gives for rotation — a symbol the player has to read must
   * stay readable (design §4).
   */
  private deform(
    entry: Sliding,
    shape: PullShape,
    fromHead: number,
    progress: number,
    now: number,
  ): void {
    const pull = pullAmount(progress, fromHead);
    const swallow = swallowAmount(entry.swallowUntil - now);

    if (pull === 0 && swallow === 0) {
      // One write on the frame it settles, and none on the frames after it.
      if (!entry.deformed) return;
      entry.deformed = false;
      entry.image.setScale(PIXEL_SCALE);
      return;
    }

    entry.deformed = true;
    entry.image.setScale(
      PIXEL_SCALE * deformX(shape, pull, swallow),
      PIXEL_SCALE * deformY(pull, swallow),
    );
  }

  /**
   * Marks whatever is standing on `cell` as having just taken a cube in.
   * Matched by the cell it is bound for rather than by index, because which
   * index the new tail landed on is not something the caller should know.
   */
  swallow(cell: Vec2): void {
    const at = cellToPixel(cell);

    for (let index = 0; index < this.active; index += 1) {
      const entry = this.entries[index];
      if (entry !== undefined && eq(entry.to, at)) {
        entry.swallowUntil = this.scene.time.now + SWALLOW_MS;
        return;
      }
    }
  }

  private spawn(at: Vec2): Sliding {
    const drawn = makeDrawn(this.scene, this.config, at);
    adopt(this.root, drawn.image, drawn.glyph);

    return {
      ...drawn,
      from: at,
      to: at,
      pull: undefined,
      swallowUntil: 0,
      deformed: false,
    };
  }
}

/**
 * The one-cell puff: a block of debris coming apart, or a wasted dye. It swells
 * and thins where it stood and throws nothing, because design §2 asks for local
 * and soft — a self-hit puffs at the cells that broke, never a screen flash.
 */
const PUFF: BurstConfig = {
  key: TextureKey.Segment,
  depth: Depth.Shard,
  durationMs: SHATTER_MS,
  growth: 1.5,
};

/**
 * How far a crumb is thrown. Far enough to clear the candy it came off — a
 * crumb still sitting on it reads as one blob rather than as something coming
 * apart — and no further than the cell's own edge, because design §2 asks for
 * local and soft and a pop that reaches the next cell reads as something
 * happening there too.
 */
const CRUMB_THROW = (CELL_SIZE * 5) / 8;

/**
 * A candy leaving the block. Shorter than a puff and it swells less: the candy
 * is not being lost, it is being made, so this is a hand-off rather than a
 * thing coming apart.
 */
const CHOP_POP: BurstConfig = {
  key: TextureKey.Candy,
  depth: Depth.Shard,
  durationMs: 180,
  growth: 1.4,
};

/**
 * The sugar that does not make it into the candy. Crumbs *shrink* as they fly —
 * they are dust settling, not something arriving — which is also what keeps
 * five of them from reading as five more candies.
 */
const CHOP_CRUMBS: BurstConfig = {
  key: TextureKey.Pip,
  depth: Depth.Shard,
  durationMs: 240,
  growth: 0.7,
  thrown: { pieces: 5, distance: CRUMB_THROW, fling: ring },
};

/**
 * How far a shard is thrown: further than a crumb, because a break is an
 * accident where a chop is a hand-off. Still inside the cell it happened on,
 * which is design §2's constraint on every effect here.
 */
const SHARD_THROW = (CELL_SIZE * 7) / 8;

/**
 * The strand letting go where it was hit. Lozenges rather than rope — design §2
 * is explicit that a piece cut loose is not rope any more — and they shrink as
 * they fly, so the burst reads as the strand coming apart rather than as seven
 * new segments appearing at the impact.
 */
const SHATTER: BurstConfig = {
  key: TextureKey.Segment,
  depth: Depth.Shard,
  durationMs: SHATTER_MS,
  growth: 0.6,
  thrown: { pieces: 7, distance: SHARD_THROW, fling: ring },
};

/**
 * The knock a break puts through the kitchen, and the one place this game moves
 * the whole play field.
 *
 * Design §2 forbids a screen flash and makes comfort a constraint rather than a
 * polish item, so this is budgeted in pixels rather than in Phaser's own units
 * (see `knockIntensity`) and kept to a jolt: two pixels for an eighth of a
 * second is about seven frames of jitter, under the amplitude where a knock
 * starts reading as a strobe. Architecture §6 put the HUD in its own scene so
 * this could exist at all; this is the first thing to spend that.
 */
const KNOCK_PIXELS = 2;
const KNOCK_MS = 120;

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
      pull: pullShapeOf(sprite),
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
  private readonly puff: Burst;
  private readonly chopPop: Burst;
  private readonly chopCrumbs: Burst;
  private readonly shards: Burst;
  /**
   * Impacts waiting out their move, and impacts reported this one.
   *
   * The view draws the strand *arriving* at the cell it already occupies
   * logically (see `syncToState`), so a break played on the tick it was
   * reported puts the shards and the knock a whole cell ahead of the head that
   * caused them. Held a move, they land as the head is seen to arrive.
   *
   * Two fields rather than a queue with a delay on it: the hold is exactly one
   * move and has to stay that way, and a general "play this later" is how it
   * quietly becomes two.
   */
  private held: Segment[] = [];
  private breaking: Segment[] = [];
  /**
   * Cubes taken in this move, waiting for the strand to be retargeted around
   * them: the segment the swallow plays on does not exist until `syncToState`
   * has run, because it *is* the cube.
   */
  private swallowing: Vec2[] = [];
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
    this.puff = new Burst(scene, PUFF, this.root);
    this.chopPop = new Burst(scene, CHOP_POP, this.root);
    this.chopCrumbs = new Burst(scene, CHOP_CRUMBS, this.root);
    this.shards = new Burst(scene, SHATTER, this.root);
  }

  /** Call when the core has moved the snake to a new set of cells. */
  syncToState(state: GameState): void {
    this.head.retarget([{ pos: state.snake.head }]);
    this.segments.retarget(strandPieces(state.snake));

    // After the retarget above, never before it: `retarget` clears the mark on
    // every entry, which is what stops a sprite that becomes a different
    // segment next move from inheriting a swallow that was not its own.
    for (const pos of this.swallowing) this.segments.swallow(pos);
    this.swallowing = [];

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
    this.playHeldBreaks();
  }

  /**
   * Plays the impacts reported a move ago and takes this move's in. The swap is
   * the whole of the hold — see `held` — and lives in one place so it cannot
   * silently become none or two.
   */
  private playHeldBreaks(): void {
    for (const impact of this.held) {
      this.shards.fire(cellToPixel(impact.pos), colorInfo(impact.color).hex);
      knock(this.scene, KNOCK_PIXELS, KNOCK_MS);
    }

    this.held = this.breaking;
    this.breaking = [];
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
    this.puff.fire(cellToPixel(pos), colorInfo(color).hex);
  }

  /**
   * A candy leaving the block for the rack: it blooms off the bench and takes a
   * few crumbs of sugar with it. Fired on the move it happens — the batch is
   * drawn straight from state and never slides, so the candy the player was
   * looking at goes at the same sync this does, with none of the one-move lag
   * the strand has (see `syncToState`).
   *
   * One candy leaves per move per severed piece, and each from its own cell, so
   * two pops can never land on the same spot in the same frame and superimpose.
   */
  pop(pos: Vec2, color: ColorMask): void {
    const at = cellToPixel(pos);
    const tint = colorInfo(color).hex;

    this.chopPop.fire(at, tint);
    this.chopCrumbs.fire(at, tint);
  }

  /**
   * The strand ran into itself. Takes the whole severed piece but bursts only
   * at `severed[0]` — the impact end, which is where the event promises to put
   * it. The rest of the piece is already coming apart one block per move with a
   * puff of its own (design §6), and seven bursts on one tick superimpose into
   * something that reads as one.
   *
   * Held a move before it plays, unlike everything else here: see `held`.
   */
  shatter(severed: readonly Segment[]): void {
    const impact = severed[0];
    if (impact !== undefined) this.breaking.push(impact);
  }

  /**
   * A cube has been pulled into the strand as the new tail, and the strand
   * swells where it went in.
   *
   * This is the one effect the view's one-move lag lets through untouched, and
   * it is worth knowing why. The cube is not spent when the *head* reaches it —
   * it is spent when the **tail vacates its cell**, which is what lets it
   * appear to become the tail rather than vanish (`Game.spendClearedPickups`).
   * The strand is drawn a move behind, so the cell the cube stood on is exactly
   * where the strand is being drawn right now. Nothing to compensate for.
   */
  swallow(pos: Vec2): void {
    this.swallowing.push(pos);
  }

  /**
   * The maker takes the jar's color for a moment and washes back to its own —
   * confirmation that the pickup landed, on the move it landed, since the
   * strand itself does not start turning until the move after (design §4).
   */
  flashHead(primary: Primary): void {
    this.washHead(colorInfo(primary).hex, DYE_FLASH_MS);
  }

  /**
   * The head borrows a color, beats, and is handed back — the shared shape of
   * every effect that writes the head's tint.
   *
   * One tween at a time by construction, because there is one slot: whatever is
   * in flight is stopped before the next claims it, so two effects can never be
   * left writing the same tint on the same frame. `HEAD_TINT` is where every
   * one of them ends up, so the head cannot be left wearing a borrowed color —
   * which for a jar's hue would mean a maker indistinguishable from a candy.
   *
   * `beats` is extra repeats, not total: 0 is one pulse. Not a yoyo — each beat
   * is a strike and a decay, so a repeat starts bright again rather than fading
   * back up into itself.
   */
  private washHead(from: number, durationMs: number, beats = 0): void {
    this.headFlash?.stop();

    const wash = { t: 0 };

    this.head.wash(from);
    this.headFlash = this.scene.tweens.add({
      targets: wash,
      t: 1,
      duration: durationMs,
      repeat: beats,
      ease: 'Quad.easeIn',
      onRepeat: () => this.head.wash(from),
      onUpdate: () => this.head.wash(mixTint(from, HEAD_TINT, wash.t)),
      onComplete: () => this.head.wash(HEAD_TINT),
    });
  }

  /**
   * The strand changes gear: the head pulses pale and settles back (design §7).
   *
   * On the head rather than in the HUD because this is the one announcement
   * whose subject the player is already looking at — the speed that changed is
   * the speed of the thing they are steering, and a pip lighting up beside the
   * score would be news delivered to the wrong end of the screen.
   *
   * `top` pulses twice. The extra beat is the whole of the terminal signal on
   * this side (the cue resolves to an octave on its own): from here the strand
   * never gets faster again, and a run that is never told that is a run spent
   * bracing for an acceleration that is not coming.
   */
  quicken(top: boolean): void {
    this.washHead(QUICKEN_TINT, QUICKEN_FLASH_MS, top ? 1 : 0);
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
