import type { WasmModule } from '../types';
import wasmInit, {
  tile_image,
  generate_metadata,
  calculate_hash,
} from '/wasm/tile_wasm.js';

let wasmModule: WasmModule | null = null;
let wasmInitPromise: Promise<WasmModule> | null = null;

export async function initWasm(): Promise<WasmModule> {
  if (wasmModule) return wasmModule;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    try {
      // Initialize WASM module
      await wasmInit();

      // Create WasmModule interface
      wasmModule = {
        tile_image,
        generate_metadata,
        calculate_hash,
      };

      return wasmModule;
    } catch (error) {
      console.error('WASM initialization failed:', error);
      throw error;
    }
  })();

  return wasmInitPromise;
}
