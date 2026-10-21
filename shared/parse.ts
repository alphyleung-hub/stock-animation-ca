import { isIsoDate, timestampToExchangeDate } from './session';
import { mapRelaySymbol, type Market } from './symbols';

export interface Bar {
  date: string;
  close: number;
}

export interface Dividend {
  date: string;
  /** Cash per split-adjusted share, as Yahoo reports it alongside `events=split`. */
  amount: number;
}

export interface ParsedSeries {
  displaySymbol: string;
  yahooSymbol: string;
  name: string;
  currency: string;
  timeZone: string;
  bars: Bar[];
  dividends: Dividend[];
  source: 'yahoo';
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

interface YahooPayload {
  chart?: {
    result?: Array<YahooResult> | null;
    error?: { description?: string } | null;
  };
}

interface YahooResult {
  meta?: {
    symbol?: string;
    shortName?: string;
    currency?: string;
    exchangeTimezoneName?: string;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{ close?: Array<number | null> }>;
    adjclose?: Array<{ adjclose?: Array<number | null> }>;
  };
  events?: {
    dividends?: Record<string, { amount?: number; date?: number }>;
  };
}

/**
 * Yahoo chart JSON → daily closes.
 * Uses `indicators.quote[0].close` (split-adjusted when `events=split`), never `adjclose`.
 * Null closes are removed. Bars and dividends after `sessionDate` (exchange-local) are removed.
 */
export function parseYahooChart(payload: unknown, sessionDate: string): ParsedSeries {
  if (!isIsoDate(sessionDate)) throw new ParseError('session date must be YYYY-MM-DD');
  const chart = asYahoo(payload);
  if (chart.error?.description) throw new ParseError(chart.error.description);
  const result = chart.result?.[0];
  if (!result) throw new ParseError('Yahoo chart has no result');

  const yahooSymbol = result.meta?.symbol?.trim().toUpperCase();
  if (!yahooSymbol) throw new ParseError('Yahoo chart has no symbol');
  const market = marketFromYahoo(yahooSymbol);
  const timeZone = result.meta?.exchangeTimezoneName || defaultZone(market);
  const display = displayFromYahoo(yahooSymbol, market);
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  if (timestamps.length === 0 || closes.length === 0) {
    throw new ParseError('Yahoo chart has no closes');
  }

  const byDate = new Map<string, number>();
  const count = Math.min(timestamps.length, closes.length);
  for (let i = 0; i < count; i += 1) {
    const close = closes[i];
    const stamp = timestamps[i];
    if (close === null || close === undefined || stamp === undefined) continue;
    if (!Number.isFinite(close)) continue;
    const date = timestampToExchangeDate(stamp, timeZone);
    if (date > sessionDate) continue;
    byDate.set(date, close);
  }
  if (byDate.size === 0) throw new ParseError('Yahoo returned no prices for that date.');

  const bars = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, close]) => ({ date, close }));

  return {
    displaySymbol: display,
    yahooSymbol,
    name: result.meta?.shortName?.trim() || display,
    currency: result.meta?.currency?.trim() || (market === 'HK' ? 'HKD' : 'USD'),
    timeZone,
    bars,
    dividends: parseDividends(result, timeZone, sessionDate),
    source: 'yahoo',
  };
}

function parseDividends(result: YahooResult, timeZone: string, sessionDate: string): Dividend[] {
  const raw = result.events?.dividends;
  if (!raw) return [];
  const byDate = new Map<string, number>();
  for (const entry of Object.values(raw)) {
    const amount = entry?.amount;
    const stamp = entry?.date;
    if (amount === undefined || stamp === undefined || !Number.isFinite(amount) || amount <= 0) continue;
    const date = timestampToExchangeDate(stamp, timeZone);
    if (date > sessionDate) continue;
    byDate.set(date, (byDate.get(date) ?? 0) + amount);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, amount]) => ({ date, amount }));
}

function asYahoo(payload: unknown): NonNullable<YahooPayload['chart']> {
  if (!payload || typeof payload !== 'object') throw new ParseError('Yahoo payload is not an object');
  const chart = (payload as YahooPayload).chart;
  if (!chart || typeof chart !== 'object') throw new ParseError('Yahoo payload has no chart');
  return chart;
}

function marketFromYahoo(yahooSymbol: string): Market {
  return yahooSymbol.endsWith('.HK') ? 'HK' : 'US';
}

function displayFromYahoo(yahooSymbol: string, market: Market): string {
  if (market === 'HK') {
    const mapped = mapRelaySymbol(yahooSymbol);
    return mapped?.display ?? yahooSymbol;
  }
  const relay = `${yahooSymbol.replace(/-([A-Z])$/, '.$1')}.US`;
  return mapRelaySymbol(relay)?.display ?? relay;
}

function defaultZone(market: Market): string {
  switch (market) {
    case 'HK':
      return 'Asia/Hong_Kong';
    case 'US':
      return 'America/New_York';
    default: {
      const never: never = market;
      throw new ParseError(`unknown market ${never}`);
    }
  }
}
