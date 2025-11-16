/**
 * Cache Middleware
 * Handles Cache API integration for tile and metadata responses
 */

import { createMiddleware } from 'hono/factory';
import type { Env, Variables } from '../types/bindings';
import {
  getTileCacheKey,
  getTileFromCache,
  putTileIntoCache,
  getMetadataCacheKey,
  getMetadataFromCache,
  putMetadataIntoCache,
  deleteMetadataFromCache,
  getMetadataCacheHeaders,
  getTileCacheHeaders,
} from '../services/cache';

/**
 * Metadata cache middleware
 * Checks Cache API before loading metadata from R2
 * Automatically adds Cache-Control headers to responses
 *
 * Prerequisites:
 * - pamphletId must be in route params as 'id'
 *
 * Usage:
 * ```
 * pamphlet.get('/:id/metadata',
 *   metadataCache,
 *   loadMetadata,  // Only called on cache miss
 *   async (c) => {
 *     const metadata = c.get('metadata');
 *     return c.json(metadata);
 *   }
 * );
 * ```
 */
export const metadataCache = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const pamphletId = c.req.param('id');

    if (!pamphletId) {
      await next();
      return;
    }

    // Generate cache key
    const cacheKey = getMetadataCacheKey(pamphletId);

    // Check Cache API
    const cachedResponse = await getMetadataFromCache(cacheKey);
    if (cachedResponse) {
      console.log(`Metadata cache HIT: ${cacheKey}`);
      return cachedResponse;
    }

    console.log(`Metadata cache MISS: ${cacheKey}`);

    // Execute handler to get response (loadMetadata + handler)
    await next();

    // After handler execution, add cache headers and cache the response if it's successful
    const response = c.res;
    if (response && response.status === 200) {
      // Add cache headers
      const headers = getMetadataCacheHeaders();
      Object.entries(headers).forEach(([key, value]) => {
        response.headers.set(key, value as string);
      });

      // Store in cache asynchronously (non-blocking)
      c.executionCtx.waitUntil(putMetadataIntoCache(cacheKey, response.clone()));
    }
  }
);

/**
 * Tile cache middleware
 * Checks Cache API before handler execution and stores response after
 * Automatically adds Cache-Control headers to responses
 *
 * Prerequisites:
 * - pamphletId must be in route params as 'id'
 * - hash must be in route params as 'hash'
 * - metadata must be loaded in context variables (use loadMetadata middleware first)
 *
 * Usage:
 * ```
 * pamphlet.get('/:id/tile/:hash',
 *   loadMetadata,
 *   tileCache,
 *   async (c) => {
 *     // Handler returns response (cache headers added automatically)
 *     const tile = await getTile(...);
 *     return new Response(tile.body, {
 *       headers: { 'Content-Type': 'image/webp' }
 *     });
 *   }
 * );
 * ```
 */
export const tileCache = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const pamphletId = c.req.param('id');
    const hash = c.req.param('hash');
    const metadata = c.get('metadata');

    if (!pamphletId || !hash || !metadata) {
      // Skip cache if required data is missing
      await next();
      return;
    }

    // Generate cache key with version
    const cacheKey = getTileCacheKey(pamphletId, hash, metadata.version);

    // Check Cache API
    const cachedResponse = await getTileFromCache(cacheKey);
    if (cachedResponse) {
      console.log(`Cache HIT: ${cacheKey}`);
      return cachedResponse;
    }

    console.log(`Cache MISS: ${cacheKey}`);

    // Execute handler to get response
    await next();

    // After handler execution, add cache headers and cache the response if it's successful
    const response = c.res;
    if (response && response.status === 200) {
      // Add cache headers
      const headers = getTileCacheHeaders();
      Object.entries(headers).forEach(([key, value]) => {
        response.headers.set(key, value as string);
      });

      // Store in cache asynchronously (non-blocking)
      c.executionCtx.waitUntil(putTileIntoCache(cacheKey, response.clone()));
    }
  }
);

/**
 * Clear metadata cache
 * Utility function to delete metadata from cache
 */
export async function clearMetadataCache(pamphletId: string): Promise<void> {
  const cacheKey = getMetadataCacheKey(pamphletId);
  await deleteMetadataFromCache(cacheKey);
  console.log(`Metadata cache cleared: ${cacheKey}`);
}
