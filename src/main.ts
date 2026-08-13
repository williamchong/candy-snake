import Phaser from 'phaser';

import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';

// Fixed FIT scaling at 960×640 is the MVP shortcut (architecture §9);
// Scale.RESIZE + layout() replaces it in the mobile phase.
const GAME_WIDTH = 960;
const GAME_HEIGHT = 640;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#0d0a1a',
  // 8-bit art direction: nearest-neighbour filtering keeps the 8×8 source
  // sprites hard-edged when scaled up (see render/textures.ts).
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, GameScene],
});
