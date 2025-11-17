/**
 * Metadata Middleware
 * Loads pamphlet metadata with caching and stores in context variables
 */

import { createMiddleware } from 'hono/factory';
import type { Env, Variables } from '../types/bindings';
import type { Metadata } from 'shared/types/wasm';
import * as r2Service from '../services/r2';
import { getFromCache, putIntoCache } from '../services/cache';

/**
 * Load metadata middleware
 * Fetches metadata from cache or R2 and stores in context variables
 * Also caches the response for future requests
 *
 * Prerequisites:
 * - pamphletId must be in route params as 'id'
 *
 * Sets context variable:
 * - c.set('metadata', metadata)
 *
 * Returns 404 if pamphlet not found
 */
export const loadMetadata = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const pamphletId = c.req.param('id');

    if (!pamphletId) {
      return c.json({ error: 'Missing pamphlet ID' }, 400);
    }

    // Construct metadata URL for cache key
    const metadataUrl = new URL(c.req.url);
    metadataUrl.pathname = `/pamphlet/${pamphletId}/metadata`;
    const cacheKey = metadataUrl.toString();

    try {
      // Check cache first
      const cachedResponse = await getFromCache(cacheKey);
      if (cachedResponse) {
        console.log(`Metadata cache HIT: ${cacheKey}`);
        const metadata = (await cachedResponse.json()) as Metadata;
        c.set('metadata', metadata);
        await next();
        return;
      }

      console.log(`Metadata cache MISS: ${cacheKey}`);

      // Get metadata from R2
      const metadata = (await r2Service.getMetadata(c.env, pamphletId)) as Metadata | null;

      if (!metadata) {
        return c.json({ error: 'Pamphlet not found' }, 404);
      }

      // Store metadata in context variables for downstream handlers
      c.set('metadata', metadata);

      // Continue to next handler
      await next();

      // Cache the response if successful
      const response = c.res;
      if (response && response.status === 200) {
        // Add cache headers
        response.headers.set('Cache-Control', 'private, max-age=60');

        // Store in cache asynchronously
        c.executionCtx.waitUntil(putIntoCache(cacheKey, response.clone()));
      }
    } catch (error) {
      console.error('Error loading metadata:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  }
);
