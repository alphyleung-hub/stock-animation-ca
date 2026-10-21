import { describe, expect, it } from 'vitest';
import { lookbackStart, toChartPayload, windowChart, type ChartPayload } from '../shared/chart';
import { ParseError, parseChartPayload, parseYahooChart } from '../shared/parse';

const JUNE3_OPEN = Date.parse('2024-06-03T13:30:00Z') / 1000;

function yahoo(overrides?: {
  symbol?: string;
  shortName?: string;
  currency?: string;
  timeZone?: string;
  timestamps?: number[];
  closes?: Array<number | null>;
  adjcloses?: Array<number | null>;
  error?: string;
}) {
  return {
    chart: {
      result: overrides?.error
        ? null
        : [
            {
              meta: {
                symbol: overrides?.symbol ?? 'NVDA',
                shortName: overrides?.shortName ?? 'NVIDIA Corporation',
                currency: overrides?.currency ?? 'USD',
                exchangeTimezoneName: overrides?.timeZone ?? 'America/New_York',
              },
              timestamp: overrides?.timestamps ?? [JUNE3_OPEN],
              indicators: {
                quote: [{ close: overrides?.closes ?? [115] }],
                adjclose: [{ adjclose: overrides?.adjcloses ?? [114.673] }],
              },
            },
          ],
      error: overrides?.error ? { description: overrides.error } : null,
    },
  };
}

describe('Yahoo parser', () => {
  it('reads split-adjusted quote closes and ignores adjclose', () => {
    const series = parseYahooChart(yahoo(), '2024-06-03');
    expect(series.bars).toEqual([{ date: '2024-06-03', close: 115 }]);
    expect(series.displaySymbol).toBe('NVDA.US');
    expect(series.yahooSymbol).toBe('NVDA');
    expect(series.name).toBe('NVIDIA Corporation');
    expect(series.currency).toBe('USD');
    expect(series.dividends).toEqual([]);
  });

  it('keeps split-adjusted dividend amounts on or before the session', () => {
    const payload = yahoo();
    const result = payload.chart.result?.[0];
    const withDividends = {
      ...payload,
      chart: {
        ...payload.chart,
        result: result
          ? [
              {
                ...result,
                events: {
                  dividends: {
                    a: { amount: 0.25, date: JUNE3_OPEN },
                    b: { amount: 1, date: JUNE3_OPEN + 86_400 * 5 },
                    c: { amount: 0, date: JUNE3_OPEN },
                  },
                },
              },
            ]
          : null,
      },
    };
    const series = parseYahooChart(withDividends, '2024-06-03');
    expect(series.dividends).toEqual([{ date: '2024-06-03', amount: 0.25 }]);
  });

  it('drops null closes instead of substituting adjclose', () => {
    const series = parseYahooChart(
      yahoo({
        timestamps: [JUNE3_OPEN, JUNE3_OPEN + 86_400],
        closes: [115, null],
        adjcloses: [114.6, 120],
      }),
      '2024-06-05',
    );
    expect(series.bars).toEqual([{ date: '2024-06-03', close: 115 }]);
  });

  it('drops bars after the last completed session in the exchange timezone', () => {
    const stillJune3 = Date.parse('2024-06-04T01:00:00Z') / 1000;
    const alreadyJune4 = Date.parse('2024-06-04T04:30:00Z') / 1000;
    const series = parseYahooChart(
      yahoo({
        timestamps: [stillJune3, alreadyJune4],
        closes: [10, 99],
        adjcloses: [10, 99],
      }),
      '2024-06-03',
    );
    expect(series.bars).toEqual([{ date: '2024-06-03', close: 10 }]);
  });

  it('parses an HK chart in Hong Kong dates', () => {
    const open = Date.parse('2021-10-18T01:30:00Z') / 1000;
    const series = parseYahooChart(
      yahoo({
        symbol: '0700.HK',
        shortName: 'TENCENT',
        currency: 'HKD',
        timeZone: 'Asia/Hong_Kong',
        timestamps: [open],
        closes: [458.16265869140625],
        adjcloses: [1],
      }),
      '2021-10-18',
    );
    expect(series.displaySymbol).toBe('0700.HK');
    expect(series.bars[0]).toEqual({ date: '2021-10-18', close: 458.16265869140625 });
    expect(series.currency).toBe('HKD');
  });

  it('surfaces a Yahoo error payload', () => {
    expect(() => parseYahooChart(yahoo({ error: 'Not Found' }), '2024-06-03')).toThrow(ParseError);
  });
});

