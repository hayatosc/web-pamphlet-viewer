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

  /**
   * Secret key for HMAC token signing
   * Should be set in wrangler.toml [vars] or .dev.vars
   */
  SECRET_KEY?: string;
}

/**
 * Hono Context Variables
 * These can be set and accessed within request handlers
 */
export type Variables = {
  // Add any context variables here as needed
  // Example: userId: string;
};
