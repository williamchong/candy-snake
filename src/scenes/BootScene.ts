import Phaser from 'phaser';

import { generateGlyphTextures, generateTextures } from '../render/textures';
import { SceneKey } from './keys';

/** Bakes the runtime textures before play starts. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Boot);
  }

  create(): void {
    generateTextures(this);
    generateGlyphTextures(this);
    this.scene.start(SceneKey.Menu);
  }
}
