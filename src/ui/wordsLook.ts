// The words for the two looks, in the same voice as words.ts. 'ink' is called Drawn on screen and
// 'real' is called Built.

export const LOOK = {
  drawn: 'Drawn',
  built: 'Built',
  /** The switch's name for a screen reader. Pressed means the built version is on. */
  name: 'See it built',
  /** What pressing does now, as the tooltip and the spoken description. */
  toBuilt: 'Showing the drawing. Press to see it built.',
  toDrawn: 'Showing it built. Press to go back to the drawing.',
  toStop: 'Loading the built version. Press again to stop.',
  toRetry: 'The built version could not load. Press to try again.',
  loading: 'Loading the built version',
  sayLoading: 'Loading the built version.',
  sayBuilt: 'Now showing it built.',
  sayDrawn: 'Back to the drawing.',
  sayStopped: 'Stopped. Still the drawing.',
  failed: 'The built version could not load. The drawing is still here.',
  setting: 'Look',
  settingNote: 'Built is the same place made for real, in late afternoon light. It loads the first time you choose it. Your choice is kept for next time.',
  keyRow: 'Drawn or built',
  touchHow: 'Drawn and Built button',
  titleKeys: 'You can see it drawn or built. Press ',
  titleKeysEnd: ' to switch.',
  titleTouch: 'You can see it drawn or built. The switch is at the top once you walk in.',
  titleBuiltKeys: 'You are seeing it built. Press ',
  titleBuiltKeysEnd: ' for the drawing.',
  titleBuiltTouch: 'You are seeing it built. The switch is at the top once you walk in.',
} as const;
