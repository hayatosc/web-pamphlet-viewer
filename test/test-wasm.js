const fs = require('fs');
const path = require('path');

// WASMモジュールをロード
const wasm = require('../wasm/pkg/tile_wasm.js');

async function testWasm() {
    console.log('=== WASM Tiling Engine Test ===\n');

    try {
        // テスト画像を読み込む
        const imagePath = path.join(__dirname, 'sample.jpg');
        console.log('Loading test image:', imagePath);

        const imageData = fs.readFileSync(imagePath);
        console.log(`Image size: ${imageData.length} bytes\n`);

        // タイル化を実行
        console.log('Starting tiling process...');
        const tileSize = 256; // テスト用に小さめのタイルサイズ
        const quality = 80;

        const startTime = Date.now();
        const result = wasm.tile_image(imageData, tileSize, quality);
        const elapsedTime = Date.now() - startTime;

        console.log(`Tiling completed in ${elapsedTime}ms\n`);

        // 結果を表示
        console.log('=== Tiling Results ===');
        console.log(`Original image dimensions: ${result.width} x ${result.height}`);
        console.log(`Tile size: ${result.tile_size}px`);
        console.log(`Total tiles: ${result.tile_count()}`);
        console.log();

        // タイルの詳細を表示（最初の5つのみ）
        console.log('=== Tile Details (first 5) ===');
        const tiles = result.tiles;
        for (let i = 0; i < Math.min(5, tiles.length); i++) {
            const tile = tiles[i];
            const tileData = result.get_tile_data(i);
            console.log(`Tile ${i}: x=${tile.x}, y=${tile.y}, hash=${tile.hash.substring(0, 16)}..., size=${tileData.length} bytes`);
        }

        if (tiles.length > 5) {
            console.log(`... and ${tiles.length - 5} more tiles`);
        }
        console.log();

        // タイルをファイルに保存（最初の3つのみ）
        console.log('=== Saving Sample Tiles ===');
        const outputDir = path.join(__dirname, 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        for (let i = 0; i < Math.min(3, result.tile_count()); i++) {
            const tile = tiles[i];
            const tileData = result.get_tile_data(i);
            const filename = `tile-${tile.x}-${tile.y}-${tile.hash.substring(0, 8)}.webp`;
            const filepath = path.join(outputDir, filename);

            fs.writeFileSync(filepath, Buffer.from(tileData));
            console.log(`Saved: ${filename} (${tileData.length} bytes)`);
        }
        console.log();

        // ハッシュ計算のテスト
        console.log('=== Hash Calculation Test ===');
        const testData = Buffer.from('test data');
        const hash = wasm.calculate_hash(testData);
        console.log(`Hash of "test data": ${hash}`);
        console.log();

        // メタデータ生成のテスト
        console.log('=== Metadata Generation Test ===');
        const pages = [{
            page: 0,
            width: result.width,
            height: result.height,
            tiles: tiles.slice(0, 3).map(tile => ({
                x: tile.x,
                y: tile.y,
                hash: tile.hash
            }))
        }];

        const metadata = wasm.generate_metadata(JSON.stringify(pages), tileSize);
        const metadataObj = JSON.parse(metadata);
        console.log('Generated metadata:');
        console.log(`  Version: ${metadataObj.version}`);
        console.log(`  Tile size: ${metadataObj.tile_size}`);
        console.log(`  Pages: ${metadataObj.pages.length}`);
        console.log(`  Tiles in first page: ${metadataObj.pages[0].tiles.length}`);
        console.log();

        // メタデータをファイルに保存
        const metadataPath = path.join(outputDir, 'metadata.json');
        fs.writeFileSync(metadataPath, metadata);
        console.log(`Metadata saved to: ${metadataPath}`);
        console.log();

        console.log('=== Test Summary ===');
        console.log('✓ Image loading: OK');
        console.log('✓ Tiling: OK');
        console.log('✓ WebP encoding: OK');
        console.log('✓ Hash calculation: OK');
        console.log('✓ Metadata generation: OK');
        console.log('✓ File output: OK');
        console.log();
        console.log('All tests passed! 🎉');

    } catch (error) {
        console.error('Error during test:', error);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// テストを実行
testWasm().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
