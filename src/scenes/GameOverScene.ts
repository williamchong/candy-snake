import Phaser from 'phaser';

import { onceAnyInput } from '../input/anyInput';
import { CENTRE_X } from '../ui/layout';
import { textStyle } from '../ui/text';
import { SceneKey } from './keys';

/** What the run was worth, handed over by GameScene (architecture §6). */
export interface RunSummary {
  readonly score: number;
  readonly served: number;
  readonly elapsedMs: number;
}

const asClock = (elapsedMs: number): string => {
  const seconds = Math.floor(elapsedMs / 1_000);
  return `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')}`;
};

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.GameOver);
  }

  create(summary: RunSummary): void {
    this.add.text(CENTRE_X, 190, 'Shop closed', textStyle(48)).setOrigin(0.5);
    this.add.text(CENTRE_X, 280, `${summary.score}`, textStyle(64)).setOrigin(0.5);
    this.add
      .text(
        CENTRE_X,
        350,
        `${summary.served} candies served · ${asClock(summary.elapsedMs)} on the floor`,
        textStyle(20),
      )
      .setOrigin(0.5);
    this.add.text(CENTRE_X, 440, 'Press any key', textStyle(22)).setOrigin(0.5);

    onceAnyInput(this, () => this.scene.start(SceneKey.Menu));
  }
}
