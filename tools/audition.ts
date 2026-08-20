/**
 * Writes every cue and the ambient bed to a `.wav` you can double-click.
 *
 *     npx vite-node tools/audition.ts
 *
 * The audio layer's answer to `.claude/skills/run-candy-snake/driver.mjs`: that
 * harness exists because the tests cannot see, and this one because they cannot
 * hear. What is checkable under Node is checked in `tones.test.ts` — no cue
 * clips, none begins or ends part-way up a waveform, the band goes the way it
 * is written — but whether a cue *sounds like breaking candy* is not a property,
 * it is a judgement, and it needs an ear and twelve files rather than a run of
 * the game and the patience to provoke a self-hit.
 *
 * Runs under `vite-node`, which Vitest already puts in `node_modules/.bin`, so
 * this costs no dependency. It sits outside `tsconfig.json`'s `include` on
 * purpose: `node:fs` would otherwise pull `@types/node` into a project that has
 * no other use for it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { AMBIENCE_KEY, AMBIENCE_RATE, ambience, CUES, samples } from '../src/audio/tones';

/** What the browser will most likely run at, so what is written is what is heard. */
const RATE = 44100;

const OUT = 'audition';

/**
 * Mono 16-bit PCM. The cues live as floats in −1..1, which is the format Web
 * Audio takes them in; this is the one place they are ever quantised, and only
 * because a player is a player.
 */
const wav = (data: Float32Array, rate: number): Uint8Array => {
  const bytes = new Uint8Array(44 + data.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + data.length * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); // header length
  view.setUint16(20, 1, true); // PCM, uncompressed
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes a second
  view.setUint16(32, 2, true); // bytes a frame
  view.setUint16(34, 16, true); // bits a sample
  ascii(36, 'data');
  view.setUint32(40, data.length * 2, true);

  for (let i = 0; i < data.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, data[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(sample * 0x7fff), true);
  }

  return bytes;
};

const write = (name: string, data: Float32Array, rate: number): void => {
  writeFileSync(`${OUT}/${name}.wav`, wav(data, rate));
  console.log(
    `${OUT}/${name}.wav`.padEnd(32),
    `${((data.length / rate) * 1000).toFixed(0)} ms`,
  );
};

mkdirSync(OUT, { recursive: true });
for (const [key, spec] of Object.entries(CUES)) write(key, samples(spec, RATE), RATE);
write(AMBIENCE_KEY, ambience(), AMBIENCE_RATE);
