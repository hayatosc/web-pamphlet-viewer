import type { ProcessedPage } from '../types';

interface ProcessingStatusProps {
  processedPages: ProcessedPage[];
}

export function ProcessingStatus({ processedPages }: ProcessingStatusProps) {
  if (processedPages.length === 0) return null;

  return (
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
  );
}
