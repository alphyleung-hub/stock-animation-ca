import type { Dividend, ParsedSeries } from './parse';
import { timestampToExchangeDate } from './session';
import type { LookbackRange } from './yahoo';

/**
 * What the relay sends the page: only the fields the film reads.
 * `dates` are exchange-local `YYYY-MM-DD`; `closes` line up with them.
 */
export interface ChartPayload {
  symbol: string;
  name: string;
  currency: string;
  timeZone: string;
  dates: string[];
  closes: number[];
  dividends: Dividend[];
}

const YEARS: Record<LookbackRange, number> = { '1y': 1, '3y': 3, '5y': 5 };

/** Parsed Yahoo series to payload. Closes are rounded to the cent. */
export function toChartPayload(series: ParsedSeries): ChartPayload {
  return {
    symbol: series.yahooSymbol,
    name: series.name,
    currency: series.currency,
    timeZone: series.timeZone,
    dates: series.bars.map((bar) => bar.date),
    closes: series.bars.map((bar) => Math.round(bar.close * 100) / 100),
    dividends: series.dividends.map((dividend) => ({
      date: dividend.date,
      amount: Math.round(dividend.amount * 1e6) / 1e6,
    })),
  };
}

/**
 * First date of a lookback window, as Yahoo's own `range` draws it: the
 * exchange-local date of the fetch, that many years earlier.
 */
export function lookbackStart(range: LookbackRange, fetchedAtMs: number, timeZone: string): string {
  const today = timestampToExchangeDate(Math.floor(fetchedAtMs / 1000), timeZone);
  const year = Number(today.slice(0, 4)) - YEARS[range];
  return `${String(year).padStart(4, '0')}${today.slice(4)}`;
}

/** 1y or 3y cut from a 5y payload fetched at `fetchedAtMs`. 5y is returned as is. */
export function windowChart(payload: ChartPayload, range: LookbackRange, fetchedAtMs: number): ChartPayload {
  if (range === '5y') return payload;
  const start = lookbackStart(range, fetchedAtMs, payload.timeZone);
  let first = payload.dates.findIndex((date) => date >= start);
  if (first < 0) first = payload.dates.length;
  return {
    ...payload,
    dates: payload.dates.slice(first),
    closes: payload.closes.slice(first),
    dividends: payload.dividends.filter((dividend) => dividend.date >= start),
  };
}
