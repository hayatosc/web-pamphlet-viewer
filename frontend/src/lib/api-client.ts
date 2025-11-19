import { hc } from 'hono/client';
import type { AppType } from 'workers/src/types/api';

/**
 * Create a typed Hono RPC client
 * Note: Uses type assertion to bypass Hono constraint
 */
export function createApiClient(baseUrl: string): AppType {
  return hc(baseUrl) as unknown as AppType;
}
