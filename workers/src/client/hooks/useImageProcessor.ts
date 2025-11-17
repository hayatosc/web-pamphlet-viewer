import { initWasm } from './useWasm';
import type { ProcessedPage, FileWithPreview } from '../types';

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

      onPageUpdate((prev) =>
        prev.map((p, idx) =>
          idx === i
            ? {
                ...p,
                tiles: result.tiles,
                width: result.width,
                height: result.height,
                status: 'completed' as const,
                progress: 100,
              }
            : p
        )
      );
    } catch (error) {
      console.error(`Error processing page ${i}:`, error);
      onPageUpdate((prev) =>
        prev.map((p, idx) =>
          idx === i
            ? {
                ...p,
                status: 'error' as const,
                error: error instanceof Error ? error.message : 'Unknown error',
              }
            : p
        )
      );
    }
  }

  return pages.filter((p) => p.status === 'completed');
}
