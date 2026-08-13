import { cellKey, eq, freeCells, stepCell } from './board';
import type { Rng } from './rng';
import type { GameState, Pickup, Vec2 } from './types';

/**
 * Cells a pickup may not spawn on (design §8.4): the snake itself, existing
 * pickups, and the cell directly in front of the head — no free accidental
 * pickups.
 */
const blockedCells = (state: GameState): Set<number> => {
  const blocked = new Set<number>([cellKey(state.snake.head)]);
  for (const segment of state.snake.body) blocked.add(cellKey(segment.pos));
  for (const pickup of state.pickups) blocked.add(cellKey(pickup.pos));
  blocked.add(cellKey(stepCell(state.snake.head, state.snake.dir)));
  return blocked;
};

/** Undefined only when the board leaves nowhere legal to spawn. */
export const spawnSugar = (state: GameState, rng: Rng): Pickup | undefined => {
  const candidates = freeCells(blockedCells(state));
  const pos = candidates[rng.int(candidates.length)];
  return pos ? { kind: 'sugar', pos } : undefined;
};

/** Design §8.1: at least one sugar is on the map at all times. */
export const ensureSugar = (state: GameState, rng: Rng): Pickup | undefined =>
  state.pickups.some((pickup) => pickup.kind === 'sugar')
    ? undefined
    : spawnSugar(state, rng);

export const pickupIndexAt = (state: GameState, pos: Vec2): number =>
  state.pickups.findIndex((pickup) => eq(pickup.pos, pos));
