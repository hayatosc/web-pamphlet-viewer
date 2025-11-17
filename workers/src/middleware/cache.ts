/**
 * Cache Middleware
 * Simple unified cache middleware using request URL as cache key
 */

import { createMiddleware } from 'hono/factory';
import type { Env, Variables } from '../types/bindings';
import { getFromCache, putIntoCache } from '../services/cache';

/**
 * Create a cache middleware with custom cache headers
 * @param getCacheHeaders Function that returns cache headers for the response
 */
export function createCacheMiddleware(getCacheHeaders: () => HeadersInit) {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const cacheKey = c.req.url;

    // Check Cache API
    const cachedResponse = await getFromCache(cacheKey);
    if (cachedResponse) {
      console.log(`Cache HIT: ${cacheKey}`);
      return cachedResponse;
    }

    console.log(`Cache MISS: ${cacheKey}`);

    // Execute handler to get response
    await next();

    // After handler execution, add cache headers and cache the response if successful
    const response = c.res;
    if (response && response.status === 200) {
      // Add cache headers
      const headers = getCacheHeaders();
      Object.entries(headers).forEach(([key, value]) => {
        response.headers.set(key, value as string);
      });

      // Store in cache asynchronously (non-blocking)
      c.executionCtx.waitUntil(putIntoCache(cacheKey, response.clone()));
    }
  });
}
