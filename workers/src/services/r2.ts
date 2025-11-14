/**
 * R2 Service - Helper functions for R2 bucket operations
 */

import type { Env } from '../types/bindings';

/**
 * Generate R2 key for a tile
 * @param pamphletId Pamphlet ID
 * @param page Page number
 * @param x Tile X coordinate
 * @param y Tile Y coordinate
 * @returns R2 object key
 */
export function getTileKey(pamphletId: string, page: number, x: number, y: number): string {
  return `pamphlets/${pamphletId}/page-${page}/tile-${x}-${y}.webp`;
}

/**
 * Generate R2 key for metadata
 * @param pamphletId Pamphlet ID
 * @returns R2 object key
 */
export function getMetadataKey(pamphletId: string): string {
  return `pamphlets/${pamphletId}/metadata.json`;
}

/**
 * Get a tile from R2
 * @param env Environment bindings
 * @param pamphletId Pamphlet ID
 * @param page Page number
 * @param x Tile X coordinate
 * @param y Tile Y coordinate
 * @returns R2 object or null if not found
 */
export async function getTile(
  env: Env,
  pamphletId: string,
  page: number,
  x: number,
  y: number
): Promise<R2ObjectBody | null> {
  const key = getTileKey(pamphletId, page, x, y);
  return await env.R2_BUCKET.get(key);
}

/**
 * Put a tile into R2
 * @param env Environment bindings
 * @param pamphletId Pamphlet ID
 * @param page Page number
 * @param x Tile X coordinate
 * @param y Tile Y coordinate
 * @param data Tile data (WebP)
 * @returns R2 object
 */
export async function putTile(
  env: Env,
  pamphletId: string,
  page: number,
  x: number,
  y: number,
  data: Uint8Array | ArrayBuffer | ReadableStream
): Promise<R2Object> {
  const key = getTileKey(pamphletId, page, x, y);
  return await env.R2_BUCKET.put(key, data, {
    httpMetadata: {
      contentType: 'image/webp',
    },
  });
}

/**
 * Put metadata into R2
 * @param env Environment bindings
 * @param pamphletId Pamphlet ID
 * @param metadata Metadata object
 * @returns R2 object
 */
export async function putMetadata(
  env: Env,
  pamphletId: string,
  metadata: unknown
): Promise<R2Object> {
  const key = getMetadataKey(pamphletId);
  const data = JSON.stringify(metadata);
  return await env.R2_BUCKET.put(key, data, {
    httpMetadata: {
      contentType: 'application/json',
    },
  });
}

/**
 * Get metadata from R2
 * @param env Environment bindings
 * @param pamphletId Pamphlet ID
 * @returns Metadata object or null if not found
 */
export async function getMetadata(env: Env, pamphletId: string): Promise<unknown | null> {
  const key = getMetadataKey(pamphletId);
  const object = await env.R2_BUCKET.get(key);
  if (!object) return null;

  const text = await object.text();
  return JSON.parse(text);
}

/**
 * Delete a pamphlet and all its tiles
 * @param env Environment bindings
 * @param pamphletId Pamphlet ID
 */
export async function deletePamphlet(env: Env, pamphletId: string): Promise<void> {
  // List all objects with the prefix
  const prefix = `pamphlets/${pamphletId}/`;
  const list = await env.R2_BUCKET.list({ prefix });

  // Delete all objects in parallel
  const deletePromises = list.objects.map((obj) => env.R2_BUCKET.delete(obj.key));
  await Promise.all(deletePromises);
}
