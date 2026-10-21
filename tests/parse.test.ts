import { describe, expect, it } from 'vitest';
import { ParseError, parseYahooChart } from '../shared/parse';

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
