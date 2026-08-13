import { cellKey, eq, freeCells, stepCell } from './board';
import { PRIMARIES, type Primary } from './colors';
import type { Rng } from './rng';
import type { GameState, Pickup, Vec2 } from './types';

/**
 * Cells a pickup may not spawn on (design §8.4): the snake itself, existing
 * pickups, still-crumbling debris, and the cell directly in front of the head
 * — no free accidental pickups. Kind-agnostic, so a dye jar can no more land
 * on sugar than on the strand.
 */
const blockedCells = (state: GameState): Set<number> => {
  const blocked = new Set<number>([cellKey(state.snake.head)]);
  for (const segment of state.snake.body) blocked.add(cellKey(segment.pos));
  for (const pickup of state.pickups) blocked.add(cellKey(pickup.pos));
  for (const pile of state.debris) {
    for (const segment of pile.segments) blocked.add(cellKey(segment.pos));
  }
  blocked.add(cellKey(stepCell(state.snake.head, state.snake.dir)));
  return blocked;
};

/**
 * The only two places a `Pickup` is built. Both start closed, so a field added
 * to the type has one place to be initialised rather than four.
 */
export const createSugar = (pos: Vec2): Pickup => ({ kind: 'sugar', pos, open: false });

export const createDye = (pos: Vec2, primary: Primary): Pickup => ({
  kind: 'dye',
  pos,
  primary,
  open: false,
  kneaded: 0,
});

type PickupMaker = (pos: Vec2) => Pickup;

/**
 * What the board is short of, in a fixed order — sugar, then red, yellow,
 * blue — so that a seed always draws its cells in the same sequence.
 *
 * A pickup the strand is still passing through is very much on the map, so it
 * counts here too: nothing respawns until the whole snake has cleared it.
 *
 * Design §8.1 keeps at least one sugar on the map, and §8.2 caps dye at one
 * jar per primary. Phase 2 treats that cap as a floor too: one jar of each is
 * always present, which is enough to make every color reachable. Phase 5
 * replaces this with the pity spawner, which spawns against what the current
 * orders actually need.
 */
const missingPickups = (state: GameState): PickupMaker[] => {
  const makers: PickupMaker[] = [];

  if (!state.pickups.some((pickup) => pickup.kind === 'sugar')) {
    makers.push(createSugar);
  }

  for (const primary of PRIMARIES) {
    const onMap = state.pickups.some(
      (pickup) => pickup.kind === 'dye' && pickup.primary === primary,
    );
    if (!onMap) makers.push((pos) => createDye(pos, primary));
  }

  return makers;
};

/**
 * Refills whatever the board is missing. Returns the new pickups rather than
 * mutating, leaving `Game` the only writer of state.
 *
 * The blocked set is built once and each chosen cell is added back into it, so
 * two pickups spawned in the same tick cannot land on top of each other — a
 * stale free-list is a correctness bug here, not just wasted work.
 */
export const ensurePickups = (state: GameState, rng: Rng): Pickup[] => {
  const makers = missingPickups(state);
  if (makers.length === 0) return [];

  const blocked = blockedCells(state);
  const spawned: Pickup[] = [];

  for (const make of makers) {
    const candidates = freeCells(blocked);
    const pos = candidates[rng.int(candidates.length)];
    if (pos === undefined) break; // Nowhere legal left on the board.

    blocked.add(cellKey(pos));
    spawned.push(make(pos));
  }

  return spawned;
};

export const pickupIndexAt = (state: GameState, pos: Vec2): number =>
  state.pickups.findIndex((pickup) => eq(pickup.pos, pos));
