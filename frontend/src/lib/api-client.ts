import { hc } from 'hono/client';
import type { AppType } from '../types/api';

/**
 * Create a typed Hono client for the API
 */
export function createApiClient(baseUrl: string) {
  return hc<AppType>(baseUrl);
}

/**
 * Default API client (can be overridden)
 */
export const apiClient = createApiClient('');
