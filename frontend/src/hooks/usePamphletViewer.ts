import { hc } from 'hono/client';
import type { AppType } from 'workers';
import { CanvasRenderer } from '../lib/canvas-renderer';
import { TileLoader } from '../lib/tile-loader';
import type { Metadata, Page, Tile } from '../types/metadata';

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
  let abortController = $state<AbortController | null>(null); // タイル読み込みキャンセル用

  // Computed values
  const currentPageData = $derived(metadata?.pages.find((p) => p.page === currentPage) ?? null);
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
      const client = hc<AppType>(apiBase);
      const res = await client.pamphlet[':id'].metadata.$get({
        param: { id: pamphletId },
        query: { pages: `${start}-${end}` },
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
          pages: data.pages,
        };
      } else {
        // 追加取得: 既存のページにマージ
        const newPages = data.pages.filter((newPage: Page) => !metadata!.pages.find((p) => p.page === newPage.page));
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

    // 最初にurlPageのメタデータのみを取得してtotalPagesCountを確認
    await fetchMetadataRange(urlPage, urlPage);

    // totalPagesCountが判明したので、urlPageを検証
    const validatedUrlPage = Math.min(urlPage, Math.max(0, totalPagesCount - 1));

    // 周辺ページを含めた範囲を計算
    const startPage = Math.max(0, validatedUrlPage - 2);
    const endPage = Math.min(startPage + initialPageCount - 1, totalPagesCount - 1);

    // すでに取得済みのurlPage以外のページを取得
    if (endPage > urlPage || startPage < urlPage) {
      await fetchMetadataRange(startPage, endPage);
    }

    // ページ番号を設定（検証済みの値を使用）
    currentPage = validatedUrlPage;

    // URLパラメータが範囲外だった場合は修正
    if (validatedUrlPage !== urlPage) {
      updateUrlParam(validatedUrlPage);
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
  async function initializePage(pageData: Page, canvasElement: HTMLCanvasElement): Promise<void> {
    if (!tileLoader || !metadata) return;

    // Rendererを初期化
    if (!renderer) {
      renderer = new CanvasRenderer(canvasElement, metadata.tile_size, 5); // キャッシュサイズ5
    }

    // キャッシュチェック: キャッシュされている場合は即座に表示
    const cacheStats = renderer.getCacheStats();
    if (cacheStats.pages.includes(pageData.page)) {
      console.log(`[usePamphletViewer] Page ${pageData.page} is cached, rendering immediately`);
      loading = true;

      // すべてのタイルを並列読み込み（キャッシュから高速）
      const tiles: Array<{ tile: Tile; img: HTMLImageElement }> = await Promise.all(
        pageData.tiles.map(async (tile) => ({
          tile,
          img: await tileLoader.loadTile(tile, 10),
        }))
      );

      // ページを描画（キャッシュから復元）
      renderer.renderPage(pageData.page, pageData.width, pageData.height, tiles);
      loading = false;
      return;
    }

    // キャッシュにない場合: タイルを読み込み
    await loadPageTiles(pageData, canvasElement);
  }

  /**
   * ページのタイルを読み込み（初回描画用）
   */
  async function loadPageTiles(pageData: Page, canvasElement: HTMLCanvasElement): Promise<void> {
    if (!renderer || !tileLoader) return;

    // 前のページの描画をキャンセル（タイルダウンロードは続行してキャッシュに保存）
    if (abortController) {
      abortController.abort();
      console.log('[usePamphletViewer] Previous page rendering cancelled');
    }

    // 新しいAbortControllerを作成
    abortController = new AbortController();
    const signal = abortController.signal;

    loading = true;
    loadingTiles = 0;
    totalTiles = pageData.tiles.length;

    try {
      // すべてのタイルを並列で読み込み
      const tiles: Array<{ tile: Tile; img: HTMLImageElement }> = [];

      for (const tile of pageData.tiles) {
        // キャンセルチェック
        if (signal.aborted) {
          console.log('[usePamphletViewer] Tile loading aborted');
          return;
        }

        try {
          const img = await tileLoader.loadTile(tile, 10); // 優先度10
          tiles.push({ tile, img });
          loadingTiles++;
        } catch (err) {
          if (signal.aborted) return;
          console.error(`Failed to load tile ${tile.x},${tile.y}:`, err);
        }
      }

      // キャンセルチェック（描画前）
      if (signal.aborted) {
        console.log('[usePamphletViewer] Rendering aborted before draw');
        return;
      }

      // すべてのタイルが読み込まれたらページを描画（キャッシュに保存）
      renderer.renderPage(pageData.page, pageData.width, pageData.height, tiles);

      console.log(`[usePamphletViewer] Page ${pageData.page} rendered and cached`);
    } catch (err) {
      // キャンセルによる中断は正常なので、エラーログを出さない
      if (signal.aborted) {
        console.log('Page tile loading cancelled');
        return;
      }
      console.error('Failed to load tiles:', err);
      error = 'Failed to load page tiles';
    } finally {
      // キャンセルされていない場合のみloadingをfalseにする
      if (!signal.aborted) {
        loading = false;
      }
    }
  }

  /**
   * ページ遷移
   */
  async function goToPage(page: number, canvasElement: HTMLCanvasElement): Promise<void> {
    if (page < 0 || page >= totalPages || !metadata) return;

    currentPage = page;
    updateUrlParam(page);

    const pageData = metadata.pages.find((p) => p.page === page);
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
    get metadata() {
      return metadata;
    },
    get currentPage() {
      return currentPage;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get renderer() {
      return renderer;
    },
    get loadingTiles() {
      return loadingTiles;
    },
    get totalTiles() {
      return totalTiles;
    },
    get fetchingPages() {
      return fetchingPages;
    },

    // Computed
    get currentPageData() {
      return currentPageData;
    },
    get totalPages() {
      return totalPages;
    },
    get canGoNext() {
      return canGoNext;
    },
    get canGoPrev() {
      return canGoPrev;
    },

    // Methods
    initialize,
    fetchInitialMetadata,
    fetchRemainingMetadata,
    initializePage,
    goToPage,
    nextPage,
    prevPage,
    redrawCurrentPage,
  };
}
