import type { ProcessedPage } from '../types';

interface UploadMetadata {
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
}

export async function uploadTiles(
  pages: ProcessedPage[],
  pamphletId: string,
  tileSize: number,
  onProgress: (progress: number) => void
): Promise<{ id: string; version: number }> {
  if (pages.length === 0) {
    throw new Error('アップロード可能なページがありません');
  }

  onProgress(0);

  // FormDataを構築
  const formData = new FormData();

  // タイルを追加（ハッシュベース、重複排除）
  const addedHashes = new Set<string>();
  for (const page of pages) {
    for (const tile of page.tiles) {
      if (!addedHashes.has(tile.hash)) {
        const blob = new Blob([tile.data], { type: 'image/webp' });
        formData.append(`tile-${tile.hash}`, blob, `${tile.hash}.webp`);
        addedHashes.add(tile.hash);
      }
    }
  }

  // メタデータを構築
  const metadata: UploadMetadata = {
    version: Date.now().toString(),
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

  formData.append('metadata', JSON.stringify(metadata));
  formData.append('id', pamphletId);

  // アップロード
  const response = await fetch('/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  onProgress(100);

  return result;
}
