<svelte:options customElement="pamphlet-viewer" />

<script lang="ts">
  import { onMount } from 'svelte';
  import { usePamphletViewer } from '../hooks/usePamphletViewer';
  import { useTouchGestures } from '../hooks/useTouchGestures';
  import ViewerCanvas from './ViewerCanvas.svelte';
  import PaginationControls from './PaginationControls.svelte';
  import LoadingOverlay from './LoadingOverlay.svelte';

  // Props (attributes)
  let {
    'pamphlet-id': pamphletId = '',
    'api-base': apiBase = ''
  }: {
    'pamphlet-id'?: string;
    'api-base'?: string;
  } = $props();

  // Canvas elements
  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let containerElement = $state<HTMLDivElement | null>(null);

  // Pamphlet logic
  const viewer = usePamphletViewer(apiBase, pamphletId);

  // Touch gestures (initialized in effect)
  let touchGestures = $state<ReturnType<typeof useTouchGestures> | null>(null);

  /**
   * キーボードイベント
   */
  function handleKeydown(e: KeyboardEvent): void {
    if (!canvasElement) return;

    if (e.key === 'ArrowLeft') {
      viewer.prevPage(canvasElement);
    } else if (e.key === 'ArrowRight') {
      viewer.nextPage(canvasElement);
    }
  }

  // 初期化
  onMount(() => {
    // 初期化
    viewer.initialize();

    // メタデータ取得（非同期）
    (async () => {
      // 最初の数ページのみ取得
      await viewer.fetchInitialMetadata();

      if (viewer.metadata && viewer.currentPageData && canvasElement) {
        await viewer.initializePage(viewer.currentPageData, canvasElement);
      }

      // バックグラウンドで残りのページを取得
      viewer.fetchRemainingMetadata();
    })();

    // タッチジェスチャー初期化
    if (containerElement) {
      touchGestures = useTouchGestures(
        containerElement,
        viewer.renderer,
        () => canvasElement && viewer.nextPage(canvasElement),
        () => canvasElement && viewer.prevPage(canvasElement),
        () => viewer.redrawCurrentPage()
      );
      touchGestures.initialize();
    }

    // キーボードイベント
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      touchGestures?.cleanup();
    };
  });

  // ページ変更時
  $effect(() => {
    if (viewer.metadata && viewer.currentPageData && viewer.renderer && canvasElement) {
      viewer.initializePage(viewer.currentPageData, canvasElement);
    }
  });
</script>

<div class="relative w-full h-full flex flex-col bg-gray-50">
  {#if !viewer.metadata && (viewer.loading || viewer.error)}
    <LoadingOverlay
      loading={viewer.loading}
      error={viewer.error}
    />
  {:else if viewer.metadata && viewer.currentPageData}
    <ViewerCanvas
      bind:canvasElement
      bind:containerElement
    />

    <LoadingOverlay
      loading={viewer.loading}
      loadingTiles={viewer.loadingTiles}
      totalTiles={viewer.totalTiles}
    />

    <PaginationControls
      currentPage={viewer.currentPage}
      totalPages={viewer.totalPages}
      canGoPrev={viewer.canGoPrev}
      canGoNext={viewer.canGoNext}
      onPrev={() => canvasElement && viewer.prevPage(canvasElement)}
      onNext={() => canvasElement && viewer.nextPage(canvasElement)}
    />
  {/if}
</div>
