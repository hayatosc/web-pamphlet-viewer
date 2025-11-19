import { hc } from 'hono/client';
import type { AppType } from 'workers';
import type { Tile } from '../types/metadata';

/**
 * タイル読み込みタスク
 */
interface TileLoadTask {
  tile: Tile;
  priority: number;
  hash: string;
  resolve: (img: HTMLImageElement) => void;
  reject: (err: Error) => void;
}

/**
 * タイルローダー - 並列数制御付きタイル取得
 */
export class TileLoader {
  private queue: TileLoadTask[] = [];
  private running = 0;
  private maxConcurrent: number;
  private cache = new Map<string, HTMLImageElement>();
  private loading = new Set<string>();
  private apiBase: string;
  private pamphletId: string;

  constructor(apiBase: string, pamphletId: string, maxConcurrent = 6) {
    this.apiBase = apiBase;
    this.pamphletId = pamphletId;
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * タイルを読み込み
   */
  async loadTile(tile: Tile, priority = 0): Promise<HTMLImageElement> {
    const cacheKey = tile.hash;

    // キャッシュチェック
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 既に読み込み中の場合は、新しいタスクとして登録（同じタイルの複数リクエストに対応）
    return new Promise((resolve, reject) => {
      this.queue.push({
        tile,
        priority,
        hash: tile.hash,
        resolve,
        reject,
      });

      // 優先度でソート（高い方が先）
      this.queue.sort((a, b) => b.priority - a.priority);

      // キュー処理を開始（非同期で実行）
      this.processQueue();
    });
  }

  /**
   * 複数のタイルを読み込み
   */
  async loadTiles(tiles: Tile[], priority = 0): Promise<Map<string, HTMLImageElement>> {
    const results = new Map<string, HTMLImageElement>();

    await Promise.all(
      tiles.map(async (tile) => {
        try {
          const img = await this.loadTile(tile, priority);
          const key = `${tile.x},${tile.y}`;
          results.set(key, img);
        } catch (err) {
          console.error(`Failed to load tile ${tile.x},${tile.y}:`, err);
        }
      })
    );

    return results;
  }

  /**
   * キューを処理
   */
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const task = this.queue.shift();
      if (!task) break;

      this.running++;
      this.loading.add(task.hash);

      // 非同期でタイル取得を実行
      (async () => {
        try {
          // キャッシュ再チェック（同じタイルの複数リクエスト対策）
          const cached = this.cache.get(task.hash);
          if (cached) {
            task.resolve(cached);
            return;
          }

          const img = await this.fetchImage(task.hash);
          this.cache.set(task.hash, img);
          task.resolve(img);
        } catch (err) {
          console.error(`Failed to fetch tile ${task.hash}:`, err);
          task.reject(err instanceof Error ? err : new Error(String(err)));
        } finally {
          this.loading.delete(task.hash);
          this.running--;
          // キュー処理を続行
          this.processQueue();
        }
      })();
    }
  }

  /**
   * 画像を取得（hono/client RPC使用）
   */
  private async fetchImage(hash: string): Promise<HTMLImageElement> {
    const client = hc<AppType>(this.apiBase);

    const res = await client.pamphlet[':id'].tile[':hash'].$get({
      param: { id: this.pamphletId, hash },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch tile: ${res.statusText}`);
    }

    // blobとして取得
    const blob = await res.blob();

    // blobからObjectURLを作成してImageに読み込み
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl); // メモリ解放
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`Failed to load image from blob`));
      };

      img.src = objectUrl;
    });
  }

  /**
   * キャッシュクリア
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 統計情報
   */
  getStats() {
    return {
      cached: this.cache.size,
      loading: this.loading.size,
      queued: this.queue.length,
    };
  }
}
