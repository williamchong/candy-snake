import Phaser from 'phaser';

import { onceAnyInput } from '../input/anyInput';
import { textStyle } from '../ui/text';
import { SceneKey } from './keys';

/**
 * The front of the shop. Deliberately bare: the run itself opens with three
 * teaching levels (design §7), so this screen has no tutorial work to do — and
 * the high-score table that will earn it its keep lands in Phase 8.
 */
const CENTRE_X = 480;

export class MenuScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Menu);
  }

  create(): void {
    this.add.text(CENTRE_X, 220, 'Candy Snake', textStyle(56)).setOrigin(0.5);
    this.add
      .text(CENTRE_X, 290, 'Pull sugar · knead dye · chop candy', textStyle(20))
      .setOrigin(0.5);
    this.add
      .text(CENTRE_X, 400, 'Press any key to open up', textStyle(22))
      .setOrigin(0.5);

    onceAnyInput(this, () => this.scene.start(SceneKey.Game));
  }
}
