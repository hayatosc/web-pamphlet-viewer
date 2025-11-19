import { Hono } from 'hono';
import { Script, ViteClient } from 'vite-ssr-components/hono';
import { deleteFromCache } from '../services/cache';
import * as r2Service from '../services/r2';
import type { Env, Variables } from '../types/bindings';
import upload from './upload';

const admin = new Hono<{ Bindings: Env; Variables: Variables }>()
	.get('/', (c) => {
		return c.html(
			<html lang="ja">
				<head>
					<meta charset="UTF-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1.0" />
					<title>パンフレットアップローダー</title>
					<Script type="module" src="/src/client/index.tsx" />
					<ViteClient />
				</head>
				<body>
					<div id="root"></div>
				</body>
			</html>
		);
	})
	.route('/upload', upload)
	/**
	 * DELETE /admin/delete/:id
	 * Delete pamphlet data (R2) and metadata cache
	 * Tile caches are not deleted (30-day TTL expiry)
	 */
	.delete('/delete/:id', async (c) => {
		const pamphletId = c.req.param('id');

		if (!pamphletId) {
			return c.json({ error: 'Missing pamphlet ID' }, 400);
		}

		try {
			// 1. Delete all R2 objects (metadata + tiles)
			// This is the most important step - removes actual data
			// Uses R2's batch delete API to efficiently delete up to 1000 objects per call
			const deletedCount = await r2Service.deletePamphlet(c.env, pamphletId);

			// 2. Delete metadata cache
			const metadataUrl = new URL(c.req.url);
			metadataUrl.pathname = `/pamphlet/${pamphletId}/metadata`;
			const metadataCacheDeleted = await deleteFromCache(metadataUrl.toString());

			// Note: Tile caches are NOT deleted here
			// They will expire naturally after 30 days (CDN-Cache-Control: max-age=2592000)
			// This avoids the overhead of deleting potentially thousands of tile caches

			return c.json({
				id: pamphletId,
				status: 'ok',
				message: 'Pamphlet deleted successfully',
				deleted: {
					r2Objects: deletedCount,
					metadataCache: metadataCacheDeleted,
				},
			});
		} catch (error) {
			console.error('Error deleting pamphlet:', error);
			return c.json({ error: 'Internal server error', message: String(error) }, 500);
		}
	});

export default admin;
