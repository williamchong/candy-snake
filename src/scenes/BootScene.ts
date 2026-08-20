import Phaser from 'phaser';

import { loadSave } from '../persist/storage';
import { generateGlyphTextures, generateTextures } from '../render/textures';
import { SceneKey } from './keys';

/** Bakes the runtime textures and reads the save blob before play starts. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Boot);
  }

  create(): void {
    // Eagerly, so the first screen that asks for a setting is not the thing
    // that decides when storage is read (architecture §3).
    loadSave();

    generateTextures(this);
    generateGlyphTextures(this);
    this.scene.start(SceneKey.Menu);
  }
}
