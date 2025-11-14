/**
 * Tile Route Handler
 * GET /pamphlet/:id/page/:page/tile/:x/:y
 */

import { Context } from 'hono';
import type { Env, Variables } from '../types/bindings';
import * as kvService from '../services/kv';
import * as r2Service from '../services/r2';
import { getTileCacheKey, getTileFromCache, putTileIntoCache, getTileCacheHeaders } from '../services/cache';

/**
 * Get tile image
 * @param c Hono context
 * @returns Response with tile image (WebP)
 */
export async function getTile(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const pamphletId = c.req.param('id');
  const pageStr = c.req.param('page');
  const xStr = c.req.param('x');
  const yStr = c.req.param('y');

  // Validate parameters
  if (!pamphletId || !pageStr || !xStr || !yStr) {
    return c.json({ error: 'Missing required parameters' }, 400);
  }

  const page = parseInt(pageStr, 10);
  const x = parseInt(xStr, 10);
  const y = parseInt(yStr, 10);

  if (isNaN(page) || isNaN(x) || isNaN(y)) {
    return c.json({ error: 'Invalid parameters' }, 400);
  }

  try {
    // Get metadata to retrieve version number
    const metadata = await kvService.getMetadata(c.env, pamphletId);
    if (!metadata) {
      return c.json({ error: 'Pamphlet not found' }, 404);
    }

    // Generate cache key with version
    const cacheKey = getTileCacheKey(pamphletId, page, x, y, metadata.version);

    // Check Cache API
    const cachedResponse = await getTileFromCache(cacheKey);
    if (cachedResponse) {
      console.log(`Cache HIT: ${cacheKey}`);
      return cachedResponse;
    }

    console.log(`Cache MISS: ${cacheKey}`);

    // Get tile from R2
    const tileObject = await r2Service.getTile(c.env, pamphletId, page, x, y);
    if (!tileObject) {
      return c.json({ error: 'Tile not found' }, 404);
    }

    // Create response with cache headers
    const response = new Response(tileObject.body, {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        ...getTileCacheHeaders(),
      },
    });

    // Put into Cache API (non-blocking)
    c.executionCtx.waitUntil(putTileIntoCache(cacheKey, response.clone()));

    return response;
  } catch (error) {
    console.error('Error fetching tile:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}
