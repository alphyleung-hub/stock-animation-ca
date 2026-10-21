import { createRateLimiter } from '../../../shared/rate-limit';
import { cacheMaxAgeSeconds, isAcceptableSessionDate } from '../../../shared/session';
import { mapRelaySymbol } from '../../../shared/symbols';
import {
  BROWSER_USER_AGENT,
  chartCacheKey,
  DEFAULT_LOOKBACK_RANGE,
  isLookbackRange,
  yahooChartUrl,
  type LookbackRange,
} from '../../../shared/yahoo';

const DAY_SECONDS = 86_400;
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
}

/**
 * Thin Yahoo pass-through. The body is streamed and never parsed.
 * One shared entry per Yahoo symbol, session date `d`, and lookback range.
 * A hit returns that entry and does not call Yahoo. The edge cache in
 * wrangler.toml uses the request URL, so `d` and `range` stay apart there too.
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

  if (!requestOriginAllowed(origin, pageOrigin, allowed)) {
    return json({ error: 'origin_not_allowed' }, 403, 'no-store', null);
  }
  if (request.method === 'OPTIONS') {
    return cors(new Response(null, { status: 204 }), origin, pageOrigin, allowed, 'no-store');
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method_not_allowed' }, 405, 'no-store', originHeader(origin, pageOrigin, allowed));
  }

  const match = url.pathname.match(/^\/v1\/chart\/([^/]+)$/);
  if (!match?.[1]) return json({ error: 'not_found' }, 404, 'no-store', originHeader(origin, pageOrigin, allowed));

  let rawSymbol: string;
  try {
    rawSymbol = decodeURIComponent(match[1]);
  } catch {
    return json({ error: 'invalid_symbol' }, 400, 'no-store', originHeader(origin, pageOrigin, allowed));
  }
  const mapped = mapRelaySymbol(rawSymbol);
  if (!mapped) return json({ error: 'invalid_symbol' }, 400, 'no-store', originHeader(origin, pageOrigin, allowed));

  const unexpected = [...url.searchParams.keys()].filter((key) => key !== 'd' && key !== 'range');
  if (unexpected.length > 0 || !url.searchParams.has('d')) {
    return json({ error: 'invalid_session' }, 400, 'no-store', originHeader(origin, pageOrigin, allowed));
  }
  const range = requestedRange(url);
  if (!range) {
    return json({ error: 'invalid_session' }, 400, 'no-store', originHeader(origin, pageOrigin, allowed));
  }
  const sessionDate = url.searchParams.get('d') ?? '';
  if (!isAcceptableSessionDate(mapped.market, sessionDate, deps.now())) {
    return json({ error: 'invalid_session' }, 400, 'no-store', originHeader(origin, pageOrigin, allowed));
  }

  const cacheKey = new Request(chartCacheKey(mapped.yahoo, sessionDate, range));
  const cached = await deps.cache.match(cacheKey);
  if (cached) return cors(cached, origin, pageOrigin, allowed, null);

  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (!(await allow(deps, env, `ip:${ip}`)) || !(await allow(deps, env, 'global'))) {
    return json({ error: 'rate_limited' }, 429, 'no-store', originHeader(origin, pageOrigin, allowed));
  }

  let upstream: Response;
  try {
    upstream = await deps.fetch(yahooChartUrl(mapped.yahoo, range), {
      headers: {
        Accept: 'application/json',
        'User-Agent': BROWSER_USER_AGENT,
      },
    });
  } catch {
    return json({ error: 'upstream' }, 503, 'no-store', originHeader(origin, pageOrigin, allowed));
  }

  if (upstream.status === 404) {
    const response = passthrough(upstream, 404, `public, max-age=${DAY_SECONDS}`);
    store(ctx, deps.cache, cacheKey, response);
    return cors(response, origin, pageOrigin, allowed, null);
  }
  if (!upstream.ok) {
    return json({ error: 'upstream' }, 503, 'no-store', originHeader(origin, pageOrigin, allowed));
  }
  const contentType = upstream.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes('json')) {
    return json({ error: 'upstream' }, 503, 'no-store', originHeader(origin, pageOrigin, allowed));
  }

  const maxAge = cacheMaxAgeSeconds(mapped.market, deps.now());
  const response = passthrough(upstream, 200, `public, max-age=${maxAge}`);
  store(ctx, deps.cache, cacheKey, response);
  return cors(response, origin, pageOrigin, allowed, null);
}

/** Missing `range` is 5y. A present value must be one allowlisted spelling. */
function requestedRange(url: URL): LookbackRange | null {
  const values = url.searchParams.getAll('range');
  if (values.length === 0) return DEFAULT_LOOKBACK_RANGE;
  if (values.length > 1) return null;
  const value = values[0] ?? '';
  return isLookbackRange(value) ? value : null;
}

function passthrough(upstream: Response, status: number, cacheControl: string): Response {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', cacheControl);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(upstream.body, { status, headers });
}

function store(ctx: WaitUntil, cache: ResponseCache, key: Request, response: Response): void {
  const copy = response.clone();
  ctx.waitUntil(
    cache.put(key, copy).catch(() => {
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

function requestOriginAllowed(requestOrigin: string | null, pageOrigin: string, allowed: string[]): boolean {
  if (!requestOrigin || requestOrigin === pageOrigin) return true;
  return allowed.includes(requestOrigin);
}

function originHeader(requestOrigin: string | null, pageOrigin: string, allowed: string[]): string | null {
  if (requestOrigin && requestOriginAllowed(requestOrigin, pageOrigin, allowed)) return requestOrigin;
  return allowed[0] ?? null;
}

function cors(response: Response, requestOrigin: string | null, pageOrigin: string, allowed: string[], cacheControl: string | null): Response {
  const headers = new Headers(response.headers);
  const allow = originHeader(requestOrigin, pageOrigin, allowed);
  if (allow) headers.set('Access-Control-Allow-Origin', allow);
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  if (cacheControl) headers.set('Cache-Control', cacheControl);
  return new Response(response.body, { status: response.status, headers });
}

function json(body: unknown, status: number, cacheControl: string, allowOrigin: string | null): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  });
  if (allowOrigin) headers.set('Access-Control-Allow-Origin', allowOrigin);
  return new Response(JSON.stringify(body), { status, headers });
}
