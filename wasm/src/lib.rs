mod hasher;
mod tiler;

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use js_sys::{Array, Uint8Array};

// wee_allocをグローバルアロケータとして使用（メモリ最適化）
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

/// WASMモジュール初期化時に呼ばれる
/// パニックフックを設定してエラーログを改善
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// JavaScriptに返すタイル情報
#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsTileInfo {
    x: u32,
    y: u32,
    hash: String,
}

#[wasm_bindgen]
impl JsTileInfo {
    #[wasm_bindgen(getter)]
    pub fn x(&self) -> u32 {
        self.x
    }

    #[wasm_bindgen(getter)]
    pub fn y(&self) -> u32 {
        self.y
    }

    #[wasm_bindgen(getter)]
    pub fn hash(&self) -> String {
        self.hash.clone()
    }
}

/// JavaScriptに返すタイル化結果
#[wasm_bindgen]
#[derive(Debug, Serialize, Deserialize)]
pub struct JsTileResult {
    width: u32,
    height: u32,
    tile_size: u32,
    tiles: Vec<tiler::TileInfo>,
}

#[wasm_bindgen]
impl JsTileResult {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }

    #[wasm_bindgen(getter)]
    pub fn tile_size(&self) -> u32 {
        self.tile_size
    }

    /// タイル情報の配列を取得
    #[wasm_bindgen(getter)]
    pub fn tiles(&self) -> Array {
        self.tiles
            .iter()
            .map(|tile| {
                let js_tile = JsTileInfo {
                    x: tile.x,
                    y: tile.y,
                    hash: tile.hash.clone(),
                };
                serde_wasm_bindgen::to_value(&js_tile).unwrap()
            })
            .collect()
    }

    /// 指定したインデックスのタイルデータを取得
    #[wasm_bindgen]
    pub fn get_tile_data(&self, index: usize) -> Result<Uint8Array, JsValue> {
        if index >= self.tiles.len() {
            return Err(JsValue::from_str("Tile index out of bounds"));
        }

        let data = &self.tiles[index].data;
        Ok(Uint8Array::from(&data[..]))
    }

    /// タイル数を取得
    #[wasm_bindgen]
    pub fn tile_count(&self) -> usize {
        self.tiles.len()
    }
}

/// 画像をタイル化する（JavaScriptから呼び出し可能）
///
/// # Arguments
/// * `image_data` - 元画像のバイトデータ（JPEG/PNG等）
/// * `tile_size` - タイルサイズ（ピクセル、例: 512）
/// * `quality` - WebP品質（1-100、省略時80）
///
/// # Returns
/// タイル化結果（JsTileResult）
///
/// # Example (JavaScript)
/// ```js
/// import init, { tile_image } from './pkg/tile_wasm.js';
///
/// await init();
///
/// const imageData = new Uint8Array([...]); // 画像ファイルのバイナリ
/// const result = tile_image(imageData, 512, 80);
///
/// console.log(`Width: ${result.width}, Height: ${result.height}`);
/// console.log(`Tile count: ${result.tile_count()}`);
///
/// for (let i = 0; i < result.tile_count(); i++) {
///   const tileData = result.get_tile_data(i);
///   // tileData: Uint8Array (WebP形式)
/// }
/// ```
#[wasm_bindgen]
pub fn tile_image(
    image_data: &[u8],
    tile_size: u32,
    quality: Option<f32>,
) -> Result<JsTileResult, JsValue> {
    // Rustのタイル化関数を呼び出し
    let result = tiler::tile_image(image_data, tile_size, quality)
        .map_err(|e| JsValue::from_str(&e))?;

    Ok(JsTileResult {
        width: result.width,
        height: result.height,
        tile_size: result.tile_size,
        tiles: result.tiles,
    })
}

/// ページ情報（metadata生成用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageInfo {
    pub page: u32,
    pub width: u32,
    pub height: u32,
    pub tiles: Vec<TileMetadata>,
}

/// タイルのメタデータ
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileMetadata {
    pub x: u32,
    pub y: u32,
    pub hash: String,
}

/// metadata.jsonを生成する（JavaScriptから呼び出し可能）
///
/// # Arguments
/// * `pages_json` - ページ情報のJSON文字列
/// * `tile_size` - タイルサイズ
///
/// # Returns
/// metadata.jsonの文字列
///
/// # Example (JavaScript)
/// ```js
/// const pages = [
///   {
///     page: 0,
///     width: 2480,
///     height: 3508,
///     tiles: [
///       { x: 0, y: 0, hash: "abc123..." },
///       { x: 1, y: 0, hash: "def456..." },
///     ]
///   }
/// ];
///
/// const metadata = generate_metadata(JSON.stringify(pages), 512);
/// console.log(metadata);
/// ```
#[wasm_bindgen]
pub fn generate_metadata(pages_json: &str, tile_size: u32) -> Result<String, JsValue> {
    let pages: Vec<PageInfo> =
        serde_json::from_str(pages_json).map_err(|e| JsValue::from_str(&format!("{}", e)))?;

    let metadata = serde_json::json!({
        "version": js_sys::Date::now() as u64,
        "tile_size": tile_size,
        "pages": pages
    });

    serde_json::to_string_pretty(&metadata)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize metadata: {}", e)))
}

/// SHA256ハッシュを計算（JavaScriptから呼び出し可能）
///
/// # Arguments
/// * `data` - ハッシュ化するバイトデータ
///
/// # Returns
/// SHA256ハッシュの16進数文字列
#[wasm_bindgen]
pub fn calculate_hash(data: &[u8]) -> String {
    hasher::calculate_hash(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_metadata() {
        let pages = vec![PageInfo {
            page: 0,
            width: 1000,
            height: 1000,
            tiles: vec![
                TileMetadata {
                    x: 0,
                    y: 0,
                    hash: "abc123".to_string(),
                },
                TileMetadata {
                    x: 1,
                    y: 0,
                    hash: "def456".to_string(),
                },
            ],
        }];

        let pages_json = serde_json::to_string(&pages).unwrap();
        let metadata = generate_metadata(&pages_json, 512).unwrap();

        assert!(metadata.contains("version"));
        assert!(metadata.contains("tile_size"));
        assert!(metadata.contains("pages"));
    }
}
