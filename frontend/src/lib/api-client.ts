import { hc } from 'hono/client';
import type { AppType } from 'workers';

/**
 * Create a typed Hono RPC client
 */
export function createApiClient(baseUrl: string) {
  return hc<AppType>(baseUrl);
}
