import { hc } from 'hono/client';
import type { AppType } from '../../index';
import { uploadResponseSchema } from '../../routes/upload';
import type { ProcessedPage, Metadata } from '../types';
import type { z } from 'zod';

export async function uploadTiles(
  pages: ProcessedPage[],
  pamphletId: string,
  tileSize: number,
  onProgress: (progress: number) => void
): Promise<z.infer<typeof uploadResponseSchema>> {
  if (pages.length === 0) {
    throw new Error('アップロード可能なページがありません');
  }

  onProgress(0);

  // メタデータを構築
  const metadata: Metadata = {
    version: Date.now(),
    tile_size: tileSize,
    pages: pages.map((page) => ({
      page: page.pageNumber,
      width: page.width,
      height: page.height,
      tiles: page.tiles.map((tile) => ({
        x: tile.x,
        y: tile.y,
        hash: tile.hash,
      })),
    })),
  };

  // FormDataを構築（ハッシュベース、重複排除）
  const formData = new FormData();
  formData.append('id', pamphletId);
  formData.append('metadata', JSON.stringify(metadata));

  const addedHashes = new Set<string>();
  for (const page of pages) {
    for (const tile of page.tiles) {
      if (!addedHashes.has(tile.hash)) {
        // Create new Uint8Array from the data to ensure ArrayBuffer type
        const dataArray = new Uint8Array(tile.data);
        const blob = new Blob([dataArray], { type: 'image/webp' });
        formData.append(`tile-${tile.hash}`, blob);
        addedHashes.add(tile.hash);
      }
    }
  }

  // アップロード (Hono RPC client with FormData)
  const client = hc<AppType>('/');
  const res = await client.admin.upload.$post({
    form: formData,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Upload failed: ${res.status} ${errorText}`);
  }

  const json = await res.json();
  const result = uploadResponseSchema.parse(json);
  onProgress(100);

  return result;
}
