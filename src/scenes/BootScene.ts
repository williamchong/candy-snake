import Phaser from 'phaser';

/**
 * Generates runtime textures and loads settings before the game starts.
 * Nothing to do yet in the scaffold phase — goes straight to GameScene.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.scene.start('Game');
  }
}
