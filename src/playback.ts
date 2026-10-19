/** On-screen rates. Export stays on the 1× timeline and does not read this. */
export const PLAYBACK_RATES = [0.5, 1, 1.5, 2] as const;

export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

const RATE_SET = new Set<number>(PLAYBACK_RATES);

export function isPlaybackRate(value: number): value is PlaybackRate {
  return RATE_SET.has(value);
}

/** Stored session value, or 1× when missing or unrecognized. */
export function parsePlaybackRate(raw: string | null | undefined): PlaybackRate {
  if (raw == null || raw === '') return 1;
  const value = Number(raw);
  return isPlaybackRate(value) ? value : 1;
}

/**
 * Frame at `now`. Matches `floor((now - clockStart) / 1000 * 60 * rate)`,
 * clamped to the film.
 */
export function frameAt(now: number, clockStart: number, rate: number, frameCount: number): number {
  const frame = Math.floor(((now - clockStart) / 1000) * 60 * rate);
  if (frame <= 0) return 0;
  return Math.min(frameCount - 1, frame);
}

/**
 * `clockStart` that keeps `frame` on screen at `now` for `rate`.
 * Biased 0.05ms into the frame so float error cannot floor back to `frame - 1`.
 */
export function anchorClock(now: number, frame: number, rate: number): number {
  return now - (frame / (60 * rate)) * 1000 - 0.05;
}
