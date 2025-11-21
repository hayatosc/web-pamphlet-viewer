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
      formats: ['es', 'umd'],
      fileName: (format) => `pamphlet-viewer.${format}.js`
    },
    rollupOptions: {
      output: {
        assetFileNames: 'pamphlet-viewer.[ext]'
      }
    }
  }
});
