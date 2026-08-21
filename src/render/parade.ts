import { BLUE, RED, YELLOW } from '../core/colors';
import type { ColorMask, Vec2 } from '../core/types';
import { CHILD_TINT, HEAD_TINT, NO_TINT } from './drawn';
import { meltedTints, type CornerTints } from './melt';
import { strandSpriteAt } from './strand';
import { CELL_SIZE, STRAND_TEXTURES, TextureKey } from './textures';

/**
 * The menu's parade: a short strand walks one way across the band under the
 * title while a child carrying a candy walks the other, and they pass in front
 * of the high-score table.
 *
 * It is there because the front of the shop showed none of the shop — four
 * lines of text over an empty band, when every sprite the game owns is already
 * baked by the time the menu draws (`BootScene`). What walks past is also the
 * palette: six of the eight colors, each wearing its accessibility symbol
 * (design §4), read by the player before they have pressed anything.
 *
 * Pure by design, like `strand.ts` and `melt.ts` beside it. The cast is a table
 * and a frame is arithmetic over it, which is exactly the kind of thing a
 * screenshot cannot check — so it lives where Node can (architecture §11) and
 * `ui/parade.ts` does nothing but push the numbers into sprites.
 *
 * Nothing here is random. The parade is presentation, but a fixed cast walking
 * at fixed speeds needs no randomness at all, which keeps `core/rng.ts` the
 * only place the game draws from either way.
 */

/**
 * The colors the strand carries past, head end first — a rainbow through every
 * second- and third-tier color the palette can make. Brown is left out on
 * purpose: it is the mistake color (design §4), and the front of the shop is
 * not the place to advertise one.
 */
const STRAND_COLORS: readonly ColorMask[] = [
  RED,
  RED | YELLOW,
  YELLOW,
  YELLOW | BLUE,
  BLUE,
  RED | BLUE,
];

/** The head, plus one cell per color behind it. */
const STRAND_CELLS = STRAND_COLORS.length + 1;

/**
 * The strand's cells as board cells, so `strandSpriteAt` can pick its pieces
 * the same way the board does rather than this file asserting that a rope
 * running east is a row of straight pieces with a cap on the end. It is — but
 * the day that stops being true, the menu should be wrong in the same way the
 * kitchen is, not in a different one.
 *
 * Laid out heading east well inside the board, so no neighbour lookup wraps.
 */
const cellAt = (index: number): Vec2 => ({ x: STRAND_CELLS - index, y: 0 });

/** Where each walker's row sits inside the band, measured from its middle. */
const STRAND_LANE = 6;
/**
 * The child walks the higher row, which in this kitchen reads as the row
 * further back — the same thing the serving queue's lanes say (`customerView`).
 * The depths below agree with it, so a crossing reads as one passing behind
 * the other rather than as two sprites fighting over the same pixels.
 */
const CHILD_LANE = -10;
/**
 * How far ahead of the child the candy is carried. In front rather than in a
 * bubble over their head, which is how the serving queue holds an *order* up:
 * this one has already been paid for, and a candy held out ahead costs the band
 * no height at all — height it would have had to take off the score table.
 */
const CANDY_REACH = 20;

/**
 * Negative throughout: the menu's words are what the screen is for, and they
 * are drawn at the display list's own depth. A parade that could cover one is
 * a parade in the wrong place.
 */
const Depth = {
  Child: -8,
  ChildFace: -7,
  /** Held out in front of the child, so it draws over their arm. */
  Candy: -6,
  CandyGlyph: -5,
  Strand: -4,
  StrandGlyph: -3,
} as const;

/**
 * Which walker a member belongs to. Members of one walker move together, so
 * this is what a pose is looked up by.
 */
export const Walker = {
  Strand: 'strand',
  Child: 'child',
} as const;
export type Walker = (typeof Walker)[keyof typeof Walker];

/**
 * One member of the parade, fixed for the life of the screen: the sprite it is
 * built as and how it is painted. Everything that moves is in `ParadePose`.
 */
