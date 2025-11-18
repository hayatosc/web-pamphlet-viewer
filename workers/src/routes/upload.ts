/**
 * Upload Router
 * POST /upload
 */

import { Hono, Context } from 'hono';
import type { Env, Variables } from '../types/bindings';
import type { Metadata, UploadResponse } from 'shared/types/wasm';
import {
  uploadRequestSchema,
  uploadFormDataSchema,
  uploadResponseSchema,
  metadataSchema,
} from 'shared/schemas/pamphlet';
import * as r2Service from '../services/r2';

/**
 * POST /
 * Handle upload request (JSON or multipart)
 */
const upload = new Hono<{ Bindings: Env; Variables: Variables }>().post(
  '/',
  async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || '';

    // Check if this is a JSON request (metadata only, tiles already uploaded)
    if (contentType.includes('application/json')) {
      return await handleJsonUpload(c);
    }

    // Check if this is a multipart request (with tile files)
    if (contentType.includes('multipart/form-data')) {
      return await handleMultipartUpload(c);
    }

    return c.json({ error: 'Unsupported content type' }, 400);
  } catch (error) {
    console.error('Error handling upload:', error);
    return c.json({ error: 'Internal server error', message: String(error) }, 500);
  }
});

/**
 * Handle JSON upload (metadata only)
 */
async function handleJsonUpload(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const body = await c.req.json();

  // Validate request body with zod
  const validationResult = uploadRequestSchema.safeParse(body);
  if (!validationResult.success) {
    return c.json(
      { error: 'Invalid request body', details: validationResult.error.issues },
      400
    );
  }

  const validatedData = validationResult.data;

  // Create metadata with current timestamp as version
  const metadata: Metadata = {
    version: Date.now(),
    tile_size: validatedData.tile_size,
    pages: validatedData.pages,
  };

  // Save metadata to R2
  await r2Service.putMetadata(c.env, validatedData.id, metadata);

  return c.json<UploadResponse>({
    id: validatedData.id,
    version: metadata.version,
    status: 'ok' as const,
  });
}

/**
 * Handle multipart upload (with tile files)
 */
async function handleMultipartUpload(c: Context<{ Bindings: Env; Variables: Variables }>) {
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

  // Validate metadata with zod
  const metadataValidation = metadataSchema.safeParse(parsedMetadata);
  if (!metadataValidation.success) {
    return c.json(
      { error: 'Invalid metadata structure', details: metadataValidation.error.issues },
      400
    );
  }

  const validatedMetadata = metadataValidation.data;

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

    const hash = match[1];

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
}

export default upload;
