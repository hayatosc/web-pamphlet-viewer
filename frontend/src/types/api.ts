/**
 * API Types for Hono Client
 * Manually defined to avoid importing from workers
 */

// Metadata response type
export interface MetadataResponse {
  version: string;
  tile_size: number;
  pages: Array<{
    page: number;
    width: number;
    height: number;
    tiles: Array<{
      x: number;
      y: number;
      hash: string;
    }>;
  }>;
  total_pages: number;
  has_more: boolean;
  has_previous: boolean;
}

// Client type (simplified for hono/client)
export type AppType = any;
