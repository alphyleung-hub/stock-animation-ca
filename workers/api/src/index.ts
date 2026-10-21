import { handleChartRequest, type Env } from './handler';

export type { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleChartRequest(request, env, ctx, {
      fetch: globalThis.fetch.bind(globalThis),
      cache: await caches.open('stock-animation-chart'),
      now: () => new Date(),
      log: (line) => console.log(line),
    });
  },
};
