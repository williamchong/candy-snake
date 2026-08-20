import type Phaser from 'phaser';

import type { GameEvent } from '../core/types';
import { CUES, cueFor, repeat, samples, type CueKey } from './tones';

/**
 * The Phaser half of the audio layer: bakes the cues `audio/tones.ts` describes
 * into buffers at boot, and plays them off the event stream.
 *
 * Deliberately thin. Every decision — which event sounds, at what pitch, how a
 * repeat is spaced — is made next door in the pure module, so that the part
 * worth testing runs under Node and the part that cannot is small enough to
 * read in one sitting (architecture §11).
 */

/**
 * The sound manager, if it is the Web Audio one. Phaser falls back to an
 * `<audio>`-tag manager, and to no manager at all, on browsers that need it —
 * and neither of those can be handed a buffer we built ourselves.
 *
 * A game with no sound is not a broken game, so this returns nothing and the
 * kitchen stays quiet. That is the rule `persist/storage.ts` already follows
 * for a browser with storage switched off (architecture §10).
 */
const webAudio = (
  sound: Phaser.Scene['sound'],
): Phaser.Sound.WebAudioSoundManager | undefined =>
  'context' in sound ? sound : undefined;

/**
 * Bakes every cue, once, at boot — the audio half of `generateTextures`.
 *
 * `createBuffer` works on a suspended context, which matters: the context is
 * suspended until the player's first gesture (design §12, and Phaser's own
 * `WebAudioSoundManager.unlock` handles the resume), so anything that had to
 * *decode* here would have to wait for a tap. Samples we generate ourselves do
 * not, so the cues are ready before the menu is drawn.
 */
export const generateCues = (scene: Phaser.Scene): void => {
  const sound = webAudio(scene.sound);
  if (sound === undefined) return;

  const { context } = sound;

  for (const [key, spec] of Object.entries(CUES)) {
    const data = samples(spec, context.sampleRate);
    const buffer = context.createBuffer(1, data.length, context.sampleRate);

    buffer.getChannelData(0).set(data);
    scene.cache.audio.add(key, buffer);
  }
};

export class Kitchen {
  private readonly scene: Phaser.Scene;
  /**
   * When each copy of a cue currently in the air will have finished, so the
   * next one knows how many it is landing on top of. Timestamps rather than
   * timers: a timer per cue would be a scene-owned object to cancel on every
   * teardown, and this answers the same question by arithmetic.
   */
  private readonly sounding = new Map<CueKey, number[]>();
  /** Nothing was baked — see `webAudio` above. Checked once, not per event. */
  private readonly silent: boolean;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.silent = Object.keys(CUES).some((key) => !scene.cache.audio.exists(key));
  }

  /**
   * Sounds one event, if it has a sound. Fed from the same loop that drives the
   * effects, so audio and picture are triggered by the event and never by
   * polled state (architecture §7).
   */
  play(event: GameEvent): void {
    if (this.silent) return;

    const cue = cueFor(event);
    if (cue === undefined) return;

    const now = this.scene.time.now;
    let live = this.sounding.get(cue.key);
    if (live === undefined) {
      live = [];
      this.sounding.set(cue.key, live);
    }

    // Compacted in place rather than filtered into a new array: the busiest cue
    // in the game asks this on nearly every move, and the answer is at most six
    // numbers long. Done before the cap is consulted, so a cue that is full does
    // not leave its dead entries to be walked again by the next event.
    let alive = 0;
    for (const ends of live) {
      if (ends > now) {
        live[alive] = ends;
        alive += 1;
      }
    }
    live.length = alive;

    const again = repeat(cue.key, live.length);
    if (again === undefined) return;

    const rate = cue.rate * again.rate;
    // A cue's length is fixed in samples, so playing it faster makes it end
    // sooner — which is what decides when this slot frees up.
    live.push(now + again.delayMs + CUES[cue.key].durationMs / rate);

    this.scene.sound.play(cue.key, { delay: again.delayMs / 1000, rate });
  }
}
