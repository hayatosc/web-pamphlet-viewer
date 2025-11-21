import './app.css';
import PamphletViewer from './components/PamphletViewer.svelte';

// Web Componentの登録はSvelteが自動的に行う（customElement: true）
// ただし、ビルド後にも確実に登録されるように明示的にインポート
export { PamphletViewer };

// UMDビルドの場合、グローバルスコープに公開
if (typeof window !== 'undefined') {
  (window as any).PamphletViewer = PamphletViewer;
}
