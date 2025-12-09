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
    const jsChunks = outputs.filter((chunk): chunk is import('rollup').RenderedChunk => chunk.type === 'chunk');
    const css = outputs.find(
      (asset) => asset.type === 'asset' && typeof asset.fileName === 'string' && /^pamphlet-viewer-.*\.css$/.test(asset.fileName)
    );

    const entry = jsChunks.find((chunk) => chunk.isEntry);
    const icons = jsChunks.filter((chunk) => chunk.name === 'pamphlet-viewer-icons');
    const vendor = jsChunks.filter((chunk) => chunk.name === 'pamphlet-viewer-vendor');

    if (!entry || !css) return;

    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(
      path.join(distDir, 'manifest.json'),
      JSON.stringify(
        {
          entry: entry.fileName,
          css: css.fileName,
          vendor: vendor.map((chunk) => chunk.fileName),
          icons: icons.map((chunk) => chunk.fileName)
        },
        null,
        2
      )
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
        entryFileNames: 'pamphlet-viewer-entry-[hash].js',
        chunkFileNames: 'pamphlet-viewer-[name]-[hash].js',
        manualChunks(id) {
          if (id.includes('lucide-svelte')) {
            return 'pamphlet-viewer-icons';
          }

          if (id.includes('node_modules')) {
            return 'pamphlet-viewer-vendor';
          }
        },
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