export interface ParadeMember {
  /** Who it walks with, and so which edge its own position is measured from. */
  readonly walker: Walker;
  /** The texture it is built with, and the one it wears whenever it is still. */
  readonly key: TextureKey;
  readonly tint: number;
  /** The strand's melted seams; flat-tinted members leave this out. */
  readonly corners: CornerTints | undefined;
  /** The color whose symbol is stamped on it, or none for the shop's chrome. */
  readonly color: ColorMask | undefined;
  readonly depth: number;
  readonly glyphDepth: number | undefined;
  readonly angle: number;
  /** Where its centre sits, measured right from the walker's left edge. */
  readonly dx: number;
  /** Its row inside the band, measured down from the middle. */
  readonly lane: number;
}

interface Walk {
  /** Pixels a second. */
  readonly speed: number;
  readonly rightward: boolean;
  /** How wide the walker is, so it can be off-screen entirely before it turns. */
  readonly span: number;
  /**
   * The breath between one crossing and the next, in pixels of travel. Without
   * it a walker's head enters at the left in the same frame its tail leaves at
   * the right, which reads as a conveyor belt rather than as someone walking by.
   */
  readonly gap: number;
  /** Where in its loop it stands at time zero, as a fraction of the loop. */
  readonly phase: number;
}

/**
 * The two walks. The speeds are a long way apart and neither loop is a multiple
 * of the other, so where the two cross drifts down the band instead of landing
 * on the same spot every time.
 *
 * The phases open the screen mid-scene: the strand already halfway across, the
 * child just stepping in from the right.
 */
const WALKS: Record<Walker, Walk> = {
  [Walker.Strand]: {
    speed: 96,
    rightward: true,
    span: STRAND_CELLS * CELL_SIZE,
    gap: 120,
    phase: 0.35,
  },
  [Walker.Child]: {
    speed: 132,
    rightward: false,
    span: CELL_SIZE + CANDY_REACH,
    gap: 200,
    phase: 0.02,
  },
};

/**
 * The rope's cells, head first. The head holds no color — it is the maker, not
 * a candy — so it is flat-tinted and carries no symbol, and the cell behind it
 * melts into nothing on that side.
 */
const strandMembers = (): readonly ParadeMember[] => {
  const { span } = WALKS[Walker.Strand];
  // The head leads, so it sits at the right-hand end of a rope walking east.
  const dxOf = (index: number): number => span - CELL_SIZE / 2 - index * CELL_SIZE;

  const head: ParadeMember = {
    walker: Walker.Strand,
    key: TextureKey.Head,
    tint: HEAD_TINT,
    corners: undefined,
    color: undefined,
    depth: Depth.Strand,
    glyphDepth: undefined,
    angle: 0,
    dx: dxOf(0),
    lane: STRAND_LANE,
  };

  return [
    head,
    ...STRAND_COLORS.map((color, at) => {
      // `at` counts colors; `index` counts cells, and the head is cell zero.
      const index = at + 1;
      const last = at === STRAND_COLORS.length - 1;
      const sprite = strandSpriteAt(
        cellAt(index),
        cellAt(index - 1),
        last ? undefined : cellAt(index + 1),
      );

      return {
        walker: Walker.Strand,
        key: STRAND_TEXTURES[sprite.piece],
        tint: NO_TINT,
        corners: meltedTints(color, sprite, STRAND_COLORS[at - 1], STRAND_COLORS[at + 1]),
        color,
        depth: Depth.Strand,
        glyphDepth: Depth.StrandGlyph,
        angle: sprite.angle,
        dx: dxOf(index),
        lane: STRAND_LANE,
      };
    }),
  ];
};

/** The child, their face, and the candy they are carrying home. */
const CHILD_MEMBERS: readonly ParadeMember[] = [
  {
    walker: Walker.Child,
    key: TextureKey.Customer,
    tint: CHILD_TINT,
    corners: undefined,
    color: undefined,
    depth: Depth.Child,
    glyphDepth: undefined,
    angle: 0,
    // The child walks west, so the candy they hold out is the western end of
    // their span and they are the eastern one.
    dx: CANDY_REACH + CELL_SIZE / 2,
    lane: CHILD_LANE,
  },
  {
    walker: Walker.Child,
    key: TextureKey.FaceHappy,
    tint: CHILD_TINT,
    corners: undefined,
    color: undefined,
    depth: Depth.ChildFace,
    glyphDepth: undefined,
    angle: 0,
    dx: CANDY_REACH + CELL_SIZE / 2,
    lane: CHILD_LANE,
  },
  {
    walker: Walker.Child,
    key: TextureKey.Candy,
    tint: NO_TINT,
    // Painted from `color` like any other candy, so the menu cannot show a hue
    // the palette does not hold.
    corners: undefined,
    color: RED | BLUE,
    depth: Depth.Candy,
    glyphDepth: Depth.CandyGlyph,
    angle: 0,
    dx: CELL_SIZE / 2,
    lane: CHILD_LANE,
  },
];

