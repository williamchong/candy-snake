import { PRIMARIES, blend, primariesOf, type Primary } from './colors';
import type { Rng } from './rng';
import { RAW, type ColorMask, type GameState } from './types';

/**
 * The three opening levels, which every run starts with (design §7). Each is
 * one customer, and the board is stocked with exactly what that order needs and
 * nothing else:
 *
 * 1. raw — one sugar, no jars: pull sugar, chop at the block.
 * 2. a primary — that jar only: cross the sugar *first*, then the jar.
 * 3. a secondary — those two jars: two dyes blend into one color.
 *
 * A restricted board teaches better than any text can, and it restricts *when*
 * as well as *what*: in level 2 the only jar on the floor is the one the order
 * wants, so "wrong dye" is not a mistake the player is able to make, and it is
 * on the floor only while it still has something to do (`stocksDyes`) — not
 * before the first cube is on the strand, and not once the candy has turned.
 * Difficulty here is authored by removing options.
 */
export interface TutorialLevel {
  readonly want: ColorMask;
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
];

const level = (want: ColorMask): TutorialLevel => ({ want, stock: primariesOf(want) });

/**
 * Rolls the three orders from the run's seed, so the tutorial teaches the rule
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

  return [level(RAW), level(first), level(first | second)];
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
 * is (design §8.1), but an opening level puts out exactly one and does not
 * replace it until the maker's hands are empty again.
 *
 * Each of the three levels is one candy, so one cube is the whole of what it
 * asks for — and a floor that restocks the moment the first is pulled offers a
 * second the level never wanted, which is the same "remove the options" rule
 * the jar stock is authored by. The strand is empty when nothing is on it and
 * nothing cut from it is still being drawn in.
 */
export const stocksSugar = (
  level: TutorialLevel | undefined,
  state: Pick<GameState, 'snake' | 'severed'>,
): boolean =>
  level === undefined || (state.snake.body.length === 0 && state.severed.length === 0);
