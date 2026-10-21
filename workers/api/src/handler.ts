import { toChartPayload, windowChart, type ChartPayload } from '../../../shared/chart';
import { ParseError, parseYahooChart } from '../../../shared/parse';
import { createRateLimiter } from '../../../shared/rate-limit';
import { cacheMaxAgeSeconds, isAcceptableSessionDate } from '../../../shared/session';
import { mapRelaySymbol } from '../../../shared/symbols';
import {
  BACKOFF_CACHE_KEY,
  chartCacheKey,
  DEFAULT_LOOKBACK_RANGE,
  isLookbackRange,
  lastGoodCacheKey,
  RELAY_USER_AGENT,
  yahooChartUrl,
  type LookbackRange,
} from '../../../shared/yahoo';

const DAY_SECONDS = 86_400;
/** How long the last good chart of a symbol stays available when Yahoo fails. */
const LAST_GOOD_SECONDS = 7 * DAY_SECONDS;
/** Pause after Yahoo answers 429 or 5xx. A Retry-After header can lengthen it. */
const BACKOFF_SECONDS = 60;
const BACKOFF_MAX_SECONDS = 900;
/** Internal header on cache entries only. Never sent to the browser. */
const FETCHED_AT = 'X-Fetched-At';
const memoryLimiter = createRateLimiter(60);

export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ALLOWED_ORIGIN?: string;
  RATE_LIMITER?: RateLimiterBinding;
}

export interface ResponseCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

export interface HandlerDeps {
  fetch: typeof fetch;
  cache: ResponseCache;
  now: () => Date;
  /** Test seam. When set, the binding and the in-memory limiter are not used. */
  limit?: (key: string) => boolean | Promise<boolean>;
  /** Internal log line per chart request: hit, miss, stale, or backoff. */
  log?: (line: string) => void;
}

interface Entry {
  payload: ChartPayload;
  fetchedAtMs: number;
}

/**
 * Yahoo relay for the app's own page. The Worker runs on every request:
 * Cloudflare does not cache /v1 responses in front of it, and the Cache API
 * below is read only after the request is known to come from the page.
 *
 * One Yahoo 5y fetch per symbol and session date `d` is reduced to the
 * fields the film reads and cached; 1y and 3y are cut from that entry.
 * When Yahoo fails, the last good copy of the symbol is served if there is one.
 */
