import { createApiClient } from '../lib/api-client';
import { TileLoader } from '../lib/tile-loader';
import { CanvasRenderer } from '../lib/canvas-renderer';
import { calculateViewportBounds, getVisibleTiles } from '../lib/viewport';
import type { Metadata, Page } from '../types/metadata';

/**
 * パンフレットビューアのロジックを管理するhook
 */
export function usePamphletViewer(apiBase: string, pamphletId: string) {
  let metadata = $state<Metadata | null>(null);
  let totalPagesCount = $state(0); // 全ページ数
  let currentPage = $state(0);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let renderer = $state<CanvasRenderer | null>(null);
  let tileLoader = $state<TileLoader | null>(null);
  let loadingTiles = $state(0);
  let totalTiles = $state(0);
  let fetchingPages = $state(false); // バックグラウンドフェッチ中

  // Computed values
  const currentPageData = $derived(
    metadata?.pages.find(p => p.page === currentPage) ?? null
  );
  const totalPages = $derived(totalPagesCount || metadata?.pages.length || 0);
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
   * メタデータを範囲指定で取得
   */
  async function fetchMetadataRange(start: number, end: number): Promise<void> {
    try {
      const client = createApiClient(apiBase);
      const res = await client.pamphlet[':id'].metadata.$get({
        param: { id: pamphletId },
        query: { pages: `${start}-${end}` }
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch metadata: ${res.statusText}`);
      }

      const data = await res.json();

      // 全ページ数を保存
      totalPagesCount = data.total_pages;

      if (!metadata) {
        // 初回取得
        metadata = {
          version: data.version,
          tile_size: data.tile_size,
          pages: data.pages
        };
      } else {
        // 追加取得: 既存のページにマージ
        const newPages = data.pages.filter(
          (newPage: Page) => !metadata!.pages.find(p => p.page === newPage.page)
        );
        metadata.pages = [...metadata.pages, ...newPages].sort((a, b) => a.page - b.page);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load metadata';
      console.error('Metadata fetch error:', err);
      throw err;
    }
  }

  /**
   * 初回メタデータ取得（最初の数ページのみ）
   */
  async function fetchInitialMetadata(): Promise<void> {
    const initialPageCount = 6; // 最初に取得するページ数
    const urlPage = getPageFromUrl();
    const startPage = Math.max(0, urlPage - 2);
    const endPage = startPage + initialPageCount - 1;

    await fetchMetadataRange(startPage, endPage);

    // URLパラメータからページ番号を設定
    if (metadata && urlPage < totalPagesCount) {
      currentPage = urlPage;
    }
  }

  /**
   * 残りのメタデータをバックグラウンドで取得
   */
  async function fetchRemainingMetadata(): Promise<void> {
    if (!metadata || fetchingPages) return;

    const loadedPages = metadata.pages.length;
    if (loadedPages >= totalPagesCount) return; // 全ページ取得済み

    fetchingPages = true;

    try {
      // Cloudflareなので大きめのバッチで効率的に取得
      const batchSize = 50;
      const maxPage = metadata.pages[loadedPages - 1].page;

      for (let start = maxPage + 1; start < totalPagesCount; start += batchSize) {
        const end = Math.min(start + batchSize - 1, totalPagesCount - 1);
        await fetchMetadataRange(start, end);
      }

      console.log(`All ${totalPagesCount} pages metadata loaded`);
    } catch (err) {
      console.error('Failed to fetch remaining metadata:', err);
    } finally {
      fetchingPages = false;
    }
  }

  /**
   * ページを初期化
   */
  async function initializePage(
    pageData: Page,
    canvasElement: HTMLCanvasElement
  ): Promise<void> {
    if (!tileLoader) return;

    // Rendererを初期化
    if (!renderer) {
      renderer = new CanvasRenderer(canvasElement, metadata!.tile_size);
    }

    // Canvasサイズを設定
    renderer.initCanvas(pageData.width, pageData.height);

    // タイルを読み込み
    await loadPageTiles(pageData, canvasElement);
  }

  /**
   * ページのタイルを読み込み
   */
  async function loadPageTiles(
    pageData: Page,
    canvasElement: HTMLCanvasElement
  ): Promise<void> {
    if (!renderer || !tileLoader) return;

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
  async function goToPage(page: number, canvasElement: HTMLCanvasElement): Promise<void> {
    if (page < 0 || page >= totalPages || !metadata) return;

    currentPage = page;
    updateUrlParam(page);

    const pageData = metadata.pages.find(p => p.page === page);
    if (pageData) {
      await initializePage(pageData, canvasElement);
    }
  }

  /**
   * 次ページへ
   */
  function nextPage(canvasElement: HTMLCanvasElement): void {
    if (canGoNext) {
      goToPage(currentPage + 1, canvasElement);
    }
  }

  /**
   * 前ページへ
   */
  function prevPage(canvasElement: HTMLCanvasElement): void {
    if (canGoPrev) {
      goToPage(currentPage - 1, canvasElement);
    }
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
   * 初期化
   */
  function initialize() {
    tileLoader = new TileLoader(apiBase, pamphletId, 6);
  }

  return {
    // State
    get metadata() { return metadata; },
    get currentPage() { return currentPage; },
    get loading() { return loading; },
    get error() { return error; },
    get renderer() { return renderer; },
    get loadingTiles() { return loadingTiles; },
    get totalTiles() { return totalTiles; },
    get fetchingPages() { return fetchingPages; },

    // Computed
    get currentPageData() { return currentPageData; },
    get totalPages() { return totalPages; },
    get canGoNext() { return canGoNext; },
    get canGoPrev() { return canGoPrev; },

    // Methods
    initialize,
    fetchInitialMetadata,
    fetchRemainingMetadata,
    initializePage,
    goToPage,
    nextPage,
    prevPage,
    redrawCurrentPage
  };
}
