import { readFileSync } from 'node:fs';
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

describe('play control', () => {
  it('leads the playback group under the film, after the range and before replay and speed', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    const dock = html.slice(html.indexOf('class="dock"'), html.indexOf('id="status"'));
    expect(header).toContain('data-lookback');
    expect(header).not.toContain('id="play"');
    expect(header).not.toContain('data-speed');
    expect(header).not.toContain('id="download"');
    const lookbackAt = html.indexOf('data-lookback');
    const canvasAt = html.indexOf('id="stage"');
    const playAt = dock.indexOf('id="play"');
    const replayAt = dock.indexOf('id="replay"');
    const speedAt = dock.indexOf('data-speed');
    const downloadAt = dock.indexOf('id="download"');
    expect(lookbackAt).toBeGreaterThan(0);
    expect(canvasAt).toBeGreaterThan(lookbackAt);
    expect(playAt).toBeGreaterThan(0);
    expect(replayAt).toBeGreaterThan(playAt);
    expect(speedAt).toBeGreaterThan(replayAt);
    expect(downloadAt).toBeGreaterThan(speedAt);
    expect(dock).toContain('aria-label="Playback"');
    expect(dock).not.toContain('type="submit"');
    const play = dock.slice(playAt, dock.indexOf('</button>', playAt));
    expect(play).toContain('class="play-label">Play<');
    expect(play).toContain('class="icon-pause"');
  });

  it('pauses on the current frame and resumes without loading again', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const pause = main.slice(main.indexOf('function pausePlayback'), main.indexOf('function resumePlayback'));
    const resume = main.slice(main.indexOf('function resumePlayback'), main.indexOf('function syncTransport'));
    expect(pause).toContain('playing = false');
    expect(pause).not.toContain('loadTicker');
    expect(pause).not.toContain('generation');
    expect(resume).toContain('anchorClock(performance.now(), shownFrame, playbackRate)');
    expect(resume).not.toContain('loadTicker');
    expect(main).toContain('playLoadsField()');
  });
});
