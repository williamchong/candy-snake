import type Phaser from 'phaser';

import type { GameEvent } from '../core/types';
import {
  AMBIENCE_KEY,
  AMBIENCE_RATE,
  ambience,
  CUES,
  cueFor,
  repeat,
  samples,
  type CueKey,
} from './tones';

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

  const bake = (key: string, data: Float32Array, rate: number): void => {
    const buffer = context.createBuffer(1, data.length, rate);

    buffer.getChannelData(0).set(data);
    scene.cache.audio.add(key, buffer);
  };

  for (const [key, spec] of Object.entries(CUES)) {
    bake(key, samples(spec, context.sampleRate), context.sampleRate);
  }

  // The bed keeps its own, lower rate; Web Audio resamples it on playback.
  bake(AMBIENCE_KEY, ambience(), AMBIENCE_RATE);
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
  /** The room tone, while a run is going on. */
  private bed: Phaser.Sound.BaseSound | undefined;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.silent = [...Object.keys(CUES), AMBIENCE_KEY].some(
      (key) => !scene.cache.audio.exists(key),
    );

    // The bed is the one part of a paused run that does not stop by itself:
    // `scene.sound` is the game-global manager, not a scene-scoped one, so the
    // loop plays on over a stopped shop. Heard here rather than from the HUD
    // that owns the switch — a scene's emitter still fires while it is paused,
    // so the kitchen can listen to its own scene and nothing has to reach
    // across. Everything else is already safe: `play` is only ever called from
    // that scene's update, so no cue can start while it is paused.
    const hush = (): void => {
      this.hush();
    };
    const resume = (): void => {
      this.resume();
    };

    scene.events.on('pause', hush);
    scene.events.on('resume', resume);

    // A fresh Kitchen is built for every run, so the last one's bed has to be
    // taken down with the scene that owned it — otherwise a restart leaves two
    // playing, a little louder each time. `shutdown` covers every way out of a
    // run, the game-over branch included, which is why it is here rather than
    // hung off that one event.
    //
    // The two above have to come off with it, and that is not Phaser doing it
    // for us: `Systems.shutdown` clears only its own transition events, and
    // `removeAllListeners` is in `destroy`, which a restarted scene never
    // reaches. Left on, each run would add another pair to the same emitter —
    // the hazard `ui/responsive.ts` names for the scale manager, one object
    // further in.
    scene.events.once('shutdown', () => {
      scene.events.off('pause', hush);
      scene.events.off('resume', resume);
      this.close();
    });
  }

  /**
   * Opens the shop. Separate from the constructor because the bed is a thing
   * the run turns on, not a thing the object needs to exist.
   */
  open(): void {
    if (this.silent || this.bed !== undefined) return;

    this.bed = this.scene.sound.add(AMBIENCE_KEY, { loop: true });
    this.bed.play();
  }

  private close(): void {
    this.bed?.destroy();
    this.bed = undefined;
  }

  /**
   * Holds the room tone, and lets it back in.
   *
   * The bed's own transport, deliberately, rather than `scene.sound.mute` —
   * which `ui/muteTab.ts` owns and reads back from a local mirror, so a second
   * writer on that boolean means a pause comes back unmuting a player who had
   * asked for silence. Held rather than closed, because a bed destroyed and
   * reopened restarts the loop at its head, which is a seam at exactly the
   * moment the player is listening for the game coming back.
   *
   * A cue already in the air is left to finish: a few hundred milliseconds, and
   * cutting one mid-shape is more audible than letting it end.
   */
  private hush(): void {
    this.bed?.pause();
  }

  private resume(): void {
    this.bed?.resume();
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
