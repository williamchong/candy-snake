import type Phaser from 'phaser';

import { Dir } from '../core/types';
import type { DirectionQueue } from './directionQueue';

/** Arrow keys and WASD both steer (design §10). */
const KEY_DIRS: Record<string, Dir> = {
  UP: Dir.Up,
  DOWN: Dir.Down,
  LEFT: Dir.Left,
  RIGHT: Dir.Right,
  W: Dir.Up,
  S: Dir.Down,
  A: Dir.Left,
  D: Dir.Right,
};

export const bindKeyboard = (scene: Phaser.Scene, queue: DirectionQueue): void => {
  const keyboard = scene.input.keyboard;
  if (!keyboard) return;

  for (const [key, dir] of Object.entries(KEY_DIRS)) {
    keyboard.on(`keydown-${key}`, () => queue.push(dir));
  }
};
