import type Phaser from 'phaser';

import { PAGE_SCROLL_KEYS } from './keyboard';

/**
 * The arcade "press any key", which on a phone is also "tap anywhere". Guarded
 * so a tap that also registers as a key press cannot fire twice — both handlers
 * usually start a scene, and starting one twice restarts it mid-boot.
 */
export const onceAnyInput = (scene: Phaser.Scene, run: () => void): void => {
  let fired = false;
  const trigger = (): void => {
    if (fired) return;
    fired = true;
    run();
  };

  // Capture what you bind (`bindKeyboard` does the same for the steering keys).
  // This one binds *any* key, and several of the keys a player is most likely
  // to reach for here scroll the page — space above all, which is the one this
  // screen is really asking for. Phaser prevents that for no key unless asked,
  // so without this the press that starts the run also slides it.
  scene.input.keyboard?.addCapture(PAGE_SCROLL_KEYS);
  scene.input.keyboard?.once('keydown', trigger);
  scene.input.once('pointerdown', trigger);
};
