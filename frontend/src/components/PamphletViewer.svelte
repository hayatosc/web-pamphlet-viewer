<svelte:options customElement={{ tag: "pamphlet-viewer", shadow: "none" }} />

<script lang="ts">
  import { onMount } from 'svelte';
  import { usePamphletViewer } from '../hooks/usePamphletViewer.svelte';
  import { useTouchGestures } from '../hooks/useTouchGestures.svelte';
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

  // Media query for spread mode (md以上で見開き表示)
  let mediaQuery = $state<MediaQueryList | null>(null);

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

    // 見開きモードの監視（mdブレークポイント: 768px）
    mediaQuery = window.matchMedia('(min-width: 768px)');
    const handleMediaChange = (e: MediaQueryListEvent | MediaQueryList) => {
      viewer.setSpreadMode(e.matches);

      // 見開きモードが切り替わった場合、現在のページを再描画
      if (viewer.metadata && canvasElement) {
        const pageData = viewer.currentPageData;
        if (pageData) {
          viewer.initializePage(pageData, canvasElement);
        }
      }
    };

    // 初回チェック
    handleMediaChange(mediaQuery);

    // リサイズ時の監視
    mediaQuery.addEventListener('change', handleMediaChange);

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

    // キーボードイベント
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      if (mediaQuery) {
        mediaQuery.removeEventListener('change', handleMediaChange);
      }
    };
  });

  // タッチジェスチャー初期化（containerElementとrendererが準備できた後）
  $effect(() => {
    if (containerElement && viewer.renderer) {
      const gestures = useTouchGestures(
        containerElement,
        viewer.renderer,
        () => canvasElement && viewer.nextPage(canvasElement),
        () => canvasElement && viewer.prevPage(canvasElement),
        () => viewer.redrawCurrentPage()
      );
      gestures.initialize();
      touchGestures = gestures;

      return () => {
        gestures.cleanup();
      };
    }
  });

</script>

<style>
  :global(pamphlet-viewer) {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>

<div class="relative w-full h-full flex flex-col bg-gray-50">
  {#if !viewer.metadata && (viewer.loading || viewer.error)}
    <LoadingOverlay
      loading={viewer.loading}
      error={viewer.error}
    />
  {:else if viewer.metadata}
    <ViewerCanvas
      bind:canvasElement
      bind:containerElement
    />

    <LoadingOverlay
      loading={viewer.loading || !viewer.currentPageData}
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
