/**
 * Upload Router
 * POST /admin/upload - Legacy multipart upload (with tile files)
 * POST /admin/upload/tiles - Chunked tile upload
 * POST /admin/upload/complete - Finalize upload with metadata
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/bindings';
import type { Metadata, UploadResponse } from 'shared/types/wasm';
import {
  uploadFormDataSchema,
  uploadMetadataSchema,
} from 'shared/schemas/pamphlet';
import * as r2Service from '../services/r2';

/**
 * R2 upload chunk size to avoid API rate limits
 * Server processes tiles in batches of this size
 */
const R2_UPLOAD_CHUNK_SIZE = 50;

const upload = new Hono<{ Bindings: Env; Variables: Variables }>()
  /**
   * POST /tiles - Upload a chunk of tiles
   * Can be called multiple times for the same pamphlet
   * Validates tiles against metadata before upload
   */
  .post('/tiles', async (c) => {
    try {
      const formData = await c.req.formData();

      // Get pamphlet ID
      const idField = formData.get('id');
      if (!idField || typeof idField !== 'string') {
        return c.json({ error: 'Missing id field' }, 400);
      }

      // Get metadata if provided (for validation)
      const metadataField = formData.get('metadata');
      let expectedHashes: Set<string> | null = null;

      if (metadataField && typeof metadataField === 'string') {
        try {
          const parsedMetadata = JSON.parse(metadataField);
          const metadataValidation = uploadMetadataSchema.safeParse(parsedMetadata);

          if (metadataValidation.success) {
            // Extract all expected tile hashes from metadata
            expectedHashes = new Set<string>();
            for (const page of metadataValidation.data.pages) {
              for (const tile of page.tiles) {
                expectedHashes.add(tile.hash.toLowerCase());
              }
            }
          }
        } catch (error) {
          console.warn('Failed to parse metadata for validation:', error);
        }
      }

      // Upload all tiles in this chunk
      const uploadedHashes: string[] = [];
      const tilesToUpload: Array<{ hash: string; data: ArrayBuffer }> = [];

      for (const [key, value] of formData.entries()) {
        // Skip id and metadata fields
        if (key === 'id' || key === 'metadata') continue;

        // Parse tile key: "tile-{hash}"
        const match = key.match(/^tile-([a-f0-9]{64})$/i);
        if (!match || !(value instanceof File)) {
          console.warn(`Skipping invalid tile key: ${key}`);
          continue;
        }

        const hash = match[1].toLowerCase();

        // Validate against metadata if available
        if (expectedHashes && !expectedHashes.has(hash)) {
          console.warn(`Skipping tile not in metadata: ${hash}`);
          continue;
        }

        const arrayBuffer = await value.arrayBuffer();
        tilesToUpload.push({ hash, data: arrayBuffer });
      }

      // Upload tiles in sub-chunks to avoid R2 API limits
      for (let i = 0; i < tilesToUpload.length; i += R2_UPLOAD_CHUNK_SIZE) {
        const chunk = tilesToUpload.slice(i, i + R2_UPLOAD_CHUNK_SIZE);
        const uploadPromises = chunk.map(({ hash, data }) =>
          r2Service.putTile(c.env, idField, hash, data).then(() => hash)
        );
        const hashes = await Promise.all(uploadPromises);
        uploadedHashes.push(...hashes);
      }

      return c.json({
        id: idField,
        status: 'ok' as const,
        uploadedTiles: uploadedHashes.length,
        hashes: uploadedHashes,
      });
    } catch (error) {
      console.error('Error uploading tiles:', error);
      return c.json({ error: 'Internal server error', message: String(error) }, 500);
    }
  })
  /**
   * POST /complete - Finalize upload with metadata only
   * Called after all tile chunks have been uploaded via /tiles
   */
  .post('/complete', async (c) => {
    try {
      const body = await c.req.json();

      // Validate request body
      const formDataValidation = uploadFormDataSchema.safeParse(body);
      if (!formDataValidation.success) {
        return c.json(
          { error: 'Invalid request data', details: formDataValidation.error.issues },
          400
        );
      }

      const { id, metadata: metadataWithoutVersion } = formDataValidation.data;

      // Update metadata version with current timestamp
      const metadata: Metadata = {
        ...metadataWithoutVersion,
        version: Date.now(),
      };

      // Save metadata to R2
      await r2Service.putMetadata(c.env, id, metadata);

      return c.json<UploadResponse>({
        id,
        version: metadata.version,
        status: 'ok' as const,
      });
    } catch (error) {
      console.error('Error completing upload:', error);
      return c.json({ error: 'Internal server error', message: String(error) }, 500);
    }
  })
  /**
   * POST / - Legacy: Handle multipart upload (with tile files and metadata)
   * For backward compatibility. New implementations should use /tiles + /complete
   */
  .post('/', async (c) => {
    try {
      const formData = await c.req.formData();

      // Get id from form
      const idField = formData.get('id');
      if (!idField || typeof idField !== 'string') {
        return c.json({ error: 'Missing id field' }, 400);
      }

      // Get metadata from form
      const metadataField = formData.get('metadata');
      if (!metadataField || typeof metadataField !== 'string') {
        return c.json({ error: 'Missing metadata field' }, 400);
      }

      // Parse and validate metadata JSON
      let parsedMetadata: unknown;
      try {
        parsedMetadata = JSON.parse(metadataField);
      } catch (error) {
        return c.json({ error: 'Invalid JSON in metadata field' }, 400);
      }

      // Validate metadata with zod (without version - server sets it)
      const metadataValidation = uploadMetadataSchema.safeParse(parsedMetadata);
      if (!metadataValidation.success) {
        return c.json(
          { error: 'Invalid metadata structure', details: metadataValidation.error.issues },
          400
        );
      }

      const validatedMetadata = metadataValidation.data;

      // Extract all expected tile hashes from metadata
      const expectedHashes = new Set<string>();
      for (const page of validatedMetadata.pages) {
        for (const tile of page.tiles) {
          expectedHashes.add(tile.hash.toLowerCase());
        }
      }


      // Validate form data (id + metadata)
      const formDataValidation = uploadFormDataSchema.safeParse({
        id: idField,
        metadata: validatedMetadata,
      });

      if (!formDataValidation.success) {
        return c.json(
          { error: 'Invalid form data', details: formDataValidation.error.issues },
          400
        );
      }

      const validatedFormData = formDataValidation.data;

      // Upload tiles to R2 in parallel
      const uploadPromises: Promise<unknown>[] = [];

      for (const [key, value] of formData.entries()) {
        // Skip metadata and id fields
        if (key === 'metadata' || key === 'id') continue;

        // Parse tile key: "tile-{hash}"
        const match = key.match(/^tile-([a-f0-9]{64})$/i);
        if (!match || !(value instanceof File)) {
          console.warn(`Skipping invalid tile key: ${key}`);
          continue;
        }

        const hash = match[1].toLowerCase();

        // Validate that this tile hash exists in the metadata
        if (!expectedHashes.has(hash)) {
          console.warn(`Skipping unexpected tile hash: ${hash}`);
          continue;
        }

        // Upload tile to R2
        const arrayBuffer = await value.arrayBuffer();
        uploadPromises.push(r2Service.putTile(c.env, validatedFormData.id, hash, arrayBuffer));
      }

      // Wait for all uploads to complete
      await Promise.all(uploadPromises);

      // Update metadata version with current timestamp
      const metadata: Metadata = {
        ...validatedMetadata,
        version: Date.now(),
      };

      // Save metadata to R2
      await r2Service.putMetadata(c.env, validatedFormData.id, metadata);

      return c.json<UploadResponse>({
        id: validatedFormData.id,
        version: metadata.version,
        status: 'ok' as const,
      });
    } catch (error) {
      console.error('Error handling multipart upload:', error);
      return c.json({ error: 'Internal server error', message: String(error) }, 500);
    }
  });

export default upload;
