/**
 * Cache API Service - Helper functions for Cloudflare Cache API operations
 */

/**
 * Generate cache key for metadata
 * @param pamphletId Pamphlet ID
 * @returns Cache key URL
 */
export function getMetadataCacheKey(pamphletId: string): string {
  // Use a dummy URL as cache key - only the path matters
  return `https://dummy/pamphlet:${pamphletId}:metadata`;
}

/**
 * Generate cache key for a tile (hash-based)
 * @param pamphletId Pamphlet ID
 * @param hash Tile SHA256 hash
 * @param version Version number (for cache invalidation)
 * @returns Cache key URL
 */
export function getTileCacheKey(
  pamphletId: string,
  hash: string,
  version: number
): string {
  // Use a dummy URL as cache key - only the path and query params matter
  return `https://dummy/pamphlet:${pamphletId}:tile:${hash}:v${version}`;
}

/**
 * Get metadata from cache
 * @param cacheKey Cache key URL
 * @returns Cached response or null if not found
 */
export async function getMetadataFromCache(cacheKey: string): Promise<Response | null> {
  const cache = caches.default;
  const request = new Request(cacheKey);
  const response = await cache.match(request);
  return response || null;
}

/**
 * Put metadata into cache
 * @param cacheKey Cache key URL
 * @param response Response to cache
 */
export async function putMetadataIntoCache(cacheKey: string, response: Response): Promise<void> {
  const cache = caches.default;
  const request = new Request(cacheKey);

  // Clone the response before caching (response can only be read once)
  await cache.put(request, response.clone());
}

/**
 * Delete metadata from cache
 * @param cacheKey Cache key URL
 */
export async function deleteMetadataFromCache(cacheKey: string): Promise<boolean> {
  const cache = caches.default;
  const request = new Request(cacheKey);
  return await cache.delete(request);
}

/**
 * Get a tile from cache
 * @param cacheKey Cache key URL
 * @returns Cached response or null if not found
 */
export async function getTileFromCache(cacheKey: string): Promise<Response | null> {
  const cache = caches.default;
  const request = new Request(cacheKey);
  const response = await cache.match(request);
  return response || null;
}

/**
 * Put a tile into cache
 * @param cacheKey Cache key URL
 * @param response Response to cache
 */
export async function putTileIntoCache(cacheKey: string, response: Response): Promise<void> {
  const cache = caches.default;
  const request = new Request(cacheKey);

  // Clone the response before caching (response can only be read once)
  await cache.put(request, response.clone());
}

/**
 * Create cache headers for tile responses
 * @returns Headers object with cache control
 */
export function getTileCacheHeaders(): HeadersInit {
  return {
    'Cache-Control': 'public, max-age=86400, s-maxage=2592000',
    'CDN-Cache-Control': 'max-age=2592000',
  };
}

/**
 * Create cache headers for metadata responses
 * @returns Headers object with cache control
 */
export function getMetadataCacheHeaders(): HeadersInit {
  return {
    'Cache-Control': 'private, max-age=60',
  };
}
