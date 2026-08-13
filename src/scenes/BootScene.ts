import Phaser from 'phaser';

import { SceneKey } from './keys';

/**
 * Generates runtime textures and loads settings before the game starts.
 * Nothing to do yet in the scaffold phase — goes straight to GameScene.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Boot);
  }

  create(): void {
    this.scene.start(SceneKey.Game);
  }
}
