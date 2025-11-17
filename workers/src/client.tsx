/** @jsxImportSource preact */
import { render } from 'preact';
import { useState, useCallback } from 'preact/hooks';

// WASM関連の型定義
interface TileResult {
  x: number;
  y: number;
  hash: string;
  data: Uint8Array;
}

interface TileImageResult {
  tiles: TileResult[];
  width: number;
  height: number;
  tile_size: number;
}

interface WasmModule {
  tile_image: (imageData: Uint8Array, tileSize: number) => TileImageResult;
  generate_metadata: (pages: any[]) => string;
}

// WASM初期化
let wasmModule: WasmModule | null = null;
let wasmInitPromise: Promise<WasmModule> | null = null;

async function initWasm(): Promise<WasmModule> {
  if (wasmModule) return wasmModule;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    try {
      const init = await import('/wasm/tile_wasm.js');
      await init.default();
      wasmModule = init as unknown as WasmModule;
      return wasmModule;
    } catch (error) {
      console.error('WASM initialization failed:', error);
      throw error;
    }
  })();

  return wasmInitPromise;
}

interface FileWithPreview extends File {
  preview?: string;
}

interface ProcessedPage {
  file: File;
  pageNumber: number;
  tiles: TileResult[];
  width: number;
  height: number;
  tileSize: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  error?: string;
}

