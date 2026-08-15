import type Phaser from 'phaser';

import type { Vec2 } from '../core/types';
import { layout, screenCentre, type Frame } from './layout';
import { readSafeArea } from './safeArea';

/**
 * Subscribing a scene to the shape of the screen. Every scene wants the same
 * three things — lay out now, lay out again on every resize, and stop listening
 * when the scene shuts down — and the third is the one that is quietly wrong if
 * each scene writes it out itself: `ScaleManager` outlives every scene, so a
 * listener left on it fires into a dead one.
 */

const onViewport = (scene: Phaser.Scene, run: () => void): void => {
  run();
  scene.scale.on('resize', run);
  scene.events.once('shutdown', () => scene.scale.off('resize', run));
};

/** For scenes that draw the kitchen or the HUD around it. */
export const onFrame = (scene: Phaser.Scene, apply: (frame: Frame) => void): void =>
  onViewport(scene, () => apply(layout(scene.scale.gameSize, readSafeArea())));

/**
 * For the full-screen message screens: the middle of the frame to centre on,
 * and the width they have to fit inside.
 */
export const onScreenCentre = (
  scene: Phaser.Scene,
  apply: (centre: Vec2, width: number) => void,
): void =>
  onViewport(scene, () => {
    const view = scene.scale.gameSize;
    apply(screenCentre(view, readSafeArea()), view.width);
  });
