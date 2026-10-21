/** Sent to Yahoo so the relay says who it is. */
export const RELAY_USER_AGENT = 'stock-animation/1.0 (+https://github.com/keithligh/stock-animation)';

/** Yahoo `range` values this app will fetch. Anything else is rejected. */
export const LOOKBACK_RANGES = ['1y', '3y', '5y'] as const;

export type LookbackRange = (typeof LOOKBACK_RANGES)[number];

export const DEFAULT_LOOKBACK_RANGE: LookbackRange = '5y';

const RANGE_SET = new Set<string>(LOOKBACK_RANGES);

export function isLookbackRange(value: string): value is LookbackRange {
  return RANGE_SET.has(value);
}

/** Stored session value, or 5Y when missing or unrecognized. */
export function parseLookbackRange(raw: string | null | undefined): LookbackRange {
  if (raw == null) return DEFAULT_LOOKBACK_RANGE;
  const value = raw.trim().toLowerCase();
  return isLookbackRange(value) ? value : DEFAULT_LOOKBACK_RANGE;
}

/** Split-adjusted daily closes, plus dividend events when Yahoo sends them. */
export function yahooChartQuery(range: LookbackRange = DEFAULT_LOOKBACK_RANGE): string {
  return `range=${range}&interval=1d&events=div%7Csplit`;
}

/** Yahoo chart URL. The symbol is already in Yahoo's form. */
export function yahooChartUrl(yahooSymbol: string, range: LookbackRange = DEFAULT_LOOKBACK_RANGE): string {
  return `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?${yahooChartQuery(range)}`;
}

/** Same-origin chart request. `range` is always explicit so caches cannot collide. */
export function chartApiPath(symbol: string, sessionDate: string, range: LookbackRange): string {
  return `/v1/chart/${encodeURIComponent(symbol)}?d=${sessionDate}&range=${range}`;
}

/**
 * Cache API key for the reduced 5y chart of one Yahoo symbol and session date.
 * Alias spellings of one symbol share an entry; 1y and 3y are cut from it.
 */
export function chartCacheKey(yahooSymbol: string, sessionDate: string): string {
  return `https://stock-animation.cache/v3/chart/${yahooSymbol}?d=${sessionDate}`;
}

/** Cache API key for the last good reduced 5y chart of a symbol, any session date. */
export function lastGoodCacheKey(yahooSymbol: string): string {
  return `https://stock-animation.cache/v3/last/${yahooSymbol}`;
}

/** Cache API key for the pause after Yahoo answers 429 or 5xx. */
export const BACKOFF_CACHE_KEY = 'https://stock-animation.cache/v3/backoff';
