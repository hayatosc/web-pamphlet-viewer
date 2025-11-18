<svelte:options customElement="pamphlet-viewer" />

<script lang="ts">
  import { onMount } from 'svelte';
  import type { Metadata, Page } from '../types/metadata';
  import { TileLoader } from '../lib/tile-loader';
  import { CanvasRenderer } from '../lib/canvas-renderer';
  import { calculateViewportBounds, getVisibleTiles } from '../lib/viewport';
  import { TouchHandler } from '../lib/touch-handler';
  import { createApiClient } from '../lib/api-client';

  // Props (attributes)
  let {
    'pamphlet-id': pamphletId = '',
    'api-base': apiBase = ''
  }: {
    'pamphlet-id'?: string;
    'api-base'?: string;
  } = $props();

  // State
  let metadata = $state<Metadata | null>(null);
  let currentPage = $state(0);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let canvasContainer = $state<HTMLDivElement | null>(null);
  let renderer = $state<CanvasRenderer | null>(null);
  let tileLoader = $state<TileLoader | null>(null);
  let touchHandler = $state<TouchHandler | null>(null);
  let loadingTiles = $state(0);
  let totalTiles = $state(0);

  // Computed
  const currentPageData = $derived(
    metadata?.pages.find(p => p.page === currentPage) ?? null
  );

  const totalPages = $derived(metadata?.pages.length ?? 0);

  const canGoNext = $derived(currentPage < totalPages - 1);
  const canGoPrev = $derived(currentPage > 0);

  /**
   * URLパラメータからページ番号を取得
   */
  function getPageFromUrl(): number {
    const params = new URLSearchParams(window.location.search);
    const page = params.get('page');
    return page ? Math.max(0, parseInt(page, 10) - 1) : 0;
  }

  /**
   * URLパラメータを更新
   */
  function updateUrlParam(page: number): void {
    const url = new URL(window.location.href);
    url.searchParams.set('page', (page + 1).toString());
    window.history.replaceState({}, '', url.toString());
  }

  /**
   * メタデータを取得
   */
  async function fetchMetadata(): Promise<void> {
    try {
      const client = createApiClient(apiBase);
      const res = await (client.pamphlet as any)[':id'].metadata.$get({
        param: { id: pamphletId }
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch metadata: ${res.statusText}`);
      }

      const data = await res.json();
      metadata = {
        version: data.version,
        tile_size: data.tile_size,
        pages: data.pages
      };

      // URLパラメータからページ番号を取得
      const urlPage = getPageFromUrl();
      if (metadata && urlPage < metadata.pages.length) {
        currentPage = urlPage;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load metadata';
      console.error('Metadata fetch error:', err);
    }
  }

  /**
   * ページを初期化
   */
  async function initializePage(pageData: Page): Promise<void> {
    if (!canvasElement || !tileLoader) return;

    // Rendererを初期化
    if (!renderer) {
      renderer = new CanvasRenderer(canvasElement, metadata!.tile_size);
    }

    // Canvasサイズを設定
    renderer.initCanvas(pageData.width, pageData.height);

    // タイルを読み込み
    await loadPageTiles(pageData);
  }

  /**
   * ページのタイルを読み込み
   */
  async function loadPageTiles(pageData: Page): Promise<void> {
    if (!renderer || !tileLoader || !canvasElement) return;

    loading = true;
    loadingTiles = 0;
    totalTiles = pageData.tiles.length;

    try {
      // viewport計算
      const bounds = calculateViewportBounds(canvasElement, metadata!.tile_size);
      const visibleTiles = getVisibleTiles(pageData.tiles, bounds);
      const remainingTiles = pageData.tiles.filter(
        t => !visibleTiles.find(vt => vt.x === t.x && vt.y === t.y)
      );

      // プレースホルダー描画
      pageData.tiles.forEach(tile => {
        renderer!.drawPlaceholder(tile);
      });

      // 優先的に可視タイルを読み込み
      for (const tile of visibleTiles) {
        try {
          const img = await tileLoader.loadTile(tile, 10);
          renderer.drawTile(tile, img);
          loadingTiles++;
        } catch (err) {
          console.error(`Failed to load visible tile ${tile.x},${tile.y}:`, err);
        }
      }

      // 残りのタイルを読み込み
      for (const tile of remainingTiles) {
        try {
          const img = await tileLoader.loadTile(tile, 1);
          renderer.drawTile(tile, img);
          loadingTiles++;
        } catch (err) {
          console.error(`Failed to load tile ${tile.x},${tile.y}:`, err);
        }
      }
    } catch (err) {
      console.error('Failed to load tiles:', err);
      error = 'Failed to load page tiles';
    } finally {
      loading = false;
    }
  }

  /**
   * ページ遷移
   */
  async function goToPage(page: number): Promise<void> {
    if (page < 0 || page >= totalPages || !metadata) return;

    currentPage = page;
    updateUrlParam(page);

    const pageData = metadata.pages.find(p => p.page === page);
    if (pageData) {
      await initializePage(pageData);
    }
  }

  /**
   * 次ページへ
   */
  function nextPage(): void {
    if (canGoNext) {
      goToPage(currentPage + 1);
    }
  }

  /**
   * 前ページへ
   */
  function prevPage(): void {
    if (canGoPrev) {
      goToPage(currentPage - 1);
    }
  }

  /**
   * ズーム処理
   */
  async function handleZoom(scale: number): Promise<void> {
    if (!renderer || !currentPageData) return;

    renderer.setScale(scale);
    touchHandler?.setScale(scale);

    // 再描画
    await redrawCurrentPage();
  }

  /**
   * パン処理
   */
  async function handlePan(deltaX: number, deltaY: number): Promise<void> {
    if (!renderer || !currentPageData) return;

    renderer.pan(deltaX, deltaY);

    // 再描画
    await redrawCurrentPage();
  }

  /**
   * ダブルタップ処理（ズームリセット）
   */
  async function handleDoubleTap(): Promise<void> {
    if (!renderer || !currentPageData) return;

    renderer.resetTransform();
    touchHandler?.setScale(1);

    // 再描画
    await redrawCurrentPage();
  }

  /**
   * 現在のページを再描画
   */
  async function redrawCurrentPage(): Promise<void> {
    if (!renderer || !currentPageData || !tileLoader) return;

    renderer.clear();

    // すべてのタイルを再描画
    for (const tile of currentPageData.tiles) {
      try {
        const img = await tileLoader.loadTile(tile, 5);
        renderer.drawTile(tile, img);
      } catch (err) {
        console.error(`Failed to redraw tile ${tile.x},${tile.y}:`, err);
      }
    }
  }

  /**
   * キーボードイベント
   */
  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowLeft') {
      prevPage();
    } else if (e.key === 'ArrowRight') {
      nextPage();
    }
  }

  // 初期化
  onMount(async () => {
    // TileLoaderを初期化
    tileLoader = new TileLoader(apiBase, pamphletId, 6);

    // TouchHandlerを初期化
    if (canvasContainer) {
      touchHandler = new TouchHandler(canvasContainer, {
        onZoom: handleZoom,
        onPan: handlePan,
        onSwipeLeft: nextPage,
        onSwipeRight: prevPage,
        onDoubleTap: handleDoubleTap
      });
    }

    // メタデータ取得
    await fetchMetadata();

    if (metadata && currentPageData) {
      await initializePage(currentPageData);
    }

    loading = false;

    // キーボードイベント
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      touchHandler?.destroy();
    };
  });

  // ページ変更時
  $effect(() => {
    if (metadata && currentPageData && renderer) {
      initializePage(currentPageData);
    }
  });
</script>

<div class="relative w-full h-full flex flex-col bg-gray-50">
  {#if loading && !metadata}
    <div class="flex items-center justify-center w-full h-full">
      <div class="text-center">
        <div class="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p class="mt-4 text-gray-600">Loading pamphlet...</p>
      </div>
    </div>
  {:else if error}
    <div class="flex items-center justify-center w-full h-full">
      <div class="text-center text-red-600">
        <p class="text-lg font-semibold">Error</p>
        <p class="mt-2">{error}</p>
      </div>
    </div>
  {:else if metadata && currentPageData}
    <!-- Canvas container -->
    <div class="flex-1 relative overflow-hidden" bind:this={canvasContainer} style="touch-action: none; -webkit-user-select: none; user-select: none;">
      <div class="absolute inset-0 flex items-center justify-center">
        <canvas
          bind:this={canvasElement}
          class="max-w-full max-h-full shadow-lg"
        ></canvas>
      </div>

      {#if loading}
        <div class="absolute top-4 right-4 bg-white px-4 py-2 rounded-lg shadow-md">
          <p class="text-sm text-gray-600">
            Loading tiles: {loadingTiles} / {totalTiles}
          </p>
        </div>
      {/if}
    </div>

    <!-- Pagination controls -->
    <div class="flex items-center justify-center gap-4 p-4 bg-white border-t border-gray-200">
      <button
        onclick={prevPage}
        disabled={!canGoPrev}
        class="px-6 py-3 min-w-[100px] bg-blue-500 text-white rounded-lg hover:bg-blue-600 active:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors touch-manipulation"
      >
        Previous
      </button>

      <span class="text-sm md:text-base text-gray-600 whitespace-nowrap">
        Page {currentPage + 1} / {totalPages}
      </span>

      <button
        onclick={nextPage}
        disabled={!canGoNext}
        class="px-6 py-3 min-w-[100px] bg-blue-500 text-white rounded-lg hover:bg-blue-600 active:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors touch-manipulation"
      >
        Next
      </button>
    </div>
  {/if}
</div>
