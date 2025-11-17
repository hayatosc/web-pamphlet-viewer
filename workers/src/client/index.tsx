import { render } from 'hono/jsx/dom';
import { useState, useCallback } from 'hono/jsx';
import { FileDropZone } from './components/FileDropZone';
import { FileList } from './components/FileList';
import { ProcessingStatus } from './components/ProcessingStatus';
import { UploadProgress } from './components/UploadProgress';
import { processImages } from './hooks/useImageProcessor';
import { uploadTiles } from './hooks/useFileUpload';
import type { FileWithPreview, ProcessedPage } from './types';

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

  const handleProcessAndUpload = async () => {
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
      // 画像をタイル化
      const completedPages = await processImages(files, tileSize, setProcessedPages);

      // アップロード処理
      const result = await uploadTiles(completedPages, pamphletId, tileSize, setUploadProgress);

      alert(`アップロード成功！\nID: ${result.id}\nVersion: ${result.version}`);

      // リセット
      setFiles([]);
      setProcessedPages([]);
      setPamphletId('');
    } catch (error) {
      console.error('Processing error:', error);
      alert(
        '処理中にエラーが発生しました: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    } finally {
      setIsProcessing(false);
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
            <FileDropZone
              isDragging={isDragging}
              isProcessing={isProcessing}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onFileInput={handleFileInput}
            />

            {/* 選択されたファイル一覧 */}
            <FileList files={files} />

            {/* 処理状況 */}
            <ProcessingStatus processedPages={processedPages} />

            {/* 実行ボタン */}
            <div class="mt-6">
              <button
                onClick={handleProcessAndUpload}
                disabled={isProcessing || files.length === 0 || !pamphletId.trim()}
                class="w-full px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? '処理中...' : 'タイル化してアップロード'}
              </button>
            </div>

            {/* アップロード進捗 */}
            <UploadProgress progress={uploadProgress} />
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