describe('relay payload parser', () => {
  const relay = {
    symbol: '0700.HK',
    name: 'TENCENT',
    currency: 'HKD',
    timeZone: 'Asia/Hong_Kong',
    dates: ['2026-10-15', '2026-10-16', '2026-10-19'],
    closes: [400.2, 401.6, 405],
    dividends: [{ date: '2026-10-16', amount: 4.5 }, { date: '2026-10-19', amount: 1 }],
  };

  it('reads the reduced payload into the same series the film uses', () => {
    const series = parseChartPayload(relay, '2026-10-16');
    expect(series).toEqual({
      displaySymbol: '0700.HK',
      yahooSymbol: '0700.HK',
      name: 'TENCENT',
      currency: 'HKD',
      timeZone: 'Asia/Hong_Kong',
      bars: [
        { date: '2026-10-15', close: 400.2 },
        { date: '2026-10-16', close: 401.6 },
      ],
      dividends: [{ date: '2026-10-16', amount: 4.5 }],
      source: 'yahoo',
    });
  });

  it('matches parseYahooChart for the same prices', () => {
    const fromYahoo = parseYahooChart(yahoo(), '2024-06-03');
    const fromRelay = parseChartPayload(
      { symbol: 'NVDA', name: 'NVIDIA Corporation', currency: 'USD', timeZone: 'America/New_York', dates: ['2024-06-03'], closes: [115], dividends: [] },
      '2024-06-03',
    );
    expect(fromRelay).toEqual(fromYahoo);
  });

  it('falls back like the Yahoo parser and rejects an empty payload', () => {
    const series = parseChartPayload({ symbol: 'brk-b', dates: ['2026-10-16'], closes: [500] }, '2026-10-16');
    expect(series.displaySymbol).toBe('BRK.B.US');
    expect(series.name).toBe('BRK.B.US');
    expect(series.currency).toBe('USD');
    expect(series.timeZone).toBe('America/New_York');
    expect(() => parseChartPayload({ symbol: 'NVDA', dates: [], closes: [] }, '2026-10-16')).toThrow(ParseError);
    expect(() => parseChartPayload({ error: 'upstream' }, '2026-10-16')).toThrow(ParseError);
    expect(() => parseChartPayload(null, '2026-10-16')).toThrow(ParseError);
  });
});

describe('lookback windows', () => {
  it('starts 1y and 3y on the exchange-local fetch date, that many years back', () => {
    const fetched = Date.parse('2026-10-21T05:18:00Z');
    expect(lookbackStart('1y', fetched, 'America/New_York')).toBe('2025-10-21');
    expect(lookbackStart('3y', fetched, 'Asia/Hong_Kong')).toBe('2023-10-21');
    expect(lookbackStart('1y', Date.parse('2026-10-20T20:00:00Z'), 'Asia/Hong_Kong')).toBe('2025-10-21');
    expect(lookbackStart('1y', Date.parse('2026-10-20T20:00:00Z'), 'America/New_York')).toBe('2025-10-20');
  });

  it('cuts dates, closes, and dividends together and leaves 5y alone', () => {
    const five: ChartPayload = {
      symbol: '0700.HK',
      name: 'TENCENT',
      currency: 'HKD',
      timeZone: 'Asia/Hong_Kong',
      dates: ['2023-10-20', '2023-10-24', '2025-10-20', '2025-10-21'],
      closes: [1, 2, 3, 4],
      dividends: [{ date: '2023-10-20', amount: 1 }, { date: '2025-10-21', amount: 2 }],
    };
    const fetched = Date.parse('2026-10-21T05:18:00Z');
    expect(windowChart(five, '5y', fetched)).toBe(five);
    expect(windowChart(five, '3y', fetched)).toMatchObject({ dates: ['2023-10-24', '2025-10-20', '2025-10-21'], closes: [2, 3, 4] });
    expect(windowChart(five, '1y', fetched)).toMatchObject({
      dates: ['2025-10-21'],
      closes: [4],
      dividends: [{ date: '2025-10-21', amount: 2 }],
    });
  });

  it('rounds closes to the cent', () => {
    const payload = toChartPayload(parseYahooChart(yahoo({ closes: [115.456789] }), '2024-06-03'));
    expect(payload.closes).toEqual([115.46]);
    expect(payload.dates).toEqual(['2024-06-03']);
  });
});
