import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist');

const assetManifestPlugin = () => ({
  name: 'pamphlet-viewer-asset-manifest',
  writeBundle(_, bundle) {
    const outputs = Object.values(bundle);
    const js = outputs.find((chunk) => chunk.type === 'chunk' && /^pamphlet-viewer-.*\.js$/.test(chunk.fileName));
    const css = outputs.find((asset) => asset.type === 'asset' && typeof asset.fileName === 'string' && /^pamphlet-viewer-.*\.css$/.test(asset.fileName));

    if (!js || !css) return;

    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(
      path.join(distDir, 'pamphlet-viewer-assets.json'),
      JSON.stringify({ js: js.fileName, css: css.fileName }, null, 2)
    );
  }
});

export default defineConfig({
  plugins: [
    svelte(),
    tailwindcss(),
    assetManifestPlugin()
  ],
  build: {
    lib: {
      entry: './src/main.ts',
      name: 'PamphletViewer',
      formats: ['es']
    },
    rollupOptions: {
      output: {
        entryFileNames: 'pamphlet-viewer-[hash].js',
        chunkFileNames: 'pamphlet-viewer-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'pamphlet-viewer-[hash][extname]';
          }

          return '[name][extname]';
        },
      }
    }
  }
});
