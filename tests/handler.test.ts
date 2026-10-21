import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../shared/rate-limit';
import { BACKOFF_CACHE_KEY, chartCacheKey, lastGoodCacheKey, RELAY_USER_AGENT, yahooChartUrl } from '../shared/yahoo';
import { handleChartRequest, type Env, type HandlerDeps, type ResponseCache } from '../workers/api/src/handler';

const NOW = new Date('2026-10-19T09:54:00Z');
const ENV: Env = { ALLOWED_ORIGIN: 'http://localhost:5173,http://127.0.0.1:5173' };
const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin' };

interface Bar {
  date: string;
  close: number | null;
}

/** Unix seconds for a bar on `date`: 13:30 UTC is the US open, 01:30 UTC the HK open. */
function stamp(date: string, symbol: string): number {
  return Date.parse(`${date}T${symbol.endsWith('.HK') ? '01:30' : '13:30'}:00Z`) / 1000;
}

/** A Yahoo chart body, with the extra fields Yahoo sends and the film never reads. */
function yahooBody(
  symbol = 'NVDA',
  bars: Bar[] = [{ date: '2026-10-16', close: 115.456 }],
  dividends: Array<{ date: string; amount: number }> = [],
): string {
  const hk = symbol.endsWith('.HK');
  return JSON.stringify({
    chart: {
      result: [
        {
          meta: {
            symbol,
            shortName: `${symbol} Inc`,
            longName: `${symbol} Incorporated`,
            currency: hk ? 'HKD' : 'USD',
            exchangeTimezoneName: hk ? 'Asia/Hong_Kong' : 'America/New_York',
            regularMarketPrice: 999,
            fiftyTwoWeekHigh: 1000,
          },
          timestamp: bars.map((bar) => stamp(bar.date, symbol)),
          events: {
            dividends: Object.fromEntries(
              dividends.map((d) => [String(stamp(d.date, symbol)), { amount: d.amount, date: stamp(d.date, symbol) }]),
            ),
          },
          indicators: {
            quote: [{ close: bars.map((bar) => bar.close), open: bars.map(() => 1), volume: bars.map(() => 10) }],
            adjclose: [{ adjclose: bars.map(() => 1) }],
          },
        },
      ],
      error: null,
    },
  });
}

interface Payload {
  symbol: string;
  name: string;
  currency: string;
  timeZone: string;
  dates: string[];
  closes: number[];
  dividends: Array<{ date: string; amount: number }>;
}

async function payload(response: Response): Promise<Payload> {
  return (await response.json()) as Payload;
}

function memoryCache(): ResponseCache & { keys(): string[] } {
  const saved = new Map<string, { status: number; headers: [string, string][]; body: string }>();
  return {
    keys: () => [...saved.keys()],
    async match(request) {
      const hit = saved.get(request.url);
      if (!hit) return undefined;
      return new Response(hit.body, { status: hit.status, headers: hit.headers });
    },
    async put(request, response) {
      saved.set(request.url, {
        status: response.status,
        headers: [...response.headers.entries()],
        body: await response.text(),
      });
    },
  };
}

function harness(options?: {
  status?: number;
  body?: string;
  contentType?: string;
  headers?: Record<string, string>;
  limit?: (key: string) => boolean;
  cache?: ResponseCache;
  now?: Date;
}) {
  const calls: Array<{ url: string; userAgent: string | null }> = [];
  const body = options?.body ?? yahooBody();
  const pending: Promise<unknown>[] = [];
  const deps: HandlerDeps = {
    now: () => options?.now ?? NOW,
    cache: options?.cache ?? memoryCache(),
    limit: options?.limit ?? (() => true),
    fetch: async (input, init) => {
      const request = new Request(input, init);
      calls.push({ url: request.url, userAgent: request.headers.get('User-Agent') });
      return new Response(body, {
        status: options?.status ?? 200,
        headers: { 'Content-Type': options?.contentType ?? 'application/json;charset=utf-8', ...options?.headers },
      });
    },
  };
  return {
    calls,
    deps,
    async run(path: string, headers?: Record<string, string>, method = 'GET') {
      const request = new Request(`https://api.test${path}`, { method, headers: headers ?? SAME_ORIGIN });
      const response = await handleChartRequest(request, ENV, {
        waitUntil(promise) {
          pending.push(promise);
        },
      }, deps);
      await Promise.all(pending);
      return response;
    },
  };
}

