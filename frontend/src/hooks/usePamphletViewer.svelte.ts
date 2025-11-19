import { hc } from 'hono/client';
import type { AppType } from 'workers';
import { CanvasRenderer } from '../lib/canvas-renderer';
import { TileLoader } from '../lib/tile-loader';
import type { Metadata, Page, Tile } from '../types/metadata';

/**
 * 見開き情報
 */
interface SpreadInfo {
  leftPage: number | null;
  rightPage: number | null;
  isCover: boolean; // 表紙または裏表紙
}

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
  let isSpreadMode = $state(false); // 見開きモード（md以上で有効）

  // Computed values
  const currentPageData = $derived(metadata?.pages.find((p) => p.page === currentPage) ?? null);
  const totalPages = $derived(totalPagesCount || metadata?.pages.length || 0);

  /**
   * 現在の見開き情報を計算
   */
  const currentSpread = $derived<SpreadInfo>(
    !isSpreadMode || totalPages === 0
      ? {
          leftPage: null,
          rightPage: currentPage,
          isCover: false,
        }
      : currentPage === 0
        ? {
            leftPage: null,
            rightPage: 0,
            isCover: true,
          }
        : currentPage === totalPages - 1
          ? {
              leftPage: totalPages - 1,
              rightPage: null,
              isCover: true,
            }
          : (() => {
              const isOddPage = currentPage % 2 === 1;
              // 裏表紙の1つ前のページが見開きに含まれないようにする
              if (isOddPage && currentPage + 1 >= totalPages - 1) {
                // 奇数ページで、次のページが裏表紙になる場合は単独表示
                return {
                  leftPage: currentPage,
                  rightPage: null,
                  isCover: false,
                };
              }
              return {
                leftPage: isOddPage ? currentPage : currentPage - 1,
                rightPage: isOddPage ? currentPage + 1 : currentPage,
                isCover: false,
              };
            })()
  );

  const canGoNext = $derived(
    !isSpreadMode
      ? currentPage < totalPages - 1
      : (() => {
          const spread = currentSpread;
          const nextPage = spread.rightPage !== null ? spread.rightPage + 1 : (spread.leftPage ?? 0) + 1;
          return nextPage < totalPages;
        })()
  );

  const canGoPrev = $derived(
    !isSpreadMode
      ? currentPage > 0
      : (() => {
          const spread = currentSpread;
          const prevPage = spread.leftPage !== null ? spread.leftPage - 1 : (spread.rightPage ?? 0) - 1;
          return prevPage >= 0;
        })()
  );

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
   * 見開きモードを設定
   */
  function setSpreadMode(enabled: boolean): void {
    isSpreadMode = enabled;
  }

  /**
   * 隣接ページをプリフェッチ（バックグラウンド）
   */
  function prefetchAdjacentPages(currentPageNum: number): void {
    if (!metadata || !tileLoader || !renderer) return;

    // プリフェッチ対象: 前後1ページ（見開きモードの場合は前後の見開き）
    const pagesToPrefetch = isSpreadMode
      ? [currentPageNum - 2, currentPageNum - 1, currentPageNum + 1, currentPageNum + 2]
      : [currentPageNum - 1, currentPageNum + 1];

    pagesToPrefetch.forEach((pageNum) => {
      // 範囲チェック
      if (pageNum < 0 || pageNum >= totalPagesCount) return;

      // すでにCanvasキャッシュされているかチェック
      const cacheStats = renderer!.getCacheStats();
      if (cacheStats.pages.includes(pageNum)) {
        console.log(`[prefetch] Page ${pageNum} already cached, skipping`);
        return;
      }

      // メタデータが取得済みかチェック
      const pageData = metadata!.pages.find((p) => p.page === pageNum);
      if (!pageData) {
        console.log(`[prefetch] Page ${pageNum} metadata not loaded yet, skipping`);
        return;
      }

      // バックグラウンドでタイルをプリフェッチ（低優先度: 1）
      console.log(`[prefetch] Prefetching page ${pageNum} (${pageData.tiles.length} tiles)`);
      (async () => {
        try {
          const tiles: Array<{ tile: Tile; img: HTMLImageElement }> = await Promise.all(
            pageData.tiles.map(async (tile) => ({
              tile,
              img: await tileLoader!.loadTile(tile, 1), // 低優先度
            }))
          );

          // プリフェッチしたページをCanvasキャッシュに保存
          // 一時的なOffscreenCanvasを使用
          const offscreen = new OffscreenCanvas(pageData.width, pageData.height);
          const ctx = offscreen.getContext('2d');
          if (!ctx) return;

          // 背景
          ctx.fillStyle = '#f9fafb';
          ctx.fillRect(0, 0, pageData.width, pageData.height);

          // タイル描画
          const tileSize = metadata!.tile_size;
          for (const { tile, img } of tiles) {
            const x = tile.x * tileSize;
            const y = tile.y * tileSize;
            ctx.drawImage(img, x, y, tileSize, tileSize);
          }

          // ページキャッシュに保存
          renderer!['pageCache'].set(pageNum, offscreen);
          console.log(`[prefetch] Page ${pageNum} cached successfully`);
        } catch (err) {
          console.error(`[prefetch] Failed to prefetch page ${pageNum}:`, err);
        }
      })();
    });
  }

  /**
   * ページを初期化（見開き対応）
   */
  async function initializePage(pageData: Page, canvasElement: HTMLCanvasElement): Promise<void> {
    if (!tileLoader || !metadata) return;

    // Rendererを初期化
    if (!renderer) {
      renderer = new CanvasRenderer(canvasElement, metadata.tile_size, 5); // キャッシュサイズ5
    }

    // 見開きモードかチェック
    const spread = currentSpread;

    if (isSpreadMode && spread.leftPage !== null && spread.rightPage !== null) {
      // 見開きモード: 2ページ分を描画
      const leftPageData = metadata.pages.find((p) => p.page === spread.leftPage);
      const rightPageData = metadata.pages.find((p) => p.page === spread.rightPage);

      if (leftPageData && rightPageData) {
        await loadSpreadTiles(leftPageData, rightPageData);
        prefetchAdjacentPages(currentPage);
        return;
      }
    }

    // 単ページモード（または表紙・裏表紙）
    // キャッシュチェック: キャッシュされている場合は即座に表示
    const cacheStats = renderer.getCacheStats();
    if (cacheStats.pages.includes(pageData.page)) {
      console.log(`[usePamphletViewer] Page ${pageData.page} is cached, rendering immediately`);

      // loading状態をfalseに設定（即座に表示）
      loading = false;

      // タイルの再取得は不要、Canvasキャッシュから直接描画
      // 空の配列を渡すことで、renderPageはキャッシュから復元する
      renderer.renderPage(pageData.page, pageData.width, pageData.height, []);

      // プリフェッチ: 次のページを先読み
      prefetchAdjacentPages(pageData.page);
      return;
    }

    // キャッシュにない場合: タイルを読み込み
    await loadPageTiles(pageData);

    // 読み込み完了後、隣接ページをプリフェッチ
    prefetchAdjacentPages(pageData.page);
  }

  /**
   * ページのタイルを読み込み（初回描画用）
   */
  async function loadPageTiles(pageData: Page): Promise<void> {
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
   * 見開きのタイルを読み込み（2ページ分）
   */
  async function loadSpreadTiles(leftPageData: Page, rightPageData: Page): Promise<void> {
    if (!renderer || !tileLoader) return;

    // 前のページの描画をキャンセル
    if (abortController) {
      abortController.abort();
      console.log('[usePamphletViewer] Previous spread rendering cancelled');
    }

    // 新しいAbortControllerを作成
    abortController = new AbortController();
    const signal = abortController.signal;

    loading = true;
    loadingTiles = 0;
    totalTiles = leftPageData.tiles.length + rightPageData.tiles.length;

    try {
      // 左右のページのタイルを並列で読み込み
      const leftTiles: Array<{ tile: Tile; img: HTMLImageElement }> = [];
      const rightTiles: Array<{ tile: Tile; img: HTMLImageElement }> = [];

      // 左ページのタイル読み込み
      for (const tile of leftPageData.tiles) {
        if (signal.aborted) {
          console.log('[usePamphletViewer] Spread tile loading aborted');
          return;
        }

        try {
          const img = await tileLoader.loadTile(tile, 10);
          leftTiles.push({ tile, img });
          loadingTiles++;
        } catch (err) {
          if (signal.aborted) return;
          console.error(`Failed to load left tile ${tile.x},${tile.y}:`, err);
        }
      }

      // 右ページのタイル読み込み
      for (const tile of rightPageData.tiles) {
        if (signal.aborted) {
          console.log('[usePamphletViewer] Spread tile loading aborted');
          return;
        }

        try {
          const img = await tileLoader.loadTile(tile, 10);
          rightTiles.push({ tile, img });
          loadingTiles++;
        } catch (err) {
          if (signal.aborted) return;
          console.error(`Failed to load right tile ${tile.x},${tile.y}:`, err);
        }
      }

      // キャンセルチェック（描画前）
      if (signal.aborted) {
        console.log('[usePamphletViewer] Spread rendering aborted before draw');
        return;
      }

      // 見開きを描画
      renderer.renderSpread(leftPageData, rightPageData, leftTiles, rightTiles);

      console.log(`[usePamphletViewer] Spread (${leftPageData.page}, ${rightPageData.page}) rendered`);
    } catch (err) {
      if (signal.aborted) {
        console.log('Spread tile loading cancelled');
        return;
      }
      console.error('Failed to load spread tiles:', err);
      error = 'Failed to load spread tiles';
    } finally {
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

    let pageData = metadata.pages.find((p) => p.page === page);

    // メタデータが未ロードの場合は取得
    if (!pageData) {
      console.log(`[goToPage] Page ${page} metadata not loaded, fetching...`);
      loading = true;

      try {
        await fetchMetadataRange(page, page);
        pageData = metadata.pages.find((p) => p.page === page);
      } catch (err) {
        console.error(`Failed to fetch metadata for page ${page}:`, err);
        error = 'Failed to load page metadata';
        loading = false;
        return;
      }
    }

    if (pageData) {
      await initializePage(pageData, canvasElement);
    }
  }

  /**
   * 次ページへ（見開き対応）
   */
  function nextPage(canvasElement: HTMLCanvasElement): void {
    if (!canGoNext) return;

    if (!isSpreadMode) {
      goToPage(currentPage + 1, canvasElement);
      return;
    }

    // 見開きモード: 次の見開きへ
    const spread = currentSpread;

    if (currentPage === 0) {
      // 表紙の次 → ページ1
      goToPage(1, canvasElement);
    } else if (spread.rightPage !== null) {
      // 見開きの次 → 右ページの次
      goToPage(spread.rightPage + 1, canvasElement);
    } else if (spread.leftPage !== null) {
      // 裏表紙（左のみ）の次はなし
      // canGoNextがfalseのはずなので、ここには来ないはず
    }
  }

  /**
   * 前ページへ（見開き対応）
   */
  function prevPage(canvasElement: HTMLCanvasElement): void {
    if (!canGoPrev) return;

    if (!isSpreadMode) {
      goToPage(currentPage - 1, canvasElement);
      return;
    }

    // 見開きモード: 前の見開きへ
    const spread = currentSpread;

    if (currentPage === totalPages - 1) {
      // 裏表紙の前 → 最後の見開きの左ページ
      const lastContentPage = totalPages - 2;
      // 最後のコンテンツページが属する見開きの左ページを計算
      const lastSpreadLeftPage = lastContentPage % 2 === 1 ? lastContentPage : lastContentPage - 1;
      goToPage(lastSpreadLeftPage, canvasElement);
    } else if (spread.leftPage !== null && spread.leftPage === 0) {
      // ページ0（表紙）の前はなし
      // canGoPrevがfalseのはずなので、ここには来ないはず
    } else if (spread.leftPage !== null) {
      // 見開きの前 → 左ページの前
      goToPage(spread.leftPage - 1, canvasElement);
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
    get isSpreadMode() {
      return isSpreadMode;
    },

    // Computed
    get currentPageData() {
      return currentPageData;
    },
    get currentSpread() {
      return currentSpread;
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
    setSpreadMode,
  };
}
