<script lang="ts">
  import { ChevronLeft, ChevronRight } from 'lucide-svelte';

  /**
   * ページネーションコントロール
   */
  let {
    currentPage,
    totalPages,
    canGoPrev,
    canGoNext,
    onPrev,
    onNext
  }: {
    currentPage: number;
    totalPages: number;
    canGoPrev: boolean;
    canGoNext: boolean;
    onPrev: () => void;
    onNext: () => void;
  } = $props();
</script>

<div class="flex items-center justify-center gap-4 p-4 bg-white border-t border-gray-200">
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
