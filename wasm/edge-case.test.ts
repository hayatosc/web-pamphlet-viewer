/**
 * エッジケーステスト - タイルサイズが画像の約数でない場合
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { WasmModule, JsTileResult } from 'shared/types/wasm';

describe('Edge Cases - Non-divisible tile sizes', () => {
  let wasm: WasmModule;
  let imageData: Uint8Array;

  beforeAll(async () => {
    wasm = await import('./pkg/tile_wasm.js');
    // 512x512のsample.jpgを使用
    imageData = readFileSync(join(__dirname, 'sample.jpg'));
  });

  it('should handle 512x512 image with 300px tiles (non-divisible)', () => {
    const tileSize = 300;
    const result: JsTileResult = wasm.tile_image(imageData, tileSize, 80);

    // 512/300 = 1.706... -> 2タイル（各方向）
    // 合計: 2x2 = 4タイル
    // 端のタイルは 512-300 = 212px 分のみ実画像、残り88pxは透明でパディング
    const expectedTilesX = Math.ceil(512 / tileSize); // 2
    const expectedTilesY = Math.ceil(512 / tileSize); // 2
    const expectedTiles = expectedTilesX * expectedTilesY; // 4

    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.tile_size).toBe(tileSize);
    expect(result.tiles.length).toBe(expectedTiles);

    // タイル座標の確認
    const tiles = result.tiles.map(tile => ({ x: tile.x, y: tile.y }));
    result.tiles.forEach((tile, i) => {
      expect(tile.hash).toHaveLength(64);
      const data = result.get_tile_data(i);
      expect(data.length).toBeGreaterThan(0);
    });

    expect(tiles).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 },
    ]);
  });

  it('should handle 512x512 image with 200px tiles (non-divisible)', () => {
    const tileSize = 200;
    const result: JsTileResult = wasm.tile_image(imageData, tileSize, 80);

    // 512/200 = 2.56 -> 3タイル（各方向）
    // 合計: 3x3 = 9タイル
    // 端のタイルは 512-(200*2) = 112px 分のみ実画像、残り88pxは透明でパディング
    const expectedTilesX = Math.ceil(512 / tileSize); // 3
    const expectedTilesY = Math.ceil(512 / tileSize); // 3
    const expectedTiles = expectedTilesX * expectedTilesY; // 9

    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.tile_size).toBe(tileSize);
    expect(result.tiles.length).toBe(expectedTiles);

    // タイル座標の確認
    const tiles = result.tiles.map(tile => ({ x: tile.x, y: tile.y }));

    expect(tiles).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
    ]);
  });

  it('should handle 512x512 image with 370px tiles (non-divisible)', () => {
    const tileSize = 370;
    const result: JsTileResult = wasm.tile_image(imageData, tileSize, 80);

    // 512/370 = 1.383... -> 2タイル（各方向）
    // 合計: 2x2 = 4タイル
    // 端のタイルは 512-370 = 142px 分のみ実画像、残り228pxは透明でパディング
    const expectedTilesX = Math.ceil(512 / tileSize); // 2
    const expectedTilesY = Math.ceil(512 / tileSize); // 2
    const expectedTiles = expectedTilesX * expectedTilesY; // 4

    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.tile_size).toBe(tileSize);
    expect(result.tiles.length).toBe(expectedTiles);
  });

  it('should handle 512x512 image with 100px tiles (many tiles)', () => {
    const tileSize = 100;
    const result: JsTileResult = wasm.tile_image(imageData, tileSize, 80);

    // 512/100 = 5.12 -> 6タイル（各方向）
    // 合計: 6x6 = 36タイル
    // 端のタイルは 512-(100*5) = 12px 分のみ実画像、残り88pxは透明でパディング
    const expectedTilesX = Math.ceil(512 / tileSize); // 6
    const expectedTilesY = Math.ceil(512 / tileSize); // 6
    const expectedTiles = expectedTilesX * expectedTilesY; // 36

    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.tile_size).toBe(tileSize);
    expect(result.tiles.length).toBe(expectedTiles);
  });

  it('should handle 512x512 image with 513px tiles (larger than image)', () => {
    const tileSize = 513;
    const result: JsTileResult = wasm.tile_image(imageData, tileSize, 80);

    // 512/513 < 1 -> 1タイル（各方向）
    // 合計: 1x1 = 1タイル
    // 画像全体が1タイルに収まり、1pxの余白がパディングされる
    const expectedTiles = 1;

    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.tile_size).toBe(tileSize);
    expect(result.tiles.length).toBe(expectedTiles);

    const tile = result.tiles[0];
    expect(tile.x).toBe(0);
    expect(tile.y).toBe(0);
  });

  it('should handle 512x512 image with 1024px tiles (much larger than image)', () => {
    const tileSize = 1024;
    const result: JsTileResult = wasm.tile_image(imageData, tileSize, 80);

    // 512/1024 < 1 -> 1タイル（各方向）
    // 合計: 1x1 = 1タイル
    // 画像全体が1タイルの左上に配置され、残りは透明でパディング
    const expectedTiles = 1;

    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.tile_size).toBe(tileSize);
    expect(result.tiles.length).toBe(expectedTiles);

    const tile = result.tiles[0];
    expect(tile.x).toBe(0);
    expect(tile.y).toBe(0);
  });

  it('should handle all edge tiles correctly for 512x512 with 300px', () => {
    const tileSize = 300;
    const result: JsTileResult = wasm.tile_image(imageData, tileSize, 80);

    // 4つのタイルのうち、(1,0), (0,1), (1,1) は端のタイルでパディングが必要
    result.tiles.forEach((tile, i) => {
      const data = result.get_tile_data(i);

      // 全てのタイルがWebPデータを持つ
      expect(data.length).toBeGreaterThan(0);

      // WebPのマジックバイトを確認
      expect(data[0]).toBe(0x52); // 'R'
      expect(data[1]).toBe(0x49); // 'I'
      expect(data[2]).toBe(0x46); // 'F'
      expect(data[3]).toBe(0x46); // 'F'
    });
  });
});