/** The cast, in the order `paradePoses` answers in. */
export const PARADE: readonly ParadeMember[] = [...strandMembers(), ...CHILD_MEMBERS];

/** Where one member of `PARADE` stands this frame. */
export interface ParadePose {
  readonly x: number;
  readonly y: number;
  /** Off the band entirely, so the view can hide it rather than park it. */
  readonly visible: boolean;
  /** The child's legs change frame mid-stride; everything else keeps its own. */
  readonly key: TextureKey;
}

const TAU = Math.PI * 2;

/**
 * The rope's wobble. Small and slow, and lagged one cell to the next so the
 * wave travels down the strand rather than the whole thing rising at once —
 * pulled sugar rather than a row of beads (design §2).
 *
 * Whole pixels, like the queue's lane: this is drawn art, and half a pixel of
 * rise only softens it.
 */
const BOB_AMPLITUDE = 2;
const BOB_MS = 900;
/** Cycles of lag per cell, so the wave is about eight cells long. */
const BOB_LAG = 0.12;

/**
 * The child's step, derived rather than borrowed: `customerView` swaps legs
 * every 140 ms at 260 px/s, and a stride is a distance rather than a duration,
 * so a slower walk has to hold each frame for longer or the child scurries.
 */
const CHILD_STEP_MS = Math.round(140 * (260 / WALKS[Walker.Child].speed));

/** Positive remainder, which `%` is not for a walker that has yet to set off. */
const wrap = (value: number, period: number): number =>
  ((value % period) + period) % period;

/**
 * How far past the band a walker is taken before its loop turns over, and the
 * same distance the poses below are culled at. One number for both on purpose:
 * a walker that turned over while anything of it still counted as visible would
 * jump in plain sight, which is the one thing a loop like this must not do.
 */
const CLEARANCE = CELL_SIZE;

/**
 * The x of a walker's left edge. It runs from clear of one side of the band to
 * clear of the other and then starts again, so nothing ever jumps while it can
 * be seen.
 */
const leftEdge = (nowMs: number, width: number, walk: Walk): number => {
  const crossing = width + walk.span + 2 * CLEARANCE;
  const loop = crossing + walk.gap;
  const travelled = wrap((nowMs / 1_000) * walk.speed + walk.phase * loop, loop);

  return walk.rightward
    ? travelled - walk.span - CLEARANCE
    : width + CLEARANCE - travelled;
};

/**
 * Where every member of `PARADE` stands, in the same order, given the clock and
 * the width of the band. Coordinates are the band's own: x from its left edge,
 * y from its middle.
 *
 * A fresh pose per member per frame, where the board's own hot path is written
 * to allocate nothing: ten objects on an idle menu is not the board's problem,
 * and answering in values rather than through a callback is what lets the whole
 * of it be read back under Node.
 */
export const paradePoses = (nowMs: number, width: number): readonly ParadePose[] => {
  const edges: Record<Walker, number> = {
    [Walker.Strand]: leftEdge(nowMs, width, WALKS[Walker.Strand]),
    [Walker.Child]: leftEdge(nowMs, width, WALKS[Walker.Child]),
  };
  // Both halves of the child's walk: the leg they are on, and the pixel a step
  // lifts them by. Off the clock rather than off their own distance, so a queue
  // of them would step in time (`customerView`).
  const stepping = Math.floor(nowMs / CHILD_STEP_MS) % 2 === 1;
  const dip = stepping ? -1 : 0;
  const wobble = (index: number): number =>
    Math.round(BOB_AMPLITUDE * Math.sin(TAU * (nowMs / BOB_MS + index * BOB_LAG)));

  return PARADE.map((member, index) => {
    const x = edges[member.walker] + member.dx;

    return {
      x,
      y: member.lane + (member.walker === Walker.Strand ? wobble(index) : dip),
      visible: x > -CLEARANCE && x < width + CLEARANCE,
      key:
        stepping && member.key === TextureKey.Customer
          ? TextureKey.CustomerStride
          : member.key,
    };
  });
};
