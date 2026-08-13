import type Phaser from 'phaser';

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

  scene.input.keyboard?.once('keydown', trigger);
  scene.input.once('pointerdown', trigger);
};
