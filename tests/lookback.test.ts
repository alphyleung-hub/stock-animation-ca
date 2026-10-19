import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOOKBACK_RANGES } from '../shared/yahoo';
import {
  LOOKBACK_STORAGE_KEY,
  lookbackFromKey,
  readStoredLookback,
  writeStoredLookback,
  type LookbackStorage,
} from '../src/lookback';

function memoryStorage(initial?: Record<string, string>): LookbackStorage {
  const saved = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => {
      saved.set(key, value);
    },
  };
}

describe('lookback control', () => {
  it('defaults to 5y and keeps a valid choice in session storage', () => {
    const storage = memoryStorage();
    expect(readStoredLookback(storage)).toBe('5y');
    writeStoredLookback(storage, '1y');
    expect(storage.getItem(LOOKBACK_STORAGE_KEY)).toBe('1y');
    expect(readStoredLookback(storage)).toBe('1y');
    expect(readStoredLookback(memoryStorage({ [LOOKBACK_STORAGE_KEY]: '10y' }))).toBe('5y');
    expect(readStoredLookback(memoryStorage({ [LOOKBACK_STORAGE_KEY]: '3y' }))).toBe('3y');
    expect(LOOKBACK_STORAGE_KEY).toBe('sa-lookback-range');
  });

  it('moves between 1y, 3y, and 5y from the keyboard', () => {
    expect(lookbackFromKey('5y', 'ArrowRight')).toBe('1y');
    expect(lookbackFromKey('1y', 'ArrowLeft')).toBe('5y');
    expect(lookbackFromKey('1y', 'End')).toBe('5y');
    expect(lookbackFromKey('5y', 'Home')).toBe('1y');
    expect(lookbackFromKey('3y', 'Enter')).toBeNull();
  });

  it('places 1Y, 3Y, and 5Y beside speed, with 5Y selected', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const save = html.slice(html.indexOf('class="save"'), html.indexOf('</header>'));
    const lookbackAt = save.indexOf('data-lookback');
    const speedAt = save.indexOf('data-speed');
    expect(lookbackAt).toBeGreaterThanOrEqual(0);
    expect(speedAt).toBeGreaterThan(lookbackAt);
    expect(save).toContain('aria-label="Lookback range"');
    expect(save).toContain('aria-label="Playback speed"');
    for (const range of LOOKBACK_RANGES) {
      expect(save).toContain(`data-span="${range}"`);
      expect(save).toContain(`>${range.toUpperCase()}<`);
    }
    const five = save.slice(save.indexOf('data-span="5y"') - 120, save.indexOf('data-span="5y"') + 40);
    expect(five).toContain('aria-checked="true"');
    expect(save.slice(save.indexOf('data-span="1y"') - 80, save.indexOf('data-span="1y"') + 40)).toContain(
      'aria-checked="false"',
    );
  });

  it('reloads the current ticker when the range changes and requests that range', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/function setLookback\([\s\S]*?writeLookback\(range\)[\s\S]*?loadTicker\(ticker\.value\)/);
    expect(main).toMatch(/function fetchChart\([\s\S]*?chartApiPath\(symbol, session, range\)/);
    expect(main).toContain('readStoredLookback(sessionStorage)');
    expect(main).toContain('data-lookback');
  });
});
