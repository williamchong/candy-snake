/** Scene keys live here so a typo is a compile error, not a silent hang. */
export const SceneKey = {
  Boot: 'Boot',
  Game: 'Game',
  /** Runs in parallel above Game, never on its own (architecture §6). */
  UI: 'UI',
} as const;
