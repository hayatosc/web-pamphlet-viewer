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
import { requireToken } from '../middleware/auth';
import { generateToken } from '../services/token';

const pamphlet = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /:id/metadata
 * Get pamphlet metadata from R2
 * Requires token authentication
 */
pamphlet.get('/:id/metadata', requireToken, async (c) => {
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
 * GET /:id/tile/:hash
 * Get tile image with Cache API integration (hash-based)
 * Requires token authentication
 */
pamphlet.get('/:id/tile/:hash', requireToken, async (c) => {
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
    // Get metadata from R2 to retrieve version number
    const metadata = await r2Service.getMetadata(c.env, pamphletId) as Metadata | null;
    if (!metadata) {
      return c.json({ error: 'Pamphlet not found' }, 404);
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

    // Get tile from R2
    const tileObject = await r2Service.getTile(c.env, pamphletId, hash);
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
 * Requires token authentication
 */
pamphlet.post('/:id/invalidate', requireToken, async (c) => {
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

/**
 * POST /:id/generate-token
 * Generate signed token for pamphlet access
 * This endpoint should be protected by additional authentication in production
 * (e.g., API key, admin auth)
 */
pamphlet.post('/:id/generate-token', async (c) => {
  const pamphletId = c.req.param('id');

  if (!pamphletId) {
    return c.json({ error: 'Missing pamphlet ID' }, 400);
  }

  // Optional: Get expiresIn from request body
  let expiresIn = 3600; // Default: 1 hour
  try {
    const body = await c.req.json().catch(() => ({}));
    if (body.expiresIn && typeof body.expiresIn === 'number') {
      expiresIn = body.expiresIn;
    }
  } catch {
    // Use default
  }

  try {
    // Verify pamphlet exists
    const metadata = await r2Service.getMetadata(c.env, pamphletId) as Metadata | null;
    if (!metadata) {
      return c.json({ error: 'Pamphlet not found' }, 404);
    }

    // Generate token
    const token = await generateToken(c.env, pamphletId, expiresIn);

    return c.json({
      pamphletId,
      token,
      expiresIn,
      expiresAt: Date.now() + expiresIn * 1000,
    });
  } catch (error) {
    console.error('Error generating token:', error);
    return c.json({ error: 'Internal server error', message: String(error) }, 500);
  }
});

export default pamphlet;
