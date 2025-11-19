/**
 * Pamphlet Router
 * Handles all /pamphlet/* routes
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, Variables } from '../types/bindings';
import * as r2Service from '../services/r2';
import { deleteFromCache } from '../services/cache';
import { loadMetadata } from '../middleware/metadata';
import { createCacheMiddleware } from '../middleware/cache';

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

	if (start < 0 || end < start || end - start > 100) {
		return null;
	}

	return { start, end };
}

const pamphlet = new Hono<{ Bindings: Env; Variables: Variables }>()
	/**
	 * GET /:id/metadata?pages=0-5
	 */
	.get(
		'/:id/metadata',
		zValidator(
			'query',
			z.object({
				pages: z
					.string()
					.regex(/^(\d+)-(\d+)$/)
					.optional(),
			}),
			(result, c) => {
				if (!result.success) {
					return c.json({ error: 'Invalid page range format. Use: pages=0-5' }, 400);
				}
			}
		),
		loadMetadata,
		async (c) => {
		const metadata = c.get('metadata');

		if (!metadata) {
			return c.json({ error: 'Metadata not found' }, 404);
		}

		const { pages: pagesParam } = c.req.valid('query');
		const pageRange = parsePageRange(pagesParam ?? null);

		if (!pageRange) {
			return c.json({ error: 'Invalid page range format. Use: pages=0-5' }, 400);
		}

		const totalPages = metadata.pages.length;
		const filteredPages = metadata.pages.filter((page) => page.page >= pageRange.start && page.page <= pageRange.end);

		return c.json({
			version: metadata.version,
			tile_size: metadata.tile_size,
			pages: filteredPages,
			total_pages: totalPages,
			has_more: pageRange.end < totalPages - 1,
			has_previous: pageRange.start > 0,
		});
	}
	)
	/**
	 * GET /:id/tile/:hash
	 */
	.get('/:id/tile/:hash', tileCache, async (c) => {
		const pamphletId = c.req.param('id');
		const hash = c.req.param('hash');

		if (!pamphletId || !hash) {
			return c.json({ error: 'Missing required parameters' }, 400);
		}

		if (!/^[a-f0-9]{64}$/i.test(hash)) {
			return c.json({ error: 'Invalid hash format' }, 400);
		}

		try {
			const tileObject = await r2Service.getTile(c.env, pamphletId, hash);
			if (!tileObject) {
				return c.json({ error: 'Tile not found' }, 404);
			}

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
	})
	/**
	 * POST /:id/invalidate
	 */
	.post('/:id/invalidate', async (c) => {
		const pamphletId = c.req.param('id');

		if (!pamphletId) {
			return c.json({ error: 'Missing pamphlet ID' }, 400);
		}

		try {
			const metadataUrl = new URL(c.req.url);
			metadataUrl.pathname = `/pamphlet/${pamphletId}/metadata`;

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
