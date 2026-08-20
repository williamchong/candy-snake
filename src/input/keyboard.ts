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

/**
 * The keys that do something other than steer (design §10). Named here beside
 * the steering table because a mistyped Phaser key name binds a listener that
 * simply never fires — no type error, no lint error, and nothing on screen to
 * say so.
 */
export const HotKey = {
  CheatSheet: 'C',
  Mute: 'M',
} as const;

export type HotKey = (typeof HotKey)[keyof typeof HotKey];

/**
 * Binds one of them. Separate from `bindKeyboard` because a hotkey is bound by
 * whichever scene owns the thing it toggles, and that is not always the scene
 * that owns the queue: every running scene has its own keyboard plugin and all
 * of them see the key, so the HUD can take its own without asking GameScene
 * for anything.
 */
export const bindHotkey = (scene: Phaser.Scene, key: HotKey, run: () => void): void => {
  scene.input.keyboard?.on(`keydown-${key}`, run);
};
