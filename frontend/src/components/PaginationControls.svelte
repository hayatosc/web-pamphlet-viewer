<script lang="ts">
  import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-svelte';

  /**
   * ページネーションコントロール
   */
  let {
    currentPage,
    totalPages,
    canGoPrev,
    canGoNext,
    currentScale,
    onPrev,
    onNext,
    onZoomIn,
    onZoomOut
  }: {
    currentPage: number;
    totalPages: number;
    canGoPrev: boolean;
    canGoNext: boolean;
    currentScale: number;
    onPrev: () => void;
    onNext: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
  } = $props();

  // ズームボタンのdisabled状態
  const canZoomOut = $derived(currentScale > 1);
  const canZoomIn = $derived(currentScale < 5);
</script>

<div class="flex items-center justify-between gap-4 p-4 bg-white border-t border-gray-200">
  <!-- 左側のスペーサー（レイアウトバランス用） -->
  <div class="flex-1"></div>

  <!-- ページネーションコントロール（中央） -->
  <div class="flex items-center gap-4 flex-1 justify-center">
    <button
      onclick={onPrev}
      disabled={!canGoPrev}
      class="flex items-center justify-center px-4 py-3 min-w-11 bg-blue-500 text-white rounded-lg hover:bg-blue-600 active:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors touch-manipulation"
      aria-label="Previous page"
    >
      <ChevronLeft size={20} />
    </button>

    <span class="text-sm md:text-base text-gray-600 whitespace-nowrap font-medium min-w-20 text-center tabular-nums">
      {currentPage + 1} / {totalPages}
    </span>

    <button
      onclick={onNext}
      disabled={!canGoNext}
      class="flex items-center justify-center px-4 py-3 min-w-11 bg-blue-500 text-white rounded-lg hover:bg-blue-600 active:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors touch-manipulation"
      aria-label="Next page"
    >
      <ChevronRight size={20} />
    </button>
  </div>

  <!-- ズームコントロール（右側） -->
  <div class="flex items-center gap-2 flex-1 justify-end">
    <button
      onclick={onZoomOut}
      disabled={!canZoomOut}
      class="flex items-center justify-center p-3 min-w-11 bg-gray-500 text-white rounded-lg hover:bg-gray-600 active:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors touch-manipulation"
      aria-label="Zoom out"
    >
      <ZoomOut size={20} />
    </button>
    <button
      onclick={onZoomIn}
      disabled={!canZoomIn}
      class="flex items-center justify-center p-3 min-w-11 bg-gray-500 text-white rounded-lg hover:bg-gray-600 active:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors touch-manipulation"
      aria-label="Zoom in"
    >
      <ZoomIn size={20} />
    </button>
  </div>
</div>
