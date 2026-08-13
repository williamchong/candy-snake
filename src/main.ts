import Phaser from 'phaser';

import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';

// Fixed FIT scaling at 960×640 is the MVP shortcut (architecture §9);
// Scale.RESIZE + layout() replaces it in the mobile phase.
const GAME_WIDTH = 960;
const GAME_HEIGHT = 640;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#d8cbe4',
  // Nearest-neighbour filtering keeps the 16×16 source sprites hard-edged when
  // scaled up (see render/textures.ts). Phaser also forces roundPixels on with
  // it, which is what quantises the interpolated positions to whole pixels as
  // sprites slide between cells.
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // Only the first is started automatically; GameScene launches the HUD.
  scene: [BootScene, GameScene, UIScene],
});
