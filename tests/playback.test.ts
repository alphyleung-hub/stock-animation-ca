import { describe, expect, it } from 'vitest';
import { PLAYBACK_RATES, anchorClock, frameAt, parsePlaybackRate } from '../src/playback';

const FRAMES = 1800;

describe('playback rate', () => {
  it('accepts only 0.5×, 1×, 1.5×, and 2×', () => {
    expect(PLAYBACK_RATES).toEqual([0.5, 1, 1.5, 2]);
    expect(parsePlaybackRate(null)).toBe(1);
    expect(parsePlaybackRate('')).toBe(1);
    expect(parsePlaybackRate('nope')).toBe(1);
    expect(parsePlaybackRate('3')).toBe(1);
    expect(parsePlaybackRate('0.25')).toBe(1);
    expect(parsePlaybackRate('0.5')).toBe(0.5);
    expect(parsePlaybackRate('1')).toBe(1);
    expect(parsePlaybackRate('1.5')).toBe(1.5);
    expect(parsePlaybackRate('2')).toBe(2);
  });

  it('advances at 60fps times the rate and clamps at the last frame', () => {
    const start = 1_000;
    expect(frameAt(start, start, 1, FRAMES)).toBe(0);
    expect(frameAt(start + 1000, start, 0.5, FRAMES)).toBe(30);
    expect(frameAt(start + 1000, start, 1, FRAMES)).toBe(60);
    expect(frameAt(start + 1000, start, 1.5, FRAMES)).toBe(90);
    expect(frameAt(start + 1000, start, 2, FRAMES)).toBe(120);
    expect(frameAt(start + 20_000, start, 2, FRAMES)).toBe(FRAMES - 1);
    expect(frameAt(start - 50, start, 1, FRAMES)).toBe(0);
  });

  it('keeps the current frame when the rate changes', () => {
    const start = 5_000;
    const now = start + 2500;
    const frame = frameAt(now, start, 1, FRAMES);
    expect(frame).toBe(150);
    for (const rate of PLAYBACK_RATES) {
      const anchored = anchorClock(now, frame, rate);
      expect(frameAt(now, anchored, rate, FRAMES)).toBe(frame);
      expect(frameAt(now + 4, anchored, rate, FRAMES)).toBe(frame);
      const later = frameAt(now + 1000, anchored, rate, FRAMES);
      expect(later).toBe(frame + 60 * rate);
    }
  });
});