function App() {
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedPages, setProcessedPages] = useState<ProcessedPage[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pamphletId, setPamphletId] = useState('');
  const [tileSize, setTileSize] = useState(512);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer?.files || []).filter((file) =>
      file.type.startsWith('image/')
    );

    if (droppedFiles.length > 0) {
      setFiles(droppedFiles);
      // プレビュー用のURLを生成
      droppedFiles.forEach((file: FileWithPreview) => {
        file.preview = URL.createObjectURL(file);
      });
    }
  }, []);

  const handleFileInput = useCallback((e: Event) => {
    const input = e.target as HTMLInputElement;
    const selectedFiles = Array.from(input.files || []).filter((file) =>
      file.type.startsWith('image/')
    );

    if (selectedFiles.length > 0) {
      setFiles(selectedFiles);
      selectedFiles.forEach((file: FileWithPreview) => {
        file.preview = URL.createObjectURL(file);
      });
    }
  }, []);

  const processImages = async () => {
    if (files.length === 0) {
      alert('画像ファイルを選択してください');
      return;
    }

    if (!pamphletId.trim()) {
      alert('パンフレットIDを入力してください');
      return;
    }

    setIsProcessing(true);
    setProcessedPages([]);

    try {
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
      setProcessedPages(pages);

      // 各画像をタイル化
      for (let i = 0; i < files.length; i++) {
        setProcessedPages((prev) =>
          prev.map((p, idx) => (idx === i ? { ...p, status: 'processing' as const } : p))
        );

        try {
          const arrayBuffer = await files[i].arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          const result = wasm.tile_image(uint8Array, tileSize);

          setProcessedPages((prev) =>
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
          setProcessedPages((prev) =>
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

      // アップロード処理
      await uploadTiles(pages.filter((p) => p.status === 'completed'));
    } catch (error) {
      console.error('Processing error:', error);
      alert('処理中にエラーが発生しました: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsProcessing(false);
    }
  };

  const uploadTiles = async (pages: ProcessedPage[]) => {
    if (pages.length === 0) {
      alert('アップロード可能なページがありません');
      return;
    }

    setUploadProgress(0);

    try {
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
      const metadata = {
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
      setUploadProgress(100);

      alert(`アップロード成功！\nID: ${result.id}\nVersion: ${result.version}`);

      // リセット
      setFiles([]);
      setProcessedPages([]);
      setPamphletId('');
    } catch (error) {
      console.error('Upload error:', error);
      alert('アップロードに失敗しました: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  return (
    <div class="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div class="max-w-4xl mx-auto">
        <div class="bg-white shadow-xl rounded-lg overflow-hidden">
          <div class="px-6 py-8">
            <h1 class="text-3xl font-bold text-gray-900 mb-8">パンフレットアップローダー</h1>

            {/* パンフレットID入力 */}
            <div class="mb-6">
              <label class="block text-sm font-medium text-gray-700 mb-2" htmlFor="pamphlet-id">
                パンフレットID
              </label>
              <input
                id="pamphlet-id"
                type="text"
                value={pamphletId}
                onInput={(e) => setPamphletId((e.target as HTMLInputElement).value)}
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="例: pamphlet-2024-01"
                disabled={isProcessing}
              />
            </div>

            {/* タイルサイズ設定 */}
            <div class="mb-6">
              <label class="block text-sm font-medium text-gray-700 mb-2" htmlFor="tile-size">
                タイルサイズ (px)
              </label>
              <input
                id="tile-size"
                type="number"
                value={tileSize}
                onInput={(e) => setTileSize(parseInt((e.target as HTMLInputElement).value) || 512)}
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="128"
                max="1024"
                step="128"
                disabled={isProcessing}
              />
            </div>

            {/* ドラッグ&ドロップエリア */}
            <div
              class={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                isDragging
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <svg
                class="mx-auto h-12 w-12 text-gray-400"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 48 48"
                aria-hidden="true"
              >
                <path
                  d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <p class="mt-2 text-sm text-gray-600">
                画像ファイルをドラッグ&ドロップ
                <br />
                または
              </p>
              <label class="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 cursor-pointer">
                ファイルを選択
                <input
                  type="file"
                  class="hidden"
                  multiple
                  accept="image/*"
                  onChange={handleFileInput}
                  disabled={isProcessing}
                />
              </label>
            </div>

            {/* 選択されたファイル一覧 */}
            {files.length > 0 && (
              <div class="mt-6">
                <h2 class="text-lg font-medium text-gray-900 mb-4">
                  選択されたファイル ({files.length}枚)
                </h2>
                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {files.map((file, index) => (
                    <div key={index} class="relative group">
                      <img
                        src={file.preview}
                        alt={file.name}
                        class="w-full h-32 object-cover rounded-lg"
                      />
                      <div class="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-2 rounded-b-lg truncate">
                        {file.name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 処理状況 */}
            {processedPages.length > 0 && (
              <div class="mt-6">
                <h2 class="text-lg font-medium text-gray-900 mb-4">処理状況</h2>
                <div class="space-y-2">
                  {processedPages.map((page) => (
                    <div
                      key={page.pageNumber}
                      class="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <span class="text-sm">ページ {page.pageNumber + 1}</span>
                      <div class="flex items-center gap-2">
                        {page.status === 'completed' && (
                          <span class="text-green-600 text-sm">
                            ✓ 完了 ({page.tiles.length} タイル)
                          </span>
                        )}
                        {page.status === 'processing' && (
                          <span class="text-blue-600 text-sm">処理中...</span>
                        )}
                        {page.status === 'error' && (
                          <span class="text-red-600 text-sm">エラー: {page.error}</span>
                        )}
                        {page.status === 'pending' && (
                          <span class="text-gray-400 text-sm">待機中</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 実行ボタン */}
            <div class="mt-6">
              <button
                onClick={processImages}
                disabled={isProcessing || files.length === 0 || !pamphletId.trim()}
                class="w-full px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? '処理中...' : 'タイル化してアップロード'}
              </button>
            </div>

            {/* アップロード進捗 */}
            {uploadProgress > 0 && uploadProgress < 100 && (
              <div class="mt-4">
                <div class="flex justify-between mb-1">
                  <span class="text-sm font-medium text-gray-700">アップロード中</span>
                  <span class="text-sm font-medium text-gray-700">{uploadProgress}%</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2">
                  <div
                    class="bg-blue-600 h-2 rounded-full transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// クライアントサイドでレンダリング
const root = document.getElementById('root');
if (root) {
  render(<App />, root);
}
