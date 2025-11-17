// Re-export shared types
export type {
  WasmModule,
  JsTileResult,
  JsTileInfo,
  PageInfo,
  Metadata,
  TileMetadata,
  UploadResponse,
} from 'shared/types/wasm';

// Import for extension
import type { JsTileInfo } from 'shared/types/wasm';

// Client-specific types
export interface FileWithPreview extends File {
  preview?: string;
}

export interface TileWithData extends JsTileInfo {
  data: Uint8Array;
}

export interface ProcessedPage {
  file: File;
  pageNumber: number;
  tiles: TileWithData[];
  width: number;
  height: number;
  tileSize: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  error?: string;
}
