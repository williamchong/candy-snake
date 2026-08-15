import Phaser from 'phaser';

import { onceAnyInput } from '../input/anyInput';
import { onScreenCentre } from '../ui/responsive';
import { TextStack, type StackRow } from '../ui/text';
import { SceneKey } from './keys';

/** What the run was worth, handed over by GameScene (architecture §6). */
export interface RunSummary {
  readonly score: number;
  readonly served: number;
  readonly elapsedMs: number;
}

const asClock = (elapsedMs: number): string => {
  const seconds = Math.floor(elapsedMs / 1_000);
  return `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')}`;
};

/** Centred off the middle of the visible frame — see `MenuScene` for the why. */
const lines = (summary: RunSummary): readonly StackRow[] => [
  { text: 'Shop closed', size: 48, dy: -130 },
  { text: `${summary.score}`, size: 64, dy: -40 },
  {
    text: `${summary.served} candies served · ${asClock(summary.elapsedMs)} on the floor`,
    size: 20,
    dy: 30,
  },
  { text: 'Press any key', size: 22, dy: 120 },
];

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.GameOver);
  }

  create(summary: RunSummary): void {
    const stack = new TextStack(this, lines(summary));
    onScreenCentre(this, (centre, width) => stack.centreOn(centre, width));

    onceAnyInput(this, () => this.scene.start(SceneKey.Menu));
  }
}
