// WASM関連の型定義
export interface TileResult {
  x: number;
  y: number;
  hash: string;
  data: Uint8Array;
}

export interface TileImageResult {
  tiles: TileResult[];
  width: number;
  height: number;
  tile_size: number;
}

export interface WasmModule {
  tile_image: (imageData: Uint8Array, tileSize: number) => TileImageResult;
  generate_metadata: (pages: any[]) => string;
}

export interface FileWithPreview extends File {
  preview?: string;
}

export interface ProcessedPage {
  file: File;
  pageNumber: number;
  tiles: TileResult[];
  width: number;
  height: number;
  tileSize: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  error?: string;
}
