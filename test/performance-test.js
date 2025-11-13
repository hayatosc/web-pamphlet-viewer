const fs = require('fs');
const path = require('path');
const wasm = require('../wasm/pkg/tile_wasm.js');

async function performanceTest() {
    console.log('=== WASM Performance Test ===\n');

    try {
        const imagePath = path.join(__dirname, 'sample.jpg');
        const imageData = fs.readFileSync(imagePath);

        console.log(`Image: ${imagePath}`);
        console.log(`Size: ${imageData.length} bytes\n`);

        // 異なるタイルサイズでテスト
        const tileSizes = [128, 256, 512];
        const results = [];

        for (const tileSize of tileSizes) {
            console.log(`Testing with tile size: ${tileSize}px`);

            const iterations = 10;
            const times = [];

            for (let i = 0; i < iterations; i++) {
                const start = process.hrtime.bigint();
                const result = wasm.tile_image(imageData, tileSize, 80);
                const end = process.hrtime.bigint();

                const timeMs = Number(end - start) / 1000000;
                times.push(timeMs);

                if (i === 0) {
                    // 最初のイテレーションで結果を保存
                    results.push({
                        tileSize,
                        tileCount: result.tile_count(),
                        totalSize: Array.from({ length: result.tile_count() }, (_, i) =>
                            result.get_tile_data(i).length
                        ).reduce((a, b) => a + b, 0)
                    });
                }
            }

            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const minTime = Math.min(...times);
            const maxTime = Math.max(...times);

            console.log(`  Average: ${avgTime.toFixed(2)}ms`);
            console.log(`  Min: ${minTime.toFixed(2)}ms`);
            console.log(`  Max: ${maxTime.toFixed(2)}ms`);
            console.log();
        }

        // 結果サマリー
        console.log('=== Summary ===');
        console.log('Tile Size | Tile Count | Total Output Size | Compression Ratio');
        console.log('----------|------------|-------------------|------------------');

        for (let i = 0; i < tileSizes.length; i++) {
            const r = results[i];
            const compressionRatio = ((1 - r.totalSize / imageData.length) * 100).toFixed(1);
            console.log(
                `${r.tileSize}px`.padEnd(10) +
                `| ${r.tileCount}`.padEnd(11) +
                `| ${(r.totalSize / 1024).toFixed(1)}KB`.padEnd(18) +
                `| ${compressionRatio}%`
            );
        }

        console.log('\n✓ Performance test completed successfully!');

    } catch (error) {
        console.error('Error during performance test:', error);
        process.exit(1);
    }
}

performanceTest().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
