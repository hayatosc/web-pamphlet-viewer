/**
 * Cloudflare Workers Bindings Type Definitions
 */

/**
 * Workers Environment Bindings
 * These match the bindings defined in wrangler.toml
 */
export interface Env {
  /**
   * R2 Bucket for storing pamphlet tiles
   * Binding name: R2_BUCKET
   */
  R2_BUCKET: R2Bucket;

  /**
   * KV Namespace for storing pamphlet metadata
   * Binding name: META_KV
   */
  META_KV: KVNamespace;

  /**
   * Environment variable
   */
  ENVIRONMENT?: string;
}

/**
 * Hono Context Variables
 * These can be set and accessed within request handlers
 */
export type Variables = {
  // Pamphlet metadata (set by loadMetadata middleware)
  metadata?: {
    version: number;
    tile_size: number;
    pages: Array<{
      page: number;
      width: number;
      height: number;
      tiles: Array<{ x: number; y: number; hash: string }>;
    }>;
  };
};
