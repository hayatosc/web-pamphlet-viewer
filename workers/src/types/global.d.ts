/**
 * Cloudflare Workers global type extensions
 */

declare global {
  interface CacheStorage {
    default: Cache;
  }
}

declare module '/wasm/tile_wasm.js' {
  const init: (input?: unknown) => Promise<unknown>;
  export default init;
  export function tile_image(...args: unknown[]): unknown;
  export function generate_metadata(...args: unknown[]): unknown;
  export function calculate_hash(...args: unknown[]): unknown;
}

export {};
