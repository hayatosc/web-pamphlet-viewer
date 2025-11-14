/**
 * Upload Router
 * POST /upload
 */

import { Hono, Context } from 'hono';
import type { Env, Variables } from '../types/bindings';
import type { Metadata, PageInfo } from 'shared/types/wasm';
import * as r2Service from '../services/r2';

const upload = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Upload Request Body (JSON format)
 */
interface UploadRequestBody {
  id: string;
  tile_size: number;
  pages: PageInfo[];
}

/**
 * POST /upload
 * Handle upload request (JSON or multipart)
 */
upload.post('/upload', async (c) => {
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
  const body = await c.req.json<UploadRequestBody>();

  if (!body.id || !body.tile_size || !body.pages) {
    return c.json({ error: 'Missing required fields: id, tile_size, pages' }, 400);
  }

  // Create metadata with current timestamp as version
  const metadata: Metadata = {
    version: Date.now(),
    tile_size: body.tile_size,
    pages: body.pages,
  };

  // Save metadata to R2
  await r2Service.putMetadata(c.env, body.id, metadata);

  return c.json({
    id: body.id,
    version: metadata.version,
    status: 'ok',
  });
}

/**
 * Handle multipart upload (with tile files)
 */
async function handleMultipartUpload(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const formData = await c.req.formData();

  // Get metadata from form
  const metadataField = formData.get('metadata');
  if (!metadataField || typeof metadataField !== 'string') {
    return c.json({ error: 'Missing metadata field' }, 400);
  }

  const uploadData: UploadRequestBody = JSON.parse(metadataField);

  if (!uploadData.id || !uploadData.tile_size || !uploadData.pages) {
    return c.json({ error: 'Missing required fields in metadata' }, 400);
  }

  // Upload tiles to R2 in parallel
  const uploadPromises: Promise<unknown>[] = [];

  for (const [key, value] of formData.entries()) {
    // Skip metadata field
    if (key === 'metadata') continue;

    // Parse tile key: "tile-{hash}"
    const match = key.match(/^tile-([a-f0-9]{64})$/i);
    if (!match || !(value instanceof File)) {
      console.warn(`Skipping invalid tile key: ${key}`);
      continue;
    }

    const hash = match[1];

    // Upload tile to R2
    const arrayBuffer = await value.arrayBuffer();
    uploadPromises.push(r2Service.putTile(c.env, uploadData.id, hash, arrayBuffer));
  }

  // Wait for all uploads to complete
  await Promise.all(uploadPromises);

  // Create metadata
  const metadata: Metadata = {
    version: Date.now(),
    tile_size: uploadData.tile_size,
    pages: uploadData.pages,
  };

  // Save metadata to R2
  await r2Service.putMetadata(c.env, uploadData.id, metadata);

  return c.json({
    id: uploadData.id,
    version: metadata.version,
    status: 'ok',
  });
}

export default upload;
