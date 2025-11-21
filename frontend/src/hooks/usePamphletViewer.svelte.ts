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

    if (isSpreadMode) {
      // 見開きモード: 前後の見開きをプリフェッチ
      const currentSpreadInfo = getSpreadForPage(currentPageNum);

      // 前の見開き
      if (currentSpreadInfo.leftPage !== null && currentSpreadInfo.leftPage >= 2) {
        const prevLeftPage = currentSpreadInfo.leftPage - 2;
        const prevRightPage = currentSpreadInfo.leftPage - 1;
        prefetchPages([prevLeftPage, prevRightPage]);
      } else if (currentSpreadInfo.leftPage === 1) {
        // 表紙（ページ0）をプリフェッチ
        prefetchPages([0]);
      }

      // 次の見開き
      if (currentSpreadInfo.rightPage !== null && currentSpreadInfo.rightPage < totalPagesCount - 2) {
        const nextLeftPage = currentSpreadInfo.rightPage + 1;
        const nextRightPage = currentSpreadInfo.rightPage + 2;
        prefetchPages([nextLeftPage, nextRightPage]);
      } else if (currentSpreadInfo.rightPage === totalPagesCount - 2) {
        // 裏表紙（最終ページ）をプリフェッチ
        prefetchPages([totalPagesCount - 1]);
      }
    } else {
      // 単ページモード: 前後1ページをプリフェッチ
      if (currentPageNum - 1 >= 0) {
        prefetchPages([currentPageNum - 1]);
      }
      if (currentPageNum + 1 < totalPagesCount) {
        prefetchPages([currentPageNum + 1]);
      }
    }
  }

  /**
   * ページをプリフェッチ（単ページまたは見開き）
   * @param pages - プリフェッチするページ番号の配列（1ページまたは2ページ）
   */
  function prefetchPages(pages: number[]): void {
    if (!metadata || !tileLoader || !renderer) return;
    if (pages.length === 0) return;

    // キャッシュキーを計算（単ページ: そのまま、見開き: 負の値）
    const cacheKey = pages.length === 1 ? pages[0] : -(pages[0] + 1);

    // すでにキャッシュされているかチェック
    const cacheStats = renderer.getCacheStats();
    if (cacheStats.pages.includes(cacheKey)) {
      console.log(`[prefetch] Pages [${pages.join(', ')}] already cached, skipping`);
      return;
    }

    // メタデータが取得済みかチェック
    const pagesData = pages
      .map((pageNum) => metadata!.pages.find((p) => p.page === pageNum))
      .filter((p): p is Page => p !== undefined);

    if (pagesData.length !== pages.length) {
      console.log(`[prefetch] Pages [${pages.join(', ')}] metadata not loaded yet, skipping`);
      return;
    }

    // バックグラウンドでタイルをプリフェッチ（低優先度: 1）
    const totalTiles = pagesData.reduce((sum, page) => sum + page.tiles.length, 0);
    console.log(`[prefetch] Prefetching pages [${pages.join(', ')}] (${totalTiles} tiles)`);

    (async () => {
      try {
        // すべてのページのタイルを並列でプリフェッチ
        const allTiles = await Promise.all(
          pagesData.flatMap((pageData, pageIndex) =>
            pageData.tiles.map(async (tile) => ({
              tile,
              img: await tileLoader!.loadTile(tile, 1), // 低優先度
              pageIndex,
            }))
          )
        );

        // Canvasサイズを計算
        const canvasWidth =
          pagesData.length === 1
            ? pagesData[0].width
            : pagesData.reduce((sum, page) => sum + page.width, 0);
        const canvasHeight = Math.max(...pagesData.map((page) => page.height));

        // OffscreenCanvasに描画
        const offscreen = new OffscreenCanvas(canvasWidth, canvasHeight);
        const ctx = offscreen.getContext('2d');
        if (!ctx) return;

        // 背景
        ctx.fillStyle = '#f9fafb';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // タイル描画
        const tileSize = metadata!.tile_size;
        let xOffset = 0;

        for (const { tile, img, pageIndex } of allTiles) {
          // ページごとのxオフセットを計算
          const pageXOffset = pagesData.slice(0, pageIndex).reduce((sum, page) => sum + page.width, 0);
          const x = pageXOffset + tile.x * tileSize;
          const y = tile.y * tileSize;
          ctx.drawImage(img, x, y, tileSize, tileSize);
        }

        // キャッシュに保存
        renderer!['pageCache'].set(cacheKey, offscreen);
        console.log(`[prefetch] Pages [${pages.join(', ')}] cached successfully`);
      } catch (err) {
        console.error(`[prefetch] Failed to prefetch pages [${pages.join(', ')}]:`, err);
      }
    })();
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

    // 表示するページを決定（見開きモードかどうか）
    const spread = currentSpread;
    let pagesData: Page[];

    if (isSpreadMode && spread.leftPage !== null && spread.rightPage !== null) {
      // 見開きモード: 2ページ分
      const leftPageData = metadata.pages.find((p) => p.page === spread.leftPage);
      const rightPageData = metadata.pages.find((p) => p.page === spread.rightPage);

      if (!leftPageData || !rightPageData) return;
      pagesData = [leftPageData, rightPageData];
    } else {
      // 単ページモード
      pagesData = [pageData];
    }

    // キャッシュキーを計算
    const cacheKey = pagesData.length === 1 ? pagesData[0].page : -(pagesData[0].page + 1);

    // キャッシュチェック: キャッシュされている場合は即座に表示
    const cacheStats = renderer.getCacheStats();
    if (cacheStats.pages.includes(cacheKey)) {
      const pageLabels = pagesData.map((p) => p.page).join(', ');
      console.log(`[usePamphletViewer] Pages [${pageLabels}] cached, rendering immediately`);

      // loading状態をfalseに設定（即座に表示）
      loading = false;

      // キャッシュから即座に描画
      if (pagesData.length === 1) {
        const page = pagesData[0];
        renderer.renderPage(page.page, page.width, page.height, []);
      } else {
        const [leftPage, rightPage] = pagesData;
        renderer.renderSpread(leftPage, rightPage, [], []);
      }

      // プリフェッチ: 次のページを先読み
      prefetchAdjacentPages(currentPage);
      return;
    }

    // キャッシュにない場合: タイルを読み込み
    await loadPagesTiles(pagesData);

    // 読み込み完了後、隣接ページをプリフェッチ
    prefetchAdjacentPages(currentPage);
  }

  /**
   * ページのタイルを読み込み（単ページまたは見開き）
   * @param pagesData - 読み込むページデータの配列（1ページまたは2ページ）
   */
  async function loadPagesTiles(pagesData: Page[]): Promise<void> {
    if (!renderer || !tileLoader || pagesData.length === 0) return;

    // 前のページの描画をキャンセル
    if (abortController) {
      abortController.abort();
      console.log('[usePamphletViewer] Previous rendering cancelled');
    }

    // 新しいAbortControllerを作成
    abortController = new AbortController();
    const signal = abortController.signal;

    loading = true;
    loadingTiles = 0;
    totalTiles = pagesData.reduce((sum, page) => sum + page.tiles.length, 0);

    try {
      // すべてのページのタイルを並列で読み込み（高優先度: 10）
      const allTilePromises = pagesData.flatMap((pageData, pageIndex) =>
        pageData.tiles.map(async (tile) => {
          if (signal.aborted) return null;
          try {
            const img = await tileLoader.loadTile(tile, 10); // 高優先度
            loadingTiles++;
            return { tile, img, pageIndex };
          } catch (err) {
            if (!signal.aborted) {
              console.error(`Failed to load tile ${tile.x},${tile.y} from page ${pageData.page}:`, err);
            }
            return null;
          }
        })
      );

      // すべてのタイルを並列で読み込み
      const allTiles = await Promise.all(allTilePromises);

      // キャンセルチェック
      if (signal.aborted) {
        console.log('[usePamphletViewer] Rendering aborted');
        return;
      }

      // ページごとに振り分け
      const tilesPerPage = pagesData.map(() => [] as Array<{ tile: Tile; img: HTMLImageElement }>);
      allTiles.forEach((result) => {
        if (result) {
          tilesPerPage[result.pageIndex].push({ tile: result.tile, img: result.img });
        }
      });

      // 描画
      if (pagesData.length === 1) {
        // 単ページモード
        const pageData = pagesData[0];
        renderer.renderPage(pageData.page, pageData.width, pageData.height, tilesPerPage[0]);
        console.log(`[usePamphletViewer] Page ${pageData.page} rendered and cached`);
      } else if (pagesData.length === 2) {
        // 見開きモード
        const [leftPage, rightPage] = pagesData;
        renderer.renderSpread(leftPage, rightPage, tilesPerPage[0], tilesPerPage[1]);
        console.log(`[usePamphletViewer] Spread (${leftPage.page}, ${rightPage.page}) rendered and cached`);
      }
    } catch (err) {
      if (signal.aborted) {
        console.log('Tile loading cancelled');
        return;
      }
      console.error('Failed to load tiles:', err);
      error = 'Failed to load tiles';
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
   * 現在のページを再描画（見開き対応）
   */
  async function redrawCurrentPage(): Promise<void> {
    if (!renderer || !tileLoader || !metadata) return;

    renderer.clear();

    // 見開きモードかチェック
    const spread = currentSpread;

    if (isSpreadMode && spread.leftPage !== null && spread.rightPage !== null) {
      // 見開きモード: 左右両方のページを再描画
      const leftPageData = metadata.pages.find((p) => p.page === spread.leftPage);
      const rightPageData = metadata.pages.find((p) => p.page === spread.rightPage);

      if (leftPageData && rightPageData) {
        // 左右のタイルを読み込み（キャッシュから取得されるはず）
        const leftTiles: Array<{ tile: Tile; img: HTMLImageElement }> = [];
        const rightTiles: Array<{ tile: Tile; img: HTMLImageElement }> = [];

        for (const tile of leftPageData.tiles) {
          try {
            const img = await tileLoader.loadTile(tile, 5);
            leftTiles.push({ tile, img });
          } catch (err) {
            console.error(`Failed to redraw left tile ${tile.x},${tile.y}:`, err);
          }
        }

        for (const tile of rightPageData.tiles) {
          try {
            const img = await tileLoader.loadTile(tile, 5);
            rightTiles.push({ tile, img });
          } catch (err) {
            console.error(`Failed to redraw right tile ${tile.x},${tile.y}:`, err);
          }
        }

        // 見開きを描画
        renderer.renderSpread(leftPageData, rightPageData, leftTiles, rightTiles);
        return;
      }
    }

    // 単ページモード
    if (!currentPageData) return;

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
