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
 * and the room around it — the width a line has to fit inside, and, for the one
 * screen with a list on it, the height.
 *
 * Both are what the notch and the home indicator have left, to match the centre,
 * which `screenCentre` has always inset. Handing over the raw width beside an
 * inset centre is how a line comes to be allowed room it does not have and run
 * off the side it was shifted away from.
 */
export const onScreenCentre = (
  scene: Phaser.Scene,
  apply: (centre: Vec2, width: number, height: number) => void,
): void =>
  onViewport(scene, () => {
    const view = scene.scale.gameSize;
    const insets = readSafeArea();
    apply(
      screenCentre(view, insets),
      view.width - insets.left - insets.right,
      view.height - insets.top - insets.bottom,
    );
  });