export async function handleChartRequest(
  request: Request,
  env: Env,
  ctx: WaitUntil,
  deps: HandlerDeps,
): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = allowedOrigins(env);
  const pageOrigin = url.origin;

  if (!fromOwnPage(request, pageOrigin, allowed)) {
    return json({ error: 'origin_not_allowed' }, 403, 'no-store', null);
  }
  const allowOrigin = originHeader(origin, pageOrigin, allowed);
  if (request.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } }), allowOrigin);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method_not_allowed' }, 405, 'no-store', allowOrigin);
  }

  const match = url.pathname.match(/^\/v1\/chart\/([^/]+)$/);
  if (!match?.[1]) return json({ error: 'not_found' }, 404, 'no-store', allowOrigin);

  let rawSymbol: string;
  try {
    rawSymbol = decodeURIComponent(match[1]);
  } catch {
    return json({ error: 'invalid_symbol' }, 400, 'no-store', allowOrigin);
  }
  const mapped = mapRelaySymbol(rawSymbol);
  if (!mapped) return json({ error: 'invalid_symbol' }, 400, 'no-store', allowOrigin);

  const unexpected = [...url.searchParams.keys()].filter((key) => key !== 'd' && key !== 'range');
  if (unexpected.length > 0 || !url.searchParams.has('d')) {
    return json({ error: 'invalid_session' }, 400, 'no-store', allowOrigin);
  }
  const range = requestedRange(url);
  if (!range) return json({ error: 'invalid_session' }, 400, 'no-store', allowOrigin);
  const sessionDate = url.searchParams.get('d') ?? '';
  if (!isAcceptableSessionDate(mapped.market, sessionDate, deps.now())) {
    return json({ error: 'invalid_session' }, 400, 'no-store', allowOrigin);
  }

  const log = (outcome: string) => deps.log?.(JSON.stringify({ chart: outcome, symbol: mapped.yahoo, d: sessionDate, range }));
  const fresh = () => `private, max-age=${cacheMaxAgeSeconds(mapped.market, deps.now())}`;
  const cacheKey = new Request(chartCacheKey(mapped.yahoo, sessionDate));
  const lastKey = new Request(lastGoodCacheKey(mapped.yahoo));

  const cached = await deps.cache.match(cacheKey);
  if (cached) {
    log('hit');
    if (cached.status === 404) return json({ error: 'not_found' }, 404, fresh(), allowOrigin);
    const entry = await readEntry(cached);
    if (entry) return json(windowChart(entry.payload, range, entry.fetchedAtMs), 200, fresh(), allowOrigin);
  }

  /** Last good copy of this symbol, or the given error when there is none. */
  const staleOr = async (error: string, status: number): Promise<Response> => {
    const last = await deps.cache.match(lastKey);
    const entry = last ? await readEntry(last) : null;
    if (entry) {
      log('stale');
      return json(windowChart(entry.payload, range, entry.fetchedAtMs), 200, 'no-store', allowOrigin);
    }
    return json({ error }, status, 'no-store', allowOrigin);
  };

  if (await backingOff(deps)) {
    log('backoff');
    return staleOr('upstream', 503);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (!(await allow(deps, env, `ip:${ip}`)) || !(await allow(deps, env, 'global'))) {
    return staleOr('rate_limited', 429);
  }

  log('miss');
  let upstream: Response;
  try {
    upstream = await deps.fetch(yahooChartUrl(mapped.yahoo, '5y'), {
      headers: {
        Accept: 'application/json',
        'User-Agent': RELAY_USER_AGENT,
      },
    });
  } catch {
    return staleOr('upstream', 503);
  }

  if (upstream.status === 404) {
    store(ctx, deps.cache, cacheKey, json({ error: 'not_found' }, 404, `public, max-age=${DAY_SECONDS}`, null));
    return json({ error: 'not_found' }, 404, fresh(), allowOrigin);
  }
  if (upstream.status === 429 || upstream.status >= 500) {
    startBackoff(ctx, deps, upstream.headers.get('Retry-After'));
    return staleOr('upstream', 503);
  }
  const contentType = upstream.headers.get('Content-Type') ?? '';
  if (!upstream.ok || !contentType.toLowerCase().includes('json')) {
    return staleOr('upstream', 503);
  }

  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    return staleOr('upstream', 503);
  }
  if (!body || typeof body !== 'object' || !('chart' in body)) return staleOr('upstream', 503);
  let payload: ChartPayload;
  try {
    payload = toChartPayload(parseYahooChart(body, sessionDate));
  } catch (error) {
    if (!(error instanceof ParseError)) return staleOr('upstream', 503);
    // A Yahoo chart with an error or no usable prices: this symbol has no film today.
    const maxAge = cacheMaxAgeSeconds(mapped.market, deps.now());
    store(ctx, deps.cache, cacheKey, json({ error: 'not_found' }, 404, `public, max-age=${maxAge}`, null));
    return json({ error: 'not_found' }, 404, fresh(), allowOrigin);
  }

  const fetchedAtMs = deps.now().getTime();
  const maxAge = cacheMaxAgeSeconds(mapped.market, deps.now());
  store(ctx, deps.cache, cacheKey, entryResponse(payload, fetchedAtMs, maxAge));
  store(ctx, deps.cache, lastKey, entryResponse(payload, fetchedAtMs, LAST_GOOD_SECONDS));
  return json(windowChart(payload, range, fetchedAtMs), 200, fresh(), allowOrigin);
}

/** Missing `range` is 5y. A present value must be one allowlisted spelling. */
function requestedRange(url: URL): LookbackRange | null {
  const values = url.searchParams.getAll('range');
  if (values.length === 0) return DEFAULT_LOOKBACK_RANGE;
  if (values.length > 1) return null;
  const value = values[0] ?? '';
  return isLookbackRange(value) ? value : null;
}

