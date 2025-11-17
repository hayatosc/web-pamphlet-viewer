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

  // タイルを追加（ハッシュベース、重複排除）
  const tiles: Record<string, Blob> = {};
  const addedHashes = new Set<string>();

  for (const page of pages) {
    for (const tile of page.tiles) {
      if (!addedHashes.has(tile.hash)) {
        tiles[`tile-${tile.hash}`] = new Blob([tile.data as Uint8Array<ArrayBuffer>], { type: 'image/webp' });
        addedHashes.add(tile.hash);
      }
    }
  }

  // アップロード (Hono RPC client with type-safe form data)
  // Note: hc<AppType>() returns unknown due to complex route types from app.route()
  // We use type assertion here, but ensure type safety through zod schema validation
  type PostFn = (args: {
    form: Record<string, string | Blob>;
  }) => Promise<Response>;

  const client = hc<AppType>('/') as { admin: { upload: { $post: PostFn } } };

  const res = await client.admin.upload.$post({
    form: {
      id: pamphletId,
      metadata: JSON.stringify(metadata),
      ...tiles,
    },
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
