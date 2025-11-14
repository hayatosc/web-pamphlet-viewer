/**
 * KV Service - Helper functions for KV namespace operations
 */

import type { Env } from '../types/bindings';
import type { Metadata } from 'shared/types/wasm';

/**
 * Generate KV key for metadata
 * @param pamphletId Pamphlet ID
 * @returns KV key
 */
export function getMetadataKVKey(pamphletId: string): string {
  return `meta:${pamphletId}`;
}

/**
 * Get metadata from KV
 * @param env Environment bindings
 * @param pamphletId Pamphlet ID
 * @returns Metadata object or null if not found
 */
export async function getMetadata(env: Env, pamphletId: string): Promise<Metadata | null> {
  const key = getMetadataKVKey(pamphletId);
  const value = await env.META_KV.get(key, 'json');
  return value as Metadata | null;
}

/**
 * Put metadata into KV
 * @param env Environment bindings
 * @param pamphletId Pamphlet ID
 * @param metadata Metadata object
 */
export async function putMetadata(
  env: Env,
  pamphletId: string,
  metadata: Metadata
): Promise<void> {
  const key = getMetadataKVKey(pamphletId);
  await env.META_KV.put(key, JSON.stringify(metadata));
}

/**
 * Update metadata version (for cache invalidation)
 * @param env Environment bindings
 * @param pamphletId Pamphlet ID
 * @returns New version number
 */
export async function updateMetadataVersion(env: Env, pamphletId: string): Promise<number> {
  const metadata = await getMetadata(env, pamphletId);
  if (!metadata) {
    throw new Error(`Metadata not found for pamphlet: ${pamphletId}`);
  }

  // Update version to current timestamp
  const newVersion = Date.now();
  metadata.version = newVersion;

  await putMetadata(env, pamphletId, metadata);
  return newVersion;
}

/**
 * Delete metadata from KV
 * @param env Environment bindings
 * @param pamphletId Pamphlet ID
 */
export async function deleteMetadata(env: Env, pamphletId: string): Promise<void> {
  const key = getMetadataKVKey(pamphletId);
  await env.META_KV.delete(key);
}
