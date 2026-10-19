import {
  DEFAULT_LOOKBACK_RANGE,
  LOOKBACK_RANGES,
  parseLookbackRange,
  type LookbackRange,
} from '../shared/yahoo';

export const LOOKBACK_STORAGE_KEY = 'sa-lookback-range';

export interface LookbackStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readStoredLookback(storage: LookbackStorage): LookbackRange {
  try {
    return parseLookbackRange(storage.getItem(LOOKBACK_STORAGE_KEY));
  } catch {
    return DEFAULT_LOOKBACK_RANGE;
  }
}

export function writeStoredLookback(storage: LookbackStorage, range: LookbackRange): void {
  try {
    storage.setItem(LOOKBACK_STORAGE_KEY, range);
  } catch {
    // Private browsing can reject storage. The in-memory range still applies.
  }
}

/** Next lookback from a radiogroup arrow key, or null when the key is not a move. */
export function lookbackFromKey(current: LookbackRange, key: string): LookbackRange | null {
  const index = LOOKBACK_RANGES.indexOf(current);
  if (key === 'ArrowRight' || key === 'ArrowDown') return LOOKBACK_RANGES[(index + 1) % LOOKBACK_RANGES.length] ?? null;
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return LOOKBACK_RANGES[(index - 1 + LOOKBACK_RANGES.length) % LOOKBACK_RANGES.length] ?? null;
  }
  if (key === 'Home') return LOOKBACK_RANGES[0];
  if (key === 'End') return LOOKBACK_RANGES[LOOKBACK_RANGES.length - 1] ?? null;
  return null;
}
