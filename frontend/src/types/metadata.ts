/**
 * タイル情報
 */
export interface Tile {
  x: number;
  y: number;
  hash: string;
}

/**
 * ページ情報
 */
export interface Page {
  page: number;
  width: number;
  height: number;
  tiles: Tile[];
}

/**
 * メタデータ
 */
export interface Metadata {
  version: number;
  tile_size: number;
  pages: Page[];
}
