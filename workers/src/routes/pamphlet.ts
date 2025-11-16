/**
 * Pamphlet Router
 * Handles all /pamphlet/* routes
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/bindings';
import * as r2Service from '../services/r2';
import { loadMetadata } from '../middleware/metadata';
import { metadataCache, tileCache, clearMetadataCache } from '../middleware/cache';

const pamphlet = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /:id/metadata
 * Get pamphlet metadata with Cache API integration
 * Public access - no authentication required
 *
 * Middleware stack:
 * - metadataCache: Checks cache and stores response
 * - loadMetadata: Loads pamphlet metadata from R2 (only on cache miss)
 */
pamphlet.get('/:id/metadata', metadataCache, loadMetadata, async (c) => {
  // Get metadata from context (loaded by loadMetadata middleware)
  const metadata = c.get('metadata');

  // Return metadata (cache headers added automatically by metadataCache middleware)
  return c.json(metadata);
});

/**
 * GET /:id/tile/:hash
 * Get tile image with Cache API integration (hash-based)
 * Public access - no authentication required
 *
 * Middleware stack:
 * - loadMetadata: Loads pamphlet metadata into context
 * - tileCache: Checks cache and stores response
 */
pamphlet.get('/:id/tile/:hash', loadMetadata, tileCache, async (c) => {
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

    // Return response (cache headers added automatically by tileCache middleware)
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
 * Invalidate pamphlet cache by updating version and clearing metadata cache
 * Admin endpoint - should be protected by additional authentication in production
 * (e.g., Cloudflare Access, API key, etc.)
 *
 * Middleware stack:
 * - loadMetadata: Loads pamphlet metadata into context
 */
pamphlet.post('/:id/invalidate', loadMetadata, async (c) => {
  const pamphletId = c.req.param('id');

  if (!pamphletId) {
    return c.json({ error: 'Missing pamphlet ID' }, 400);
  }

  try {
    // Get metadata from context (loaded by loadMetadata middleware)
    const metadata = c.get('metadata');

    if (!metadata) {
      return c.json({ error: 'Pamphlet not found' }, 404);
    }

    // Update version (this will invalidate tile cache via new cache keys)
    const newVersion = Date.now();
    metadata.version = newVersion;

    // Save updated metadata to R2
    await r2Service.putMetadata(c.env, pamphletId, metadata);

    // Clear metadata cache explicitly (non-blocking)
    c.executionCtx.waitUntil(clearMetadataCache(pamphletId));

    return c.json({
      id: pamphletId,
      version: newVersion,
      status: 'ok',
      message: 'Cache invalidated successfully',
    });
  } catch (error) {
    console.error('Error invalidating cache:', error);
    return c.json({ error: 'Internal server error', message: String(error) }, 500);
  }
});

export default pamphlet;
