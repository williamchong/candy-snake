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

/**
 * The keys a browser scrolls the page on, in Phaser's own names.
 *
 * Every one of them is a key this game reads — the arrows steer, and the rest
 * reach the "press any key" screens (`input/anyInput.ts`) — so on every one of
 * them the page must hold still. Named here rather than at the two call sites
 * because a mistyped Phaser key name captures nothing and says nothing, which
 * is the same hazard `HotKey` below is written out for.
 */
export const PAGE_SCROLL_KEYS = 'SPACE,UP,DOWN,LEFT,RIGHT,PAGE_UP,PAGE_DOWN,HOME,END';

export const bindKeyboard = (scene: Phaser.Scene, queue: DirectionQueue): void => {
  const keyboard = scene.input.keyboard;
  if (!keyboard) return;

  // Steering must not also drive the page. An arrow key scrolls the document by
  // default, and **Phaser prevents that for no key unless it is asked**: its
  // `input.keyboard.capture` config defaults to an empty list, and
  // `KeyboardManager` only calls `preventDefault` on codes in it. Binding a
  // listener does not capture anything, so the game read the key *and* the
  // browser scrolled on it.
  //
  // Whether that is visible depends on there being somewhere to scroll, which
  // is why it survived this long: the page is normally exactly the viewport's
  // height. It only takes a few stray pixels — an inline canvas leaving
  // descender space under itself was four of them (`index.html`) — and the
  // whole game slides mid-run. That cause is fixed where it lives, and this is
  // the rule rather than the symptom: steering keys are the game's, and a
  // future layout that finds a pixel of overflow must not be able to reopen it.
  //
  // Taken from the table above so the two cannot drift — a key that steers is a
  // key that must not scroll, and a fifth direction added below would otherwise
  // be captured nowhere. WASD is in the list for that reason rather than
  // because it scrolls: it does not, and asking for it costs nothing.
  //
  // **Captures are global**, in Phaser's own words: `addCapture` goes straight
  // to the one `KeyboardManager` the game has, and no scene owns its own list.
  // So the arrows here are already captured by the menu screen's own call
  // (`PAGE_SCROLL_KEYS`, via `input/anyInput.ts`), which by construction has run
  // — `MenuScene` is the only way into `GameScene`. This is kept anyway, and
  // deliberately: it is the call tied to `KEY_DIRS` rather than to a hand-kept
  // list, so it is what makes steering safe if a second way in is ever added.
  // The overlap costs one deduped array scan of eight short strings, once.
  //
  // The consequence to know before testing this: because the list is global and
  // the menu's call is first, removing *this* line alone changes nothing
  // observable. Either call covers the arrows on its own.
  keyboard.addCapture(Object.keys(KEY_DIRS).join(','));

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
  /** Phaser's own name for Escape is `ESC`, and the comment above is why. */
  Pause: 'P',
  Escape: 'ESC',
} as const;

export type HotKey = (typeof HotKey)[keyof typeof HotKey];

/**
 * Binds one of them, or several to the one action — design §10 gives pause both
 * P and Escape, and a player who reaches for either means the same thing.
 *
 * Separate from `bindKeyboard` because a hotkey is bound by whichever scene owns
 * the thing it toggles, and that is not always the scene that owns the queue:
 * every running scene has its own keyboard plugin and all of them see the key,
 * so the HUD can take its own without asking GameScene for anything. Pause is
 * the case that turns this from a convenience into a requirement — a paused
 * scene's keyboard plugin is inactive, so a key bound by GameScene could stop
 * the game and never start it again.
 */
export const bindHotkey = (
  scene: Phaser.Scene,
  keys: HotKey | readonly HotKey[],
  run: () => void,
): void => {
  for (const key of typeof keys === 'string' ? [keys] : keys) {
    scene.input.keyboard?.on(`keydown-${key}`, run);
  }
};
