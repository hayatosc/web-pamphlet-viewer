/**
 * Cloudflare Workers global type extensions
 */

declare global {
  interface CacheStorage {
    default: Cache;
  }
}

export {};
