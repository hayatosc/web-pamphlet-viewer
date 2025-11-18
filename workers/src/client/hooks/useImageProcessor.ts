import { initWasm } from './useWasm';
import type { ProcessedPage, FileWithPreview, TileWithData } from '../types';

export async function processImages(
  files: FileWithPreview[],
  tileSize: number,
  onPageUpdate: (updater: (prev: ProcessedPage[]) => ProcessedPage[]) => void
): Promise<ProcessedPage[]> {
  if (files.length === 0) {
    throw new Error('画像ファイルを選択してください');
  }

  // WASM初期化
  const wasm = await initWasm();

  // 初期化
  const pages: ProcessedPage[] = files.map((file, index) => ({
    file,
    pageNumber: index,
    tiles: [],
    width: 0,
    height: 0,
    tileSize,
    status: 'pending' as const,
    progress: 0,
  }));

  onPageUpdate(() => pages);

  // 各画像をタイル化
  for (let i = 0; i < files.length; i++) {
    onPageUpdate((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, status: 'processing' as const } : p))
    );

    try {
      const arrayBuffer = await files[i].arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      const result = wasm.tile_image(uint8Array, tileSize);

      // タイル情報とデータを結合
      const tileCount = result.tile_count();
      const tilesWithData: TileWithData[] = [];

      for (let j = 0; j < tileCount; j++) {
        const tileInfo = result.tiles[j];
        const tileData = result.get_tile_data(j);
        tilesWithData.push({
          ...tileInfo,
          data: tileData,
        });
      }

      // ローカル配列を更新
      pages[i] = {
        ...pages[i],
        tiles: tilesWithData,
        width: result.width,
        height: result.height,
        status: 'completed' as const,
        progress: 100,
      };

      onPageUpdate((prev) =>
        prev.map((p, idx) =>
          idx === i
            ? pages[i]
            : p
        )
      );
    } catch (error) {
      console.error(`Error processing page ${i}:`, error);

      // ローカル配列を更新
      pages[i] = {
        ...pages[i],
        status: 'error' as const,
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      onPageUpdate((prev) =>
        prev.map((p, idx) =>
          idx === i
            ? pages[i]
            : p
        )
      );
    }
  }

  return pages.filter((p) => p.status === 'completed');
}
