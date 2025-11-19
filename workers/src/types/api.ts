/**
 * API Type Export for Frontend
 * Manually defined to avoid importing workers code
 */

/**
 * Metadata response type
 */
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

/**
 * Hono RPC client type for the pamphlet viewer API
 * Defines the available routes and their request/response types
 */
export type AppType = {
  pamphlet: {
    [id: string]: {
      metadata: {
        $get: (args: {
          param: { id: string };
          query?: { pages?: string };
        }) => Promise<Response>;
      };
      tile: {
        [hash: string]: {
          $get: (args: {
            param: { id: string; hash: string };
          }) => Promise<Response>;
        };
      };
      invalidate: {
        $post: (args: {
          param: { id: string };
        }) => Promise<Response>;
      };
    };
  };
};
