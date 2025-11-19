/**
 * ページキャッシュ（LRU方式）
 * 描画済みページをOffscreenCanvasでキャッシュし、高速なページ遷移を実現
 */
export class PageCache {
  private cache = new Map<number, OffscreenCanvas>();
  private accessOrder: number[] = [];
  private maxSize: number;

  constructor(maxSize = 5) {
    this.maxSize = maxSize;
  }

  /**
   * ページをキャッシュ（LRU方式）
   */
  set(pageNumber: number, canvas: OffscreenCanvas): void {
    // 既存のエントリがあればアクセス順を更新
    const existingIndex = this.accessOrder.indexOf(pageNumber);
    if (existingIndex !== -1) {
      this.accessOrder.splice(existingIndex, 1);
    }

    // 容量超過なら最も古いページを削除
    if (this.cache.size >= this.maxSize && !this.cache.has(pageNumber)) {
      const oldest = this.accessOrder.shift();
      if (oldest !== undefined) {
        this.cache.delete(oldest);
        console.log(`[PageCache] Evicted page ${oldest} (cache full)`);
      }
    }

    // 新しいページを追加
    this.cache.set(pageNumber, canvas);
    this.accessOrder.push(pageNumber);

    console.log(`[PageCache] Cached page ${pageNumber} (total: ${this.cache.size}/${this.maxSize})`);
  }

  /**
   * キャッシュから取得
   */
  get(pageNumber: number): OffscreenCanvas | undefined {
    const canvas = this.cache.get(pageNumber);

    if (canvas) {
      // LRU: アクセスされたページを最新に移動
      const index = this.accessOrder.indexOf(pageNumber);
      if (index !== -1) {
        this.accessOrder.splice(index, 1);
        this.accessOrder.push(pageNumber);
      }
    }

    return canvas;
  }

  /**
   * キャッシュヒット判定
   */
  has(pageNumber: number): boolean {
    return this.cache.has(pageNumber);
  }

  /**
   * クリア
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    console.log('[PageCache] Cleared all cached pages');
  }

  /**
   * 統計情報
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      pages: Array.from(this.cache.keys()).sort((a, b) => a - b),
      accessOrder: [...this.accessOrder],
      hitRate: this.cache.size > 0 ? (this.cache.size / this.maxSize) * 100 : 0,
    };
  }
}
