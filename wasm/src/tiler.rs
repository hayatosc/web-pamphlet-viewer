use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Cursor;

use crate::hasher;

/// タイル情報
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileInfo {
    /// タイルのX座標（タイル単位）
    pub x: u32,
    /// タイルのY座標（タイル単位）
    pub y: u32,
    /// タイルのSHA256ハッシュ（ファイル名として使用）
    pub hash: String,
    /// タイルの画像データ（WebP形式）
    #[serde(skip)]
    pub data: Vec<u8>,
}

/// タイル化結果
#[derive(Debug, Serialize, Deserialize)]
pub struct TileResult {
    /// 元画像の幅（ピクセル）
    pub width: u32,
    /// 元画像の高さ（ピクセル）
    pub height: u32,
    /// タイルサイズ（ピクセル）
    pub tile_size: u32,
    /// タイル配列
    pub tiles: Vec<TileInfo>,
}

/// 画像をタイル化する
///
/// # Arguments
/// * `image_data` - 元画像のバイトデータ（JPEG/PNG等）
/// * `tile_size` - タイルサイズ（ピクセル、例: 512）
/// * `quality` - WebP品質（1-100、デフォルト: 80）
///
/// # Returns
/// タイル化結果
///
/// # Errors
/// 画像のデコードやエンコードに失敗した場合
pub fn tile_image(
    image_data: &[u8],
    tile_size: u32,
    quality: Option<f32>,
) -> Result<TileResult, String> {
    // 画像をデコード
    let img = image::load_from_memory(image_data)
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let width = img.width();
    let height = img.height();

    // タイル数を計算
    let tiles_x = (width + tile_size - 1) / tile_size;
    let tiles_y = (height + tile_size - 1) / tile_size;

    let mut tiles = Vec::new();
    let mut seen_hashes = HashSet::new();

    // 各タイルを生成
    for ty in 0..tiles_y {
        for tx in 0..tiles_x {
            // タイルの座標とサイズを計算
            let x = tx * tile_size;
            let y = ty * tile_size;
            let w = tile_size.min(width - x);
            let h = tile_size.min(height - y);

            // タイルを切り出し
            let tile_img = crop_and_pad(&img, x, y, w, h, tile_size)?;

            // WebP形式にエンコード
            let webp_data = encode_webp(&tile_img, quality.unwrap_or(80.0))?;

            // ハッシュを計算
            let hash = hasher::calculate_hash(&webp_data);

            // 重複チェック（同じタイルは一度だけ保存）
            if !seen_hashes.contains(&hash) {
                seen_hashes.insert(hash.clone());
            }

            tiles.push(TileInfo {
                x: tx,
                y: ty,
                hash,
                data: webp_data,
            });
        }
    }

    Ok(TileResult {
        width,
        height,
        tile_size,
        tiles,
    })
}

/// 画像を切り出し、必要に応じてパディングする
///
/// タイルサイズに満たない場合は、透明ピクセルでパディング
fn crop_and_pad(
    img: &DynamicImage,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    tile_size: u32,
) -> Result<DynamicImage, String> {
    // 切り出し
    let mut cropped = img.crop_imm(x, y, w, h);

    // パディングが必要な場合
    if w < tile_size || h < tile_size {
        let mut padded: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_pixel(tile_size, tile_size, Rgba([255, 255, 255, 0]));

        // 切り出した画像を左上に配置
        image::imageops::overlay(&mut padded, &cropped.to_rgba8(), 0, 0);
        cropped = DynamicImage::ImageRgba8(padded);
    }

    Ok(cropped)
}

/// 画像をWebP形式にエンコード
fn encode_webp(img: &DynamicImage, quality: f32) -> Result<Vec<u8>, String> {
    let mut buffer = Cursor::new(Vec::new());

    // WebPエンコーダを使用
    img.write_to(&mut buffer, ImageFormat::WebP)
        .map_err(|e| format!("Failed to encode WebP: {}", e))?;

    Ok(buffer.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tile_image() {
        // 簡単なテスト用画像を作成（100x100の白い画像）
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_pixel(100, 100, Rgba([255, 255, 255, 255]));
        let dynamic_img = DynamicImage::ImageRgba8(img);

        let mut buffer = Cursor::new(Vec::new());
        dynamic_img
            .write_to(&mut buffer, ImageFormat::Png)
            .unwrap();
        let image_data = buffer.into_inner();

        // タイル化実行
        let result = tile_image(&image_data, 50, Some(80.0)).unwrap();

        assert_eq!(result.width, 100);
        assert_eq!(result.height, 100);
        assert_eq!(result.tile_size, 50);
        assert_eq!(result.tiles.len(), 4); // 2x2タイル
    }

    #[test]
    fn test_crop_and_pad() {
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_pixel(100, 100, Rgba([255, 0, 0, 255]));
        let dynamic_img = DynamicImage::ImageRgba8(img);

        // 端のタイルをテスト（パディングが必要）
        let result = crop_and_pad(&dynamic_img, 50, 50, 50, 50, 64).unwrap();

        assert_eq!(result.width(), 64);
        assert_eq!(result.height(), 64);
    }
}
