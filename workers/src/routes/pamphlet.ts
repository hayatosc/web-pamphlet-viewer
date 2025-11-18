/**
 * Pamphlet Router
 * Handles all /pamphlet/* routes
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/bindings';
import * as r2Service from '../services/r2';
import { deleteFromCache } from '../services/cache';
import { loadMetadata } from '../middleware/metadata';
import { createCacheMiddleware } from '../middleware/cache';

const pamphlet = new Hono<{ Bindings: Env; Variables: Variables }>();

// Create cache middleware for tiles
const tileCache = createCacheMiddleware(() => ({
	'Cache-Control': 'public, max-age=86400, s-maxage=2592000',
	'CDN-Cache-Control': 'max-age=2592000',
}));

/**
 * Parse page range from query parameter
 * Format: "0-5" or "10-19"
 * Default: "0-5" if not specified
 *
 * @param rangeParam - Query parameter value (e.g., "0-5")
 * @returns { start, end } or null if invalid
 */
function parsePageRange(rangeParam: string | null): { start: number; end: number } | null {
	const DEFAULT_RANGE = { start: 0, end: 5 };

	if (!rangeParam) {
		return DEFAULT_RANGE;
	}

	const match = rangeParam.match(/^(\d+)-(\d+)$/);
	if (!match) {
		return null;
	}

	const start = parseInt(match[1], 10);
	const end = parseInt(match[2], 10);

	// Validation
	if (start < 0 || end < start || end - start > 100) {
		return null;
	}

	return { start, end };
}

/**
 * GET /:id/metadata?pages=0-5
 * Get pamphlet metadata with Cache API integration
 * Public access - no authentication required
 *
 * Query parameters:
 * - pages: Page range to fetch (e.g., "0-5", "10-19"). Default: "0-5"
 *
 * Middleware stack:
 * - loadMetadata: Loads metadata from cache or R2
 *
 * Response includes pagination info:
 * - total_pages: Total number of pages in the pamphlet
 * - has_more: Whether there are more pages after the current range
 * - has_previous: Whether there are pages before the current range
 */
pamphlet.get('/:id/metadata', loadMetadata, async (c) => {
	// Get metadata from context (loaded by loadMetadata middleware)
	const metadata = c.get('metadata');

	if (!metadata) {
		return c.json({ error: 'Metadata not found' }, 404);
	}

	// Parse page range from query parameter
	const pagesParam = c.req.query('pages');
	const pageRange = parsePageRange(pagesParam ?? null);

	if (!pageRange) {
		return c.json({ error: 'Invalid page range format. Use: pages=0-5' }, 400);
	}

	// Calculate total pages
	const totalPages = metadata.pages.length;

	// Filter pages based on range
	const filteredPages = metadata.pages.filter((page) => page.page >= pageRange.start && page.page <= pageRange.end);

	// Return filtered metadata with pagination info
	return c.json({
		version: metadata.version,
		tile_size: metadata.tile_size,
		pages: filteredPages,
		total_pages: totalPages,
		has_more: pageRange.end < totalPages - 1,
		has_previous: pageRange.start > 0,
	});
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
