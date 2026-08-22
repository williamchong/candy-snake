import { PRIMARIES, blend, primariesOf, type Primary } from './colors';
import type { Rng } from './rng';
import { RAW, type ColorMask, type GameState } from './types';

/**
 * The four opening levels, which every run starts with (design §7). The board
 * is stocked with exactly what the level's order needs and nothing else:
 *
 * 1. raw — one sugar, no jars: pull sugar, chop at the block.
 * 2. a primary — that jar only: cross the sugar *first*, then the jar.
 * 3. a secondary — those two jars: two dyes blend into one color.
 * 4. that secondary again, for **two** children — two sugars, then the jars:
 *    one cut feeds them both.
 *
 * A restricted board teaches better than any text can, and it restricts *when*
 * as well as *what*: in level 2 the only jar on the floor is the one the order
 * wants, so "wrong dye" is not a mistake the player is able to make, and it is
 * on the floor only while it still has something to do (`stocksDyes`) — not
 * before the first cube is on the strand, and not once the candy has turned.
 * Difficulty here is authored by removing options — with one deliberate
 * exception, which is level 4. Holding its jars back until *both* cubes were on
 * the strand would make the pair the only move it offers, and it strands a maker
 * who does not build to length: carry one cube, find no jar on the floor, take
 * it to the block, and the raw candy nobody ordered goes on the rack while the
 * level starts over, forever. The reference grinder does exactly that. Nothing
 * in the opening levels may be able to stall (design §7), so the last level
 * *offers* its lesson — two children holding up the same bubble, and a second
 * cube on the floor as soon as there is room for it — where the three before it
 * remove the alternative.
 */
export interface TutorialLevel {
  readonly want: ColorMask;
  /**
   * How many children ask for it. One for the three levels that teach a color,
   * two for the level that teaches the batch — the same order twice over, so
   * that one cut can feed both (design §9).
   */
  readonly children: number;
  /** The only dye jars this level permits; `stocksDyes` decides when they go out. */
  readonly stock: readonly Primary[];
}

/** A beat between levels, so the serve reads before the next child walks up. */
export const TUTORIAL_ARRIVAL_GAP_MS = 1_000;

/**
 * The line the HUD hangs over the kitchen while each opening level runs,
 * indexed the way `rollTutorial` orders them: raw first, then one dye, then
 * the mix — whatever colors the seed happens to roll, so the words can stay
 * fixed while the board varies. It lives beside the levels it captions so the
 * two lists cannot drift apart.
 *
 * Each line names only what the player *does* — eat and chop, then dye, then
 * blend. The serve at the end goes unmentioned because it is nothing the
 * player does: a chopped candy is offered to the child at the window by
 * itself (design §5), and the child's own bubble already says what the candy
 * is for.
 */
export const TUTORIAL_HEADLINES: readonly string[] = [
  'Eat sugar and chop it into candy',
  'Dye the sugar to make colored candy',
  'Mix two dyes to make a new color',
  'Chop two candies at once for two children',
];

/**
 * The batch the last opening level teaches — how many children it puts at the
 * window wanting the same candy.
 *
 * What it is *not* is the batch every run has fed: the level offers the pair and
 * does not force it (see the module docblock), and measured on the reference
 * grinder 193 tutorials in 200 end having fed the two children separately. The
 * game-over screen's floor is therefore still 1 and not this.
 */
export const TAUGHT_COMBO = 2;

const level = (want: ColorMask, children = 1): TutorialLevel => ({
  want,
  children,
  stock: primariesOf(want),
});

/**
 * Rolls the four levels from the run's seed, so the tutorial teaches the rule
 * rather than a memorised answer.
 *
 * Level 3 deliberately **extends** level 2's primary instead of drawing a fresh
 * pair. It reads as a progression — you made yellow, now add red for orange —
 * and it means the stocked set only ever grows, so no jar is ever removed from
 * the board mid-run. Nothing on this board teleports, and that includes the
 * tutorial's own furniture.
 */
export const rollTutorial = (rng: Rng): TutorialLevel[] => {
  const first = PRIMARIES[rng.int(PRIMARIES.length)] ?? PRIMARIES[0];
  const rest = PRIMARIES.filter((primary) => primary !== first);
  const second = rest[rng.int(rest.length)] ?? PRIMARIES[1];

  return [
    level(RAW),
    level(first),
    level(first | second),
    level(first | second, TAUGHT_COMBO),
  ];
};

