import type { Tile, Page } from '../types/metadata';
import { PageCache } from './page-cache';

/**
 * Canvas描画管理（ページキャッシュ対応）
 */
export class CanvasRenderer {
  private static readonly CONTAINER_PADDING = 32; // コンテナとCanvas間のパディング（px）

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tileSize: number;
  private scale = 1;
  private translateX = 0;
  private translateY = 0;
  private dpr: number;
  private pageWidth = 0;
  private pageHeight = 0;
  private pageCache: PageCache;
  private fixedContainerHeight: number | null = null; // 初回計算時のコンテナ高さを保存
  private isContainerHeightInitialized = false; // コンテナ高さ初期化フラグ

  constructor(canvas: HTMLCanvasElement, tileSize: number, cacheSize = 5) {
    this.canvas = canvas;
    this.tileSize = tileSize;
    this.dpr = window.devicePixelRatio || 1;
    this.pageCache = new PageCache(cacheSize);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }
    this.ctx = ctx;
  }

  /**
   * Canvasを初期化（ページサイズに合わせる）
   */
  initCanvas(width: number, height: number): void {
    this.pageWidth = width;
    this.pageHeight = height;

    // 高DPI対応
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    // transformをリセット
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;

    // CSS transformを更新
    this.applyTransform();

    // 背景をクリア
    this.clear();
  }

  /**
   * Canvasをクリア
   */
  clear(): void {
    // transformをリセットしてクリア
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = '#f9fafb';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  /**
   * ページ全体を描画（キャッシュ対応）
   */
  renderPage(
    pageNumber: number,
    pageWidth: number,
    pageHeight: number,
    tiles: Array<{ tile: Tile; img: HTMLImageElement }>
  ): void {
    this.pageWidth = pageWidth;
    this.pageHeight = pageHeight;

    // コンテナサイズを取得
    const container = this.canvas.parentElement?.parentElement;
    if (!container) {
      console.error('Canvas container not found');
      return;
    }

    // 初回のみコンテナサイズを保存
    if (!this.isContainerHeightInitialized) {
      this.fixedContainerHeight = container.clientHeight;
      this.isContainerHeightInitialized = true;
      console.log(`[CanvasRenderer] Fixed container height: ${this.fixedContainerHeight}px`);
    }

    const containerWidth = container.clientWidth;

    // コンテナに収まる最大サイズを計算（幅と高さ両方を考慮、パディング考慮）
    const maxWidth = containerWidth - CanvasRenderer.CONTAINER_PADDING;
    const maxHeight = (this.fixedContainerHeight ?? container.clientHeight) - CanvasRenderer.CONTAINER_PADDING;

    // アスペクト比を維持しながら、コンテナいっぱいに表示
    const scaleByWidth = maxWidth / pageWidth;
    const scaleByHeight = maxHeight / pageHeight;
    const scale = Math.min(scaleByWidth, scaleByHeight); // 小さい方を採用（はみ出さないように）

    const displayWidth = pageWidth * scale;
    const displayHeight = pageHeight * scale;

    // Canvasサイズ調整（高DPI対応）
    this.canvas.width = pageWidth * this.dpr;
    this.canvas.height = pageHeight * this.dpr;

    // 高さ基準で固定スケール（レイアウトシフト防止）
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;

    // transformをリセット
    this.resetTransform();

    // キャッシュチェック
    const cached = this.pageCache.get(pageNumber);
    if (cached) {
      console.log(`[CanvasRenderer] Page ${pageNumber} restored from cache`);
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(this.dpr, this.dpr);
      this.ctx.drawImage(cached, 0, 0);
      this.ctx.restore();
      return;
    }

    // 初回描画: OffscreenCanvasに描画
    console.log(`[CanvasRenderer] Page ${pageNumber} rendering to cache (${tiles.length} tiles)`);
    const offscreen = new OffscreenCanvas(pageWidth, pageHeight);
    const offscreenCtx = offscreen.getContext('2d');

    if (!offscreenCtx) {
      throw new Error('Failed to get OffscreenCanvas context');
    }

    // 背景
    offscreenCtx.fillStyle = '#f9fafb';
    offscreenCtx.fillRect(0, 0, pageWidth, pageHeight);

    // タイル描画
    for (const { tile, img } of tiles) {
      const x = tile.x * this.tileSize;
      const y = tile.y * this.tileSize;
      try {
        offscreenCtx.drawImage(img, x, y, this.tileSize, this.tileSize);
      } catch (err) {
        console.error(`Failed to draw tile ${tile.x},${tile.y}:`, err);
      }
    }

    // キャッシュに保存
    this.pageCache.set(pageNumber, offscreen);

    // メインCanvasに転送（1回のdrawImage）
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);
    this.ctx.drawImage(offscreen, 0, 0);
    this.ctx.restore();
  }

  /**
   * 見開き（2ページ並べて）を描画
   */
  renderSpread(
    leftPageData: Page,
    rightPageData: Page,
    leftTiles: Array<{ tile: Tile; img: HTMLImageElement }>,
    rightTiles: Array<{ tile: Tile; img: HTMLImageElement }>
  ): void {
    // 見開き全体のサイズ（左右のページを横に並べる）
    const spreadWidth = leftPageData.width + rightPageData.width;
    const spreadHeight = Math.max(leftPageData.height, rightPageData.height);

    this.pageWidth = spreadWidth;
    this.pageHeight = spreadHeight;

    // コンテナサイズを取得
    const container = this.canvas.parentElement?.parentElement;
    if (!container) {
      console.error('Canvas container not found');
      return;
    }

    // 初回のみコンテナサイズを保存
    if (!this.isContainerHeightInitialized) {
      this.fixedContainerHeight = container.clientHeight;
      this.isContainerHeightInitialized = true;
      console.log(`[CanvasRenderer] Fixed container height: ${this.fixedContainerHeight}px`);
    }

    const containerWidth = container.clientWidth;

    // コンテナに収まる最大サイズを計算
    const maxWidth = containerWidth - CanvasRenderer.CONTAINER_PADDING;
    const maxHeight = (this.fixedContainerHeight ?? container.clientHeight) - CanvasRenderer.CONTAINER_PADDING;

    // アスペクト比を維持しながら、コンテナいっぱいに表示
    const scaleByWidth = maxWidth / spreadWidth;
    const scaleByHeight = maxHeight / spreadHeight;
    const scale = Math.min(scaleByWidth, scaleByHeight);

    const displayWidth = spreadWidth * scale;
    const displayHeight = spreadHeight * scale;

    // Canvasサイズ調整（高DPI対応）
    this.canvas.width = spreadWidth * this.dpr;
    this.canvas.height = spreadHeight * this.dpr;

    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;

    // transformをリセット
    this.resetTransform();

    // 見開き用のキャッシュキー（負の値で見開きを識別: -leftPage-1）
    const spreadCacheKey = -(leftPageData.page + 1);

    // キャッシュチェック
    const cached = this.pageCache.get(spreadCacheKey);
    if (cached) {
      console.log(`[CanvasRenderer] Spread (${leftPageData.page}, ${rightPageData.page}) restored from cache`);
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(this.dpr, this.dpr);
      this.ctx.drawImage(cached, 0, 0);
      this.ctx.restore();
      return;
    }

    // OffscreenCanvasに見開きを描画
    console.log(`[CanvasRenderer] Rendering spread (${leftPageData.page}, ${rightPageData.page}) to cache`);
    const offscreen = new OffscreenCanvas(spreadWidth, spreadHeight);
    const offscreenCtx = offscreen.getContext('2d');

    if (!offscreenCtx) {
      throw new Error('Failed to get OffscreenCanvas context');
    }

    // 背景
    offscreenCtx.fillStyle = '#f9fafb';
    offscreenCtx.fillRect(0, 0, spreadWidth, spreadHeight);

    // 左ページのタイル描画
    for (const { tile, img } of leftTiles) {
      const x = tile.x * this.tileSize;
      const y = tile.y * this.tileSize;
      try {
        offscreenCtx.drawImage(img, x, y, this.tileSize, this.tileSize);
      } catch (err) {
        console.error(`Failed to draw left tile ${tile.x},${tile.y}:`, err);
      }
    }

    // 右ページのタイル描画（左ページの幅分だけオフセット）
    const rightPageOffsetX = leftPageData.width;
    for (const { tile, img } of rightTiles) {
      const x = rightPageOffsetX + tile.x * this.tileSize;
      const y = tile.y * this.tileSize;
      try {
        offscreenCtx.drawImage(img, x, y, this.tileSize, this.tileSize);
      } catch (err) {
        console.error(`Failed to draw right tile ${tile.x},${tile.y}:`, err);
      }
    }

    // キャッシュに保存
    this.pageCache.set(spreadCacheKey, offscreen);

    // メインCanvasに転送（1回のdrawImage）
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);
    this.ctx.drawImage(offscreen, 0, 0);
    this.ctx.restore();
  }

  /**
   * transformを適用（Canvas要素自体にCSS transformを適用）
   */
  private applyTransform(): void {
    // Canvas要素自体にCSS transformを適用（枠ごと動く）
    // translateとscaleの順序: translate → scale
    const transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
    this.canvas.style.transform = transform;
    // Canvas要素の中心を基準にズーム
    this.canvas.style.transformOrigin = '50% 50%';
  }

  /**
   * タイルを描画
   */
  drawTile(tile: Tile, img: HTMLImageElement): void {
    const x = tile.x * this.tileSize;
    const y = tile.y * this.tileSize;

    try {
      this.ctx.save();
      // Canvas内部の描画はdpr補正のみ（transformはCSS側で適用）
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(this.dpr, this.dpr);
      this.ctx.drawImage(img, x, y, this.tileSize, this.tileSize);
      this.ctx.restore();
    } catch (err) {
      console.error(`Failed to draw tile at ${tile.x},${tile.y}:`, err);
    }
  }

  /**
   * 複数のタイルを描画
   */
  drawTiles(tiles: Map<string, { tile: Tile; img: HTMLImageElement }>): void {
    tiles.forEach(({ tile, img }) => {
      this.drawTile(tile, img);
    });
  }

  /**
   * プレースホルダー（読み込み中のタイル）を描画
   */
  drawPlaceholder(tile: Tile): void {
    const x = tile.x * this.tileSize;
    const y = tile.y * this.tileSize;

    this.ctx.save();
    // Canvas内部の描画はdpr補正のみ
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);

    this.ctx.fillStyle = '#e5e7eb';
    this.ctx.fillRect(x, y, this.tileSize, this.tileSize);

    // 枠線
    this.ctx.strokeStyle = '#d1d5db';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x, y, this.tileSize, this.tileSize);

    this.ctx.restore();
  }

  /**
   * ズーム設定
   * @param scale - 新しいスケール値
   */
  setScale(scale: number): void {
    const newScale = Math.max(1, Math.min(5, scale));

    // ズームが1倍に戻った場合、パン位置もリセット
    if (newScale === 1 && this.scale !== 1) {
      this.translateX = 0;
      this.translateY = 0;
    }

    this.scale = newScale;

    // CSS transformを更新
    this.applyTransform();
  }

  /**
   * パン設定
   */
  setPan(x: number, y: number): void {
    // ズーム時の実際の画像サイズに基づいて移動範囲を計算
    // 拡大後の画像サイズを取得
    const scaledWidth = this.pageWidth * this.scale;
    const scaledHeight = this.pageHeight * this.scale;

    // 拡大後の画像サイズの2倍まで移動可能
    const maxX = scaledWidth * 2;
    const maxY = scaledHeight * 2;

    this.translateX = Math.max(-maxX, Math.min(maxX, x));
    this.translateY = Math.max(-maxY, Math.min(maxY, y));

    // CSS transformを更新
    this.applyTransform();
  }

  /**
   * パン移動（相対）
   */
  pan(deltaX: number, deltaY: number): void {
    this.setPan(this.translateX + deltaX, this.translateY + deltaY);
  }

  /**
   * transformをリセット
   */
  resetTransform(): void {
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;

    // CSS transformを更新
    this.applyTransform();
  }

  /**
   * 現在のスケールを取得
   */
  getScale(): number {
    return this.scale;
  }

  /**
   * 現在のパン位置を取得
   */
  getPan(): { x: number; y: number } {
    return { x: this.translateX, y: this.translateY };
  }

  /**
   * Canvas要素を取得
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * コンテキストを取得
   */
  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /**
   * キャッシュ統計を取得
   */
  getCacheStats() {
    return this.pageCache.getStats();
  }

  /**
   * ページキャッシュをクリア
   */
  clearPageCache(): void {
    this.pageCache.clear();
  }
}
