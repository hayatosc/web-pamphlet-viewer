/**
 * Metadata Route Handler
 * GET /pamphlet/:id/metadata
 */

import { Context } from 'hono';
import type { Env, Variables } from '../types/bindings';
import * as kvService from '../services/kv';
import { getMetadataCacheHeaders } from '../services/cache';

/**
 * Get pamphlet metadata
 * @param c Hono context
 * @returns Response with metadata JSON
 */
export async function getMetadata(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const pamphletId = c.req.param('id');

  if (!pamphletId) {
    return c.json({ error: 'Missing pamphlet ID' }, 400);
  }

  try {
    // Get metadata from KV
    const metadata = await kvService.getMetadata(c.env, pamphletId);

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
}
