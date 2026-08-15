import Phaser from 'phaser';

import { onceAnyInput } from '../input/anyInput';
import { onScreenCentre } from '../ui/responsive';
import { TextStack, type StackRow } from '../ui/text';
import { SceneKey } from './keys';

/**
 * The front of the shop. Deliberately bare: the run itself opens with three
 * teaching levels (design §7), so this screen has no tutorial work to do — and
 * the high-score table that will earn it its keep lands in Phase 8.
 *
 * The stack is placed off the middle of the visible frame rather than off fixed
 * coordinates, so it reads the same on a phone as it does in a window. Starting
 * the run is a tap anywhere (`onceAnyInput`), which is as large as a touch
 * target can be.
 */
const LINES: readonly StackRow[] = [
  { text: 'Candy Snake', size: 56, dy: -100 },
  { text: 'Pull sugar · knead dye · chop candy', size: 20, dy: -30 },
  { text: 'Press any key to open up', size: 22, dy: 80 },
];

export class MenuScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Menu);
  }

  create(): void {
    const stack = new TextStack(this, LINES);
    onScreenCentre(this, (centre, width) => stack.centreOn(centre, width));

    onceAnyInput(this, () => this.scene.start(SceneKey.Game));
  }
}
