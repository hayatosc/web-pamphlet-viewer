/**
 * Cache Service
 * Simple Cache API wrapper using request URLs as cache keys
 */

const cache = caches.default;

/**
 * Get response from cache
 */
export async function getFromCache(url: string): Promise<Response | null> {
  const request = new Request(url);
  const response = await cache.match(request);
  return response || null;
}

/**
 * Put response into cache
 */
export async function putIntoCache(url: string, response: Response): Promise<void> {
  const request = new Request(url);
  await cache.put(request, response.clone());
}

/**
 * Delete response from cache
 */
export async function deleteFromCache(url: string): Promise<boolean> {
  const request = new Request(url);
  return await cache.delete(request);
}

/**
 * Cache headers for metadata responses
 */
export function getMetadataCacheHeaders(): HeadersInit {
  return {
    'Cache-Control': 'private, max-age=60',
  };
}

/**
 * Cache headers for tile responses
 */
export function getTileCacheHeaders(): HeadersInit {
  return {
    'Cache-Control': 'public, max-age=86400, s-maxage=2592000',
    'CDN-Cache-Control': 'max-age=2592000',
  };
}
