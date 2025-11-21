import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    svelte(),
    tailwindcss()
  ],
  build: {
    lib: {
      entry: './src/main.ts',
      name: 'PamphletViewer',
      formats: ['es']
    },
    rollupOptions: {
      output: {
        entryFileNames: 'pamphlet-viewer.[hash].js',
        chunkFileNames: 'pamphlet-viewer.[hash].js',
        assetFileNames: 'pamphlet-viewer.[hash].[ext]'
      }
    }
  }
});
