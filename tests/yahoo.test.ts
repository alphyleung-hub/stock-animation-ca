import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOOKBACK_RANGE,
  LOOKBACK_RANGES,
  chartApiPath,
  chartCacheKey,
  isLookbackRange,
  parseLookbackRange,
  yahooChartQuery,
  yahooChartUrl,
} from '../shared/yahoo';

describe('Yahoo chart URL', () => {
  it('builds a 1y, 3y, or 5y daily query and defaults to 5y', () => {
    expect(LOOKBACK_RANGES).toEqual(['1y', '3y', '5y']);
    expect(DEFAULT_LOOKBACK_RANGE).toBe('5y');
    expect(yahooChartQuery()).toBe('range=5y&interval=1d&events=div%7Csplit');
    expect(yahooChartQuery('1y')).toBe('range=1y&interval=1d&events=div%7Csplit');
    expect(yahooChartQuery('3y')).toBe('range=3y&interval=1d&events=div%7Csplit');
    expect(yahooChartUrl('NVDA')).toBe(
      'https://query2.finance.yahoo.com/v8/finance/chart/NVDA?range=5y&interval=1d&events=div%7Csplit',
    );
    expect(yahooChartUrl('0700.HK', '1y')).toBe(
      'https://query2.finance.yahoo.com/v8/finance/chart/0700.HK?range=1y&interval=1d&events=div%7Csplit',
    );
    expect(yahooChartUrl('BRK-B', '3y')).toBe(
      'https://query2.finance.yahoo.com/v8/finance/chart/BRK-B?range=3y&interval=1d&events=div%7Csplit',
    );
    expect(yahooChartUrl('NVDA', '1y')).not.toBe(yahooChartUrl('NVDA', '5y'));
  });

  it('accepts only the allowlist, including stored spellings', () => {
    expect(isLookbackRange('1y')).toBe(true);
    expect(isLookbackRange('3y')).toBe(true);
    expect(isLookbackRange('5y')).toBe(true);
    expect(isLookbackRange('5Y')).toBe(false);
    expect(isLookbackRange('1d')).toBe(false);
    expect(isLookbackRange('10y')).toBe(false);
    expect(isLookbackRange('max')).toBe(false);
    expect(parseLookbackRange(null)).toBe('5y');
    expect(parseLookbackRange('')).toBe('5y');
    expect(parseLookbackRange('nope')).toBe('5y');
    expect(parseLookbackRange('1Y')).toBe('1y');
    expect(parseLookbackRange(' 3y ')).toBe('3y');
  });

  it('puts the range in the chart path and the shared cache key', () => {
    expect(chartApiPath('NVDA.US', '2026-10-16', '1y')).toBe('/v1/chart/NVDA.US?d=2026-10-16&range=1y');
    expect(chartApiPath('BRK.B.US', '2026-10-16', '5y')).toBe('/v1/chart/BRK.B.US?d=2026-10-16&range=5y');
    expect(chartCacheKey('NVDA', '2026-10-16', '1y')).toBe(
      'https://stock-animation.cache/v2/chart/NVDA?d=2026-10-16&range=1y',
    );
    expect(chartCacheKey('NVDA', '2026-10-16', '3y')).not.toBe(chartCacheKey('NVDA', '2026-10-16', '5y'));
    expect(chartCacheKey('0700.HK', '2026-10-19', '5y')).not.toBe(chartCacheKey('0700.HK', '2026-10-18', '5y'));
  });
});
