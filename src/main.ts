import Phaser from 'phaser';

import { BootScene } from './scenes/BootScene';
import { GameOverScene } from './scenes/GameOverScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';
import { UIScene } from './scenes/UIScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#d8cbe4',
  // Nearest-neighbour filtering keeps the 16×16 source sprites hard-edged when
  // scaled up (see render/textures.ts). Phaser also forces roundPixels on with
  // it, which is what quantises the interpolated positions to whole pixels as
  // sprites slide between cells.
  pixelArt: true,
  // The canvas is the viewport, not a fixed frame scaled into it: every scene
  // lays itself out from the real size through `ui/layout.ts` (architecture §9).
  // Nothing is centred here — there is nothing left over to centre.
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  // Only the first is started automatically; GameScene launches the HUD.
  scene: [BootScene, MenuScene, GameScene, UIScene, GameOverScene],
});
