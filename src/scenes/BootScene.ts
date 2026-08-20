import Phaser from 'phaser';

import { generateCues } from '../audio/kitchen';
import { loadSave } from '../persist/storage';
import { generateGlyphTextures, generateTextures } from '../render/textures';
import { SceneKey } from './keys';

/** Bakes the runtime textures and cues, and reads the save blob, before play. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Boot);
  }

  create(): void {
    // Eagerly, so the first screen that asks for a setting is not the thing
    // that decides when storage is read (architecture §3).
    const { settings } = loadSave();

    generateTextures(this);
    generateGlyphTextures(this);
    // Nothing is loaded here either: a cue is a handful of numbers baked into a
    // buffer, the way a sprite is an ASCII map baked into a texture. Both are
    // ready before the menu draws, and neither costs the player a download.
    generateCues(this);

    // Set at the output rather than asked of each cue, so a player who muted
    // the game hears nothing from the first frame — including from anything
    // added later that forgets to check (design §12).
    this.sound.mute = settings.muted;

    this.scene.start(SceneKey.Menu);
  }
}