/** Weekday bars from `from` through `to`, closes counting up from 1. */
function weekdays(from: string, to: string): Bar[] {
  const bars: Bar[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) bars.push({ date: cursor.toISOString().slice(0, 10), close: bars.length + 1 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return bars;
}

describe('chart relay', () => {
  it('returns only the fields the film reads, with closes rounded to the cent', async () => {
    const hk = harness({
      body: yahooBody('0700.HK', [
        { date: '2026-10-16', close: 400.2049 },
        { date: '2026-10-17', close: null },
        { date: '2026-10-19', close: 401.6000061 },
        { date: '2026-10-20', close: 999 },
      ], [{ date: '2026-10-16', amount: 4.5 }]),
    });
    const response = await hk.run('/v1/chart/0700.HK?d=2026-10-19');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      symbol: '0700.HK',
      name: '0700.HK Inc',
      currency: 'HKD',
      timeZone: 'Asia/Hong_Kong',
      dates: ['2026-10-16', '2026-10-19'],
      closes: [400.2, 401.6],
      dividends: [{ date: '2026-10-16', amount: 4.5 }],
    });
    expect(hk.calls).toEqual([{ url: yahooChartUrl('0700.HK', '5y'), userAgent: RELAY_USER_AGENT }]);
    expect(RELAY_USER_AGENT).toBe('stock-animation/1.0 (+https://github.com/keithligh/stock-animation)');
    expect(yahooChartUrl('NVDA')).toContain('events=div%7Csplit');
  });

  it('never lets a shared cache keep a relay response, and never leaks cache internals', async () => {
    const cache = memoryCache();
    const api = harness({ cache });
    for (const response of [await api.run('/v1/chart/NVDA.US?d=2026-10-16'), await api.run('/v1/chart/NVDA.US?d=2026-10-16&range=1y')]) {
      expect(response.headers.get('Cache-Control')).toMatch(/^private, max-age=\d+$/);
      expect(response.headers.get('X-Fetched-At')).toBeNull();
      expect(response.headers.get('Vary')).toBe('Origin');
    }
    const stored = await cache.match(new Request(chartCacheKey('NVDA', '2026-10-16')));
    const text = (await stored?.text()) ?? '';
    expect(text).not.toContain('regularMarketPrice');
    expect(text).not.toContain('adjclose');
    expect(text).not.toContain('longName');
  });

  it('maps 700.HK and BRK.B.US onto Yahoo symbols', async () => {
    const hk = harness({ body: yahooBody('0700.HK', [{ date: '2026-10-19', close: 1 }]) });
    await hk.run('/v1/chart/700.HK?d=2026-10-19');
    expect(hk.calls[0]?.url).toBe(yahooChartUrl('0700.HK', '5y'));

    const brk = harness({ body: yahooBody('BRK-B') });
    await brk.run('/v1/chart/BRK.B.US?d=2026-10-16');
    expect(brk.calls[0]?.url).toBe(yahooChartUrl('BRK-B', '5y'));
  });

  it('rejects a symbol, session, or range the relay must not fetch', async () => {
    const api = harness();
    expect((await api.run('/v1/chart/NVDA?d=2026-10-16')).status).toBe(400);
    expect((await api.run('/v1/chart/NVDA.US')).status).toBe(400);
    expect((await api.run('/v1/chart/NVDA.US?d=2026-10-14')).status).toBe(400);
    for (const range of ['1d', '10y', '5Y', '', 'max']) {
      expect((await api.run(`/v1/chart/NVDA.US?d=2026-10-16&range=${range}`)).status).toBe(400);
    }
    expect((await api.run('/v1/chart/NVDA.US?d=2026-10-16&range=1y&range=5y')).status).toBe(400);
    expect((await api.run('/v1/chart/NVDA.US?d=2026-10-16&range=5y&interval=1wk')).status).toBe(400);
    expect((await api.run('/v1/chart/NVDA.US?d=2026-10-16', SAME_ORIGIN, 'POST')).status).toBe(405);
    expect(api.calls).toHaveLength(0);
  });

  it('turns Yahoo 404 into a cached 404', async () => {
    const cache = memoryCache();
    const missing = harness({ cache, status: 404, body: '<html>gone</html>', contentType: 'text/html' });
    const response = await missing.run('/v1/chart/0700.HK?d=2026-10-19');
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect((await missing.run('/v1/chart/0700.HK?d=2026-10-19&range=1y')).status).toBe(404);
    expect(missing.calls).toHaveLength(1);
  });

  it('backs off after Yahoo 429 or 5xx instead of retrying', async () => {
    for (const status of [429, 500, 502]) {
      const cache = memoryCache();
      const limited = harness({ cache, status, body: 'slow down' });
      const first = await limited.run('/v1/chart/NVDA.US?d=2026-10-16');
      expect(first.status).toBe(503);
      expect(first.headers.get('Cache-Control')).toBe('no-store');
      expect(await first.json()).toEqual({ error: 'upstream' });
      expect(limited.calls).toHaveLength(1);
      expect(cache.keys()).toEqual([BACKOFF_CACHE_KEY]);

      expect((await limited.run('/v1/chart/AAPL.US?d=2026-10-16')).status).toBe(503);
      expect(limited.calls).toHaveLength(1);

      const later = harness({ cache, now: new Date(NOW.getTime() + 61_000) });
      expect((await later.run('/v1/chart/NVDA.US?d=2026-10-16')).status).toBe(200);
      expect(later.calls).toHaveLength(1);
    }
  });

  it('honours a longer Retry-After, up to 15 minutes', async () => {
    const cache = memoryCache();
    await harness({ cache, status: 429, headers: { 'Retry-After': '300' } }).run('/v1/chart/NVDA.US?d=2026-10-16');
    const stillWaiting = harness({ cache, now: new Date(NOW.getTime() + 299_000) });
    expect((await stillWaiting.run('/v1/chart/NVDA.US?d=2026-10-16')).status).toBe(503);
    expect(stillWaiting.calls).toHaveLength(0);
  });

  it('serves the last good copy when Yahoo fails and one exists', async () => {
    const cache = memoryCache();
    const friday = harness({ cache, body: yahooBody('NVDA', [{ date: '2026-10-15', close: 10 }, { date: '2026-10-16', close: 11 }]) });
    expect((await friday.run('/v1/chart/NVDA.US?d=2026-10-16')).status).toBe(200);

    const monday = new Date('2026-10-19T21:00:00Z');
    const failing = harness({ cache, now: monday, status: 503, body: 'down' });
    const stale = await failing.run('/v1/chart/NVDA.US?d=2026-10-19');
    expect(stale.status).toBe(200);
    expect(stale.headers.get('Cache-Control')).toBe('no-store');
    expect((await payload(stale)).closes).toEqual([10, 11]);
    expect(failing.calls).toHaveLength(1);

    const backedOff = harness({ cache, now: monday });
    expect((await backedOff.run('/v1/chart/NVDA.US?d=2026-10-19')).status).toBe(200);
    expect(backedOff.calls).toHaveLength(0);

    const thrown = harness({ cache, now: monday });
    thrown.deps.fetch = async () => {
      throw new TypeError('network down');
    };
    const other = memoryCache();
    await other.put(new Request(lastGoodCacheKey('NVDA')), (await cache.match(new Request(lastGoodCacheKey('NVDA'))))!);
    thrown.deps.cache = other;
    expect((await payload(await thrown.run('/v1/chart/NVDA.US?d=2026-10-19'))).closes).toEqual([10, 11]);
  });

  it('does not cache a non-JSON or non-chart success, and answers 503 when Yahoo throws', async () => {
    for (const options of [
      { body: '<html>consent</html>', contentType: 'text/html' },
      { body: '{not-json' },
      { body: '{"something":"else"}' },
    ]) {
      const cache = memoryCache();
      const response = await harness({ cache, ...options }).run('/v1/chart/NVDA.US?d=2026-10-16');
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(cache.keys()).toHaveLength(0);
    }
    const api = harness();
    api.deps.fetch = async () => {
      throw new TypeError('network down');
    };
    const response = await api.run('/v1/chart/NVDA.US?d=2026-10-16');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'upstream' });
  });

  it('calls Yahoo once per symbol and session date, then serves the shared cache', async () => {
    const cache = memoryCache();
    const miss = harness({ cache, body: yahooBody('0700.HK', [{ date: '2026-10-19', close: 1 }]) });
    expect((await miss.run('/v1/chart/700.HK?d=2026-10-19')).status).toBe(200);
    expect(miss.calls).toHaveLength(1);
    expect(cache.keys().sort()).toEqual([chartCacheKey('0700.HK', '2026-10-19'), lastGoodCacheKey('0700.HK')]);

    let limited = false;
    const hit = harness({
      cache,
      body: yahooBody('0700.HK', [{ date: '2026-10-19', close: 2 }]),
      limit: () => {
        limited = true;
        return false;
      },
    });
    const cached = await hit.run('/v1/chart/0700.HK?d=2026-10-19');
    expect((await payload(cached)).closes).toEqual([1]);
    expect(cached.headers.get('Cache-Control')).toMatch(/^private, max-age=\d+$/);
    expect(hit.calls).toHaveLength(0);
    expect(limited).toBe(false);

    const otherDay = harness({ cache, body: yahooBody('0700.HK', [{ date: '2026-10-16', close: 3 }]) });
    expect((await payload(await otherDay.run('/v1/chart/0700.HK?d=2026-10-18'))).closes).toEqual([3]);
    expect(otherDay.calls).toHaveLength(1);
  });

  it('cuts 1y and 3y from one 5y fetch, starting where Yahoo starts them', async () => {
    const cache = memoryCache();
    const bars = weekdays('2021-10-18', '2026-10-16');
    const api = harness({
      cache,
      body: yahooBody('NVDA', bars, [
        { date: '2022-03-01', amount: 0.004 },
        { date: '2024-03-05', amount: 0.004 },
        { date: '2026-03-03', amount: 0.01 },
      ]),
    });
    const five = await payload(await api.run('/v1/chart/NVDA.US?d=2026-10-16&range=5y'));
    const three = await payload(await api.run('/v1/chart/NVDA.US?d=2026-10-16&range=3y'));
    const one = await payload(await api.run('/v1/chart/NVDA.US?d=2026-10-16&range=1y'));
    const omitted = await payload(await api.run('/v1/chart/NVDA.US?d=2026-10-16'));
    expect(api.calls).toEqual([{ url: yahooChartUrl('NVDA', '5y'), userAgent: RELAY_USER_AGENT }]);

    // Fetched 2026-10-19 New York time: 1y starts on or after 2025-10-19, 3y on or after 2023-10-19.
    expect(five.dates[0]).toBe('2021-10-18');
    expect(three.dates[0]).toBe('2023-10-19');
    expect(one.dates[0]).toBe('2025-10-20');
    for (const cut of [five, three, one]) {
      expect(cut.dates.at(-1)).toBe('2026-10-16');
      expect(cut.closes).toHaveLength(cut.dates.length);
      expect(cut.closes.at(-1)).toBe(bars.length);
    }
    expect(one.closes[0]).toBe(five.closes[five.dates.indexOf('2025-10-20')]);
    expect(five.dividends).toHaveLength(3);
    expect(three.dividends.map((d) => d.date)).toEqual(['2024-03-05', '2026-03-03']);
    expect(one.dividends).toEqual([{ date: '2026-03-03', amount: 0.01 }]);
    expect(omitted).toEqual(five);
    expect(cache.keys().sort()).toEqual([chartCacheKey('NVDA', '2026-10-16'), lastGoodCacheKey('NVDA')]);
  });

  it('stops before Yahoo when the miss limit is exhausted', async () => {
    const api = harness({ limit: (key) => key !== 'global' });
    const response = await api.run('/v1/chart/NVDA.US?d=2026-10-16');
    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(api.calls).toHaveLength(0);
  });

  it('blocks a browser origin that is not the app, and allows the dev origins it is given', async () => {
    const api = harness();
    const path = '/v1/chart/NVDA.US?d=2026-10-16';
    expect((await api.run(path, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await api.run(path, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'same-origin' })).status).toBe(403);
    expect((await api.run(path, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect(api.calls).toHaveLength(0);
    const dev = await api.run(path, { Origin: 'http://localhost:5173', 'Sec-Fetch-Site': 'cross-site' });
    expect(dev.status).toBe(200);
    expect(dev.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    const proxied = await api.run(path, { 'Sec-Fetch-Site': 'same-origin', Referer: 'http://localhost:5173/' });
    expect(proxied.status).toBe(200);
  });

  it('refuses a request that does not come from the app page', async () => {
    const api = harness();
    const path = '/v1/chart/NVDA.US?d=2026-10-16';
    expect((await api.run(path, {})).status).toBe(403);
    expect((await api.run(path, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await api.run(path, { 'Sec-Fetch-Site': 'same-site' })).status).toBe(403);
    expect((await api.run(path, { 'Sec-Fetch-Site': 'none' })).status).toBe(403);
    expect((await api.run(path, { Referer: 'https://evil.example/page' })).status).toBe(403);
    expect((await api.run(path, { 'Sec-Fetch-Site': 'same-origin', Referer: 'https://evil.example/' })).status).toBe(403);
    expect((await api.run(path, { Referer: 'not a url' })).status).toBe(403);
    expect((await api.run(path, {}, 'OPTIONS')).status).toBe(403);
    expect(api.calls).toHaveLength(0);
    expect((await api.run(path, { Referer: 'https://api.test/' })).status).toBe(200);
    expect((await api.run(path, { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(200);
    expect((await api.run(path, { Origin: 'https://api.test' })).status).toBe(200);
  });

  it('checks the caller before it reads the cache', async () => {
    const cache = memoryCache();
    await harness({ cache }).run('/v1/chart/NVDA.US?d=2026-10-16');
    let reads = 0;
    const counting: ResponseCache = {
      match: async (request) => {
        reads += 1;
        return cache.match(request);
      },
      put: (request, response) => cache.put(request, response),
    };
    const response = await harness({ cache: counting }).run('/v1/chart/NVDA.US?d=2026-10-16', {});
    expect(response.status).toBe(403);
    expect(reads).toBe(0);
  });
});

describe('in-memory rate limiter', () => {
  it('allows 60 and blocks the 61st in the same window', () => {
    const limiter = createRateLimiter(60, 60_000);
    for (let i = 0; i < 60; i += 1) expect(limiter.allow('global', 1_000)).toBe(true);
    expect(limiter.allow('global', 1_000)).toBe(false);
    expect(limiter.allow('global', 61_000)).toBe(true);
    expect(limiter.allow('ip:other', 1_000)).toBe(true);
  });
});
