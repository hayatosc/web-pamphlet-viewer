/**
 * Pamphlet Router
 * Handles all /pamphlet/* routes
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/bindings';
import * as r2Service from '../services/r2';
import { getMetadataCacheHeaders, getTileCacheHeaders, deleteFromCache } from '../services/cache';
import { loadMetadata } from '../middleware/metadata';
import { createCacheMiddleware } from '../middleware/cache';

const pamphlet = new Hono<{ Bindings: Env; Variables: Variables }>();

// Create cache middleware instances
const metadataCache = createCacheMiddleware(getMetadataCacheHeaders);
const tileCache = createCacheMiddleware(getTileCacheHeaders);

/**
 * GET /:id/metadata
 * Get pamphlet metadata with Cache API integration
 * Public access - no authentication required
 *
 * Middleware stack:
 * - metadataCache: Checks cache and stores response using c.req.url as key
 * - loadMetadata: Loads pamphlet metadata from R2 (only on cache miss)
 */
pamphlet.get('/:id/metadata', metadataCache, loadMetadata, async (c) => {
  // Get metadata from context (loaded by loadMetadata middleware)
  const metadata = c.get('metadata');

  // Return metadata (cache headers added automatically by cache middleware)
  return c.json(metadata);
});

/**
 * GET /:id/tile/:hash
 * Get tile image with Cache API integration (hash-based)
 * Public access - no authentication required
 *
 * Middleware stack:
 * - tileCache: Checks cache and stores response using c.req.url as key
 */
pamphlet.get('/:id/tile/:hash', tileCache, async (c) => {
  const pamphletId = c.req.param('id');
  const hash = c.req.param('hash');

  // Validate parameters
  if (!pamphletId || !hash) {
    return c.json({ error: 'Missing required parameters' }, 400);
  }

  // Validate hash format (SHA256 = 64 hex characters)
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    return c.json({ error: 'Invalid hash format' }, 400);
  }

  try {
    // Get tile from R2
    const tileObject = await r2Service.getTile(c.env, pamphletId, hash);
    if (!tileObject) {
      return c.json({ error: 'Tile not found' }, 404);
    }

    // Return response (cache headers added automatically by cache middleware)
    return new Response(tileObject.body, {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
      },
    });
  } catch (error) {
    console.error('Error fetching tile:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * POST /:id/invalidate
 * Clear cache for a specific pamphlet
 * Admin endpoint - should be protected by additional authentication in production
 * (e.g., Cloudflare Access, API key, etc.)
 *
 * Note: This only clears the metadata cache. Tile caches will expire naturally via TTL.
 * For immediate tile cache invalidation, you would need to delete each tile cache entry,
 * which can be expensive for pamphlets with many tiles.
 */
pamphlet.post('/:id/invalidate', async (c) => {
  const pamphletId = c.req.param('id');

  if (!pamphletId) {
    return c.json({ error: 'Missing pamphlet ID' }, 400);
  }

  try {
    // Construct the metadata URL
    const metadataUrl = new URL(c.req.url);
    metadataUrl.pathname = `/pamphlet/${pamphletId}/metadata`;

    // Delete metadata from cache
    const deleted = await deleteFromCache(metadataUrl.toString());

    return c.json({
      id: pamphletId,
      status: 'ok',
      message: 'Metadata cache cleared successfully',
      deleted,
    });
  } catch (error) {
    console.error('Error invalidating cache:', error);
    return c.json({ error: 'Internal server error', message: String(error) }, 500);
  }
});

export default pamphlet;
