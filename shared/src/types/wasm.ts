/**
 * WASM Tiling Engine & Pamphlet Type Definitions
 */

// ============================================
// WASM Module Types
// ============================================

/**
 * タイル情報
 */
export interface JsTileInfo {
  /** タイルのX座標（タイル単位） */
  x: number;
  /** タイルのY座標（タイル単位） */
  y: number;
  /** タイルのSHA256ハッシュ（64文字の16進数） */
  hash: string;
}

/**
 * タイル化結果
 */
export interface JsTileResult {
  /** 元画像の幅（ピクセル） */
  width: number;
  /** 元画像の高さ（ピクセル） */
  height: number;
  /** タイルサイズ（ピクセル） */
  tile_size: number;
  /** タイル情報の配列 */
  tiles: JsTileInfo[];
  /** タイル数を取得 */
  tile_count(): number;
  /** 指定インデックスのタイルデータ（WebP）を取得 */
  get_tile_data(index: number): Uint8Array;
}

/**
 * WASMモジュールインターフェース
 */
export interface WasmModule {
  /**
   * 画像をタイル化
   * @param imageData 元画像のバイトデータ（JPEG/PNG等）
   * @param tileSize タイルサイズ（ピクセル）
   * @param quality WebP品質（1-100、デフォルト80）
   * @returns タイル化結果
   */
  tile_image(imageData: Uint8Array, tileSize: number, quality?: number): JsTileResult;

  /**
   * metadata.jsonを生成
   * @param pagesJson ページ情報のJSON文字列
   * @param tileSize タイルサイズ
   * @returns metadata.jsonの文字列
   */
  generate_metadata(pagesJson: string, tileSize: number): string;

  /**
   * SHA256ハッシュを計算
   * @param data ハッシュ化するデータ
   * @returns SHA256ハッシュの16進数文字列（64文字）
   */
  calculate_hash(data: Uint8Array): string;
}

// ============================================
// Pamphlet Metadata Types
// ============================================

/**
 * タイルのメタデータ
 */
export interface TileMetadata {
  /** タイルのX座標（タイル単位） */
  x: number;
  /** タイルのY座標（タイル単位） */
  y: number;
  /** タイルのSHA256ハッシュ */
  hash: string;
}

/**
 * ページ情報
 */
export interface PageInfo {
  /** ページ番号（0始まり） */
  page: number;
  /** ページの幅（ピクセル） */
  width: number;
  /** ページの高さ（ピクセル） */
  height: number;
  /** ページ内のタイル配列 */
  tiles: TileMetadata[];
}

/**
 * パンフレットのメタデータ
 */
export interface Metadata {
  /** バージョン（タイムスタンプまたはシーケンシャル番号） */
  version: number;
  /** タイルサイズ（ピクセル） */
  tile_size: number;
  /** ページ配列 */
  pages: PageInfo[];
}

// ============================================
// API Types
// ============================================

/**
 * API: GET /pamphlet/:id/metadata のレスポンス
 */
export type MetadataResponse = Metadata;

/**
 * API: POST /upload のリクエストボディ
 */
export interface UploadRequest {
  /** パンフレットID */
  id: string;
  /** ページ情報 */
  pages: PageInfo[];
  /** タイルサイズ */
  tile_size: number;
}

/**
 * API: POST /upload のレスポンス
 */
export interface UploadResponse {
  /** パンフレットID */
  id: string;
  /** バージョン番号 */
  version: number;
  /** ステータス */
  status: 'ok' | 'error';
  /** エラーメッセージ（エラー時） */
  message?: string;
}
