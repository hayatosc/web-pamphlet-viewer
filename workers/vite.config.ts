import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import ssrPlugin from 'vite-ssr-components/plugin';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';

export default defineConfig({
  plugins: [
    cloudflare(),
    ssrPlugin(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        {
          src: '../wasm/pkg/*',
          dest: 'wasm',
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      'shared': path.resolve(__dirname, '../shared/src'),
      '/wasm': path.resolve(__dirname, '../wasm/pkg'),
    },
  },
  build: {
    rollupOptions: {
      external: ['/wasm/tile_wasm.js'],
    },
  },
});
