/**
 * Pamphlet Router
 * Handles all /pamphlet/* routes
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/bindings';
import type { Metadata } from 'shared/types/wasm';
import * as r2Service from '../services/r2';
import {
  getTileCacheKey,
  getTileFromCache,
  putTileIntoCache,
  getTileCacheHeaders,
  getMetadataCacheHeaders
} from '../services/cache';

const pamphlet = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /:id/metadata
 * Get pamphlet metadata from R2
 */
pamphlet.get('/:id/metadata', async (c) => {
  const pamphletId = c.req.param('id');

  if (!pamphletId) {
    return c.json({ error: 'Missing pamphlet ID' }, 400);
  }

  try {
    // Get metadata from R2
    const metadata = await r2Service.getMetadata(c.env, pamphletId) as Metadata | null;

    if (!metadata) {
      return c.json({ error: 'Pamphlet not found' }, 404);
    }

    // Return metadata with cache headers
    const headers = getMetadataCacheHeaders();
    return c.json(metadata, 200, headers as Record<string, string>);
  } catch (error) {
    console.error('Error fetching metadata:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /:id/page/:page/tile/:x/:y
 * Get tile image with Cache API integration
 */
pamphlet.get('/:id/page/:page/tile/:x/:y', async (c) => {
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
    // Get metadata from R2 to retrieve version number
    const metadata = await r2Service.getMetadata(c.env, pamphletId) as Metadata | null;
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
});

/**
 * POST /:id/invalidate
 * Invalidate pamphlet cache by updating version in R2
 */
pamphlet.post('/:id/invalidate', async (c) => {
  const pamphletId = c.req.param('id');

  if (!pamphletId) {
    return c.json({ error: 'Missing pamphlet ID' }, 400);
  }

  try {
    // Get metadata from R2
    const metadata = await r2Service.getMetadata(c.env, pamphletId) as Metadata | null;
    if (!metadata) {
      return c.json({ error: 'Pamphlet not found' }, 404);
    }

    // Update version (this will invalidate cache)
    const newVersion = Date.now();
    metadata.version = newVersion;

    // Save updated metadata to R2
    await r2Service.putMetadata(c.env, pamphletId, metadata);

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
