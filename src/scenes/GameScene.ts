import Phaser from 'phaser';

import { SceneKey } from './keys';

/** Scaffold placeholder: proves the canvas, scaling, and scene flow work. */
export class GameScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Game);
  }

  create(): void {
    const { width, height } = this.scale;

    this.add.rectangle(width / 2, height / 2, 320, 200, 0xe8556d);
    this.add
      .text(width / 2, height / 2, 'Candy Snake 🍬\nscaffold OK', {
        fontFamily: 'sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        align: 'center',
      })
      .setOrigin(0.5);
  }
}