/** Cache API entry. `public` here only lets the Cache API keep it; it is never sent to a browser. */
function entryResponse(payload: ChartPayload, fetchedAtMs: number, maxAgeSeconds: number): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAgeSeconds}`,
      [FETCHED_AT]: String(fetchedAtMs),
    },
  });
}

async function readEntry(response: Response): Promise<Entry | null> {
  if (response.status !== 200) return null;
  const fetchedAtMs = Number(response.headers.get(FETCHED_AT));
  if (!Number.isFinite(fetchedAtMs) || fetchedAtMs <= 0) return null;
  try {
    const payload = (await response.json()) as ChartPayload;
    if (!payload || !Array.isArray(payload.dates) || !Array.isArray(payload.closes)) return null;
    return { payload, fetchedAtMs };
  } catch {
    return null;
  }
}

async function backingOff(deps: HandlerDeps): Promise<boolean> {
  const marker = await deps.cache.match(new Request(BACKOFF_CACHE_KEY));
  if (!marker) return false;
  const until = Number(await marker.text());
  return Number.isFinite(until) && deps.now().getTime() < until;
}

/** One pause per failure; the relay never retries Yahoo in a loop. */
function startBackoff(ctx: WaitUntil, deps: HandlerDeps, retryAfter: string | null): void {
  const asked = Number(retryAfter);
  const seconds = Number.isFinite(asked) && asked > 0 ? Math.min(Math.max(asked, BACKOFF_SECONDS), BACKOFF_MAX_SECONDS) : BACKOFF_SECONDS;
  const until = deps.now().getTime() + seconds * 1000;
  store(
    ctx,
    deps.cache,
    new Request(BACKOFF_CACHE_KEY),
    new Response(String(until), { headers: { 'Cache-Control': `public, max-age=${seconds}` } }),
  );
}

function store(ctx: WaitUntil, cache: ResponseCache, key: Request, response: Response): void {
  ctx.waitUntil(
    cache.put(key, response).catch(() => {
      /* a cache write must not fail the response */
    }),
  );
}

async function allow(deps: HandlerDeps, env: Env, key: string): Promise<boolean> {
  if (deps.limit) return deps.limit(key);
  if (env.RATE_LIMITER) {
    const result = await env.RATE_LIMITER.limit({ key });
    return result.success;
  }
  return memoryLimiter.allow(key, deps.now().getTime());
}

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * True only for the app's own page (or a dev origin in ALLOWED_ORIGIN).
 * Browsers send `Origin` on cross-origin and non-GET requests and
 * `Sec-Fetch-Site` on every fetch, but a same-origin GET may carry no
 * `Origin`. A `Referer` that is present must match too. A request with
 * none of these, such as a bare script, is refused.
 */
function fromOwnPage(request: Request, pageOrigin: string, allowed: string[]): boolean {
  const origin = request.headers.get('Origin');
  if (origin && !originAllowed(origin, pageOrigin, allowed)) return false;
  const referer = request.headers.get('Referer');
  if (referer) {
    let refererOrigin: string;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      return false;
    }
    if (!originAllowed(refererOrigin, pageOrigin, allowed)) return false;
  }
  const site = request.headers.get('Sec-Fetch-Site');
  if (site === 'same-origin') return true;
  if (site === 'same-site' || site === 'cross-site') return Boolean(origin);
  if (site) return false;
  return Boolean(origin || referer);
}

function originAllowed(requestOrigin: string, pageOrigin: string, allowed: string[]): boolean {
  return requestOrigin === pageOrigin || allowed.includes(requestOrigin);
}

function originHeader(requestOrigin: string | null, pageOrigin: string, allowed: string[]): string | null {
  if (requestOrigin && originAllowed(requestOrigin, pageOrigin, allowed)) return requestOrigin;
  return null;
}

function withCors(response: Response, allowOrigin: string | null): Response {
  response.headers.set('Vary', 'Origin');
  if (allowOrigin) {
    response.headers.set('Access-Control-Allow-Origin', allowOrigin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  }
  return response;
}

function json(body: unknown, status: number, cacheControl: string, allowOrigin: string | null): Response {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    },
  });
  return withCors(response, allowOrigin);
}
