import type Phaser from 'phaser';

import { settings, updateSettings } from '../persist/storage';
import { HudDepth, makeTab, placeTab, type Tab } from '../render/drawn';
import { TextureKey } from '../render/textures';
import { TAB_SIZE, type Frame } from './layout';

/**
 * The mute toggle: a tab beside the cheat sheet's that silences the game
 * (design §12 — all audio behind one toggle, and it is remembered).
 *
 * Built as a tab rather than as a line on the menu because muting is something
 * a player decides *mid-run*, when someone walks into the room, and because the
 * menu has no clickable widget for it to be the first of. Design §10 gives
 * desktop the M key; this is what a thumb has instead, and it is held to the
 * same 44 px floor.
 *
 * It says which state it is in with a struck-through speaker rather than a
 * word: design §11 keeps prose out of the HUD, and a tab that only showed
 * "sound" would leave the player pressing it to find out.
 */

/**
 * Whether the player has silenced the game. In the settings blob beside the
 * cheat sheet's own flag (`persist/storage.ts`), which is what carries it
 * across menu → game → game over → game and across the reload: a player who
 * muted the game in a quiet room must not have it shout at them on the next run.
 */
const readMuted = (): boolean => settings().muted;

const rememberMuted = (muted: boolean): void => {
  updateSettings({ muted });
};

export class MuteTab {
  private readonly scene: Phaser.Scene;
  private readonly tab: Tab;
  /**
   * Whether the game is silenced, kept here rather than read back off
   * `scene.sound.mute` — which looks like the one true copy and is not a
   * readable one. Phaser's getter answers `masterMuteNode.gain.value === 0`
   * while its setter schedules `setValueAtTime(…, 0)`, and a scheduled
   * automation does not move `value` until the context's clock passes it — on a
   * context that is *suspended* until the player's first gesture, sometimes
   * never. Toggling off what it reads back therefore sticks on muted.
   *
   * Found by tapping the tab and then pressing M and getting silence twice.
   */
  private muted = readMuted();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.tab = makeTab(
      scene,
      {
        size: TAB_SIZE,
        key: TextureKey.Speaker,
        depth: HudDepth.MuteTab,
        iconDepth: HudDepth.MuteTabIcon,
      },
      () => {
        this.toggle();
      },
    );

    // Before the first frame rather than on it, for the reason the cheat sheet
    // gives: Phaser objects are born as built, so a muted player would
    // otherwise see one frame of a speaker with sound coming out of it — and,
    // worse, hear one frame of a game they had silenced.
    this.apply();
  }

  applyFrame(frame: Frame): void {
    // The tab does not scale with anything: it is a fixed 44 px whatever the
    // screen does — the same bargain the sheet's tab makes.
    placeTab(this.tab, frame.hud.mute);
  }

  /**
   * Puts the setting into effect. The manager's own flag is what actually
   * silences the game — it gates every sound at the output, so nothing has to
   * be asked whether it is allowed to play and a cue added later cannot forget
   * to ask. It is only not where the answer can be *read* from; see `muted`.
   */
  private apply(): void {
    this.scene.sound.mute = this.muted;
    this.tab.icon.setTexture(this.muted ? TextureKey.SpeakerMuted : TextureKey.Speaker);
  }

  /** The M key, or a tap on the tab — the only two things that move it. */
  toggle(): void {
    this.muted = !this.muted;

    rememberMuted(this.muted);
    this.apply();
  }
}