/**
 * The jars a board is allowed to carry: the level's own stock while the
 * tutorial runs, and every primary once it is over — which is the floor the
 * game had before, and what Phase 5's pity spawner replaces (design §8).
 *
 * What the level *permits*, which is not the same as what it lays out right
 * now — see `stocksDyes`.
 */
export const stockedPrimaries = (level: TutorialLevel | undefined): readonly Primary[] =>
  level?.stock ?? PRIMARIES;

/**
 * Whether the run has reached mixing at all: the mix level's two jars, or the
 * endless board's three. The first two opening levels put at most one jar
 * out, so a recipe wheel over them would answer a question the board cannot
 * yet ask — design §7 authors those levels by removing options, and the
 * wheel is one of the options it removes. Read off the stock rather than the
 * level's index, so it stays true to whatever the levels actually permit.
 */
export const mixingUnlocked = (level: TutorialLevel | undefined): boolean =>
  stockedPrimaries(level).length > 1;

/**
 * Children this level still has to send, and so orders it still has to fill.
 * The window opens this many places (`Game.admitCustomer`) and the floor owes
 * this many candies, which is one fact and is why it is not spelled twice.
 */
export const ordersLeft = (
  level: TutorialLevel,
  state: Pick<GameState, 'tutorialServes'>,
): number => level.children - state.tutorialServes;

/** The same, less what is already on the strand: the sugar rule is this above zero. */
const shortfall = (
  level: TutorialLevel,
  state: Pick<GameState, 'snake' | 'tutorialServes'>,
): number => ordersLeft(level, state) - state.snake.body.length;

/**
 * The jars the spawner lays *at this moment*: the level's own stock, narrowed
 * to the ones that would still change the strand.
 *
 * That single test covers both halves of the lesson, because a jar with
 * nothing left to do is a jar the level is not asking for.
 *
 * - **Before.** An empty strand has no segment to change, so no jar goes out.
 *   Level 2 teaches the order the two pickups go in, and a board holding both
 *   at once does not teach it: the jar is a saturated color with a symbol on
 *   it and the cube is off-white, so the wrong move is also the loud one. With
 *   the jar held back there is one thing on the floor to take, and when it does
 *   arrive the maker is carrying something — so the lesson lands as cause and
 *   effect on screen: they cross the jar and watch a segment turn.
 * - **After.** Once the candy carries the color, kneading that primary in
 *   again is a no-op (`blend`), so the level stops laying it. A jar re-laid at
 *   a fresh cell the moment the strand cleared the last one is what eating food
 *   and food respawning looks like, and a playtester who had passed level 1
 *   read it that way: they went on crossing jars instead of taking the finished
 *   candy to the block. The floor going bare is the level saying it is done.
 *
 * This never takes a jar off the floor — the spawner only ever adds
 * (`ensurePickups`), so a jar already laid stays where it is, which is design
 * §7's promise that none of the tutorial's furniture is removed mid-run. That
 * is why this is a separate question from `stockedPrimaries`: the permitted set
 * still only grows. Nor can it soft-lock a level: a strand that still needs a
 * color still asks for the jar, however it came to need it.
 *
 * Only an opening level rations its jars, so this takes a level rather than the
 * endless game's `undefined` — the endless board is stocked by the pity spawner
 * and never comes through here.
 */
export const stocksDyes = (
  level: TutorialLevel,
  state: Pick<GameState, 'snake'>,
): readonly Primary[] =>
  level.stock.filter((primary) =>
    state.snake.body.some((segment) => blend(segment.color, primary) !== segment.color),
  );

/**
 * Whether the board should be carrying a sugar cube. The endless game always
 * is (design §8.1), but an opening level puts out only what its remaining
 * orders still need, and does not replace a cube until the last one has come
 * back through the block.
 *
 * A level is a fixed number of candies, so that count is the whole of what it
 * asks for — and a floor that restocks past it offers a segment the level never
 * wanted, which is the same "remove the options" rule the jar stock is authored
 * by. The strand has stopped moving when nothing cut from it is still being
 * drawn in.
 */
export const stocksSugar = (
  level: TutorialLevel | undefined,
  state: Pick<GameState, 'snake' | 'severed' | 'tutorialServes'>,
): boolean =>
  level === undefined || (state.severed.length === 0 && shortfall(level, state) > 0);
