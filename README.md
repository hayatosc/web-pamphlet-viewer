# Web Pamphlet Viewer

InDesignなどのDTP成果物を、高速かつセキュアにWeb上で閲覧できるシステム。タイル化（タイルマップ方式）により大容量画像を効率的に配信し、Cloudflare WorkersのCache APIとR2を組み合わせてエッジでの高速配信を実現します。

## 主要コンポーネント

1. **Rust/WASM タイル化エンジン** ✅ 完了
   - ブラウザ上で画像をタイル分割（WebP）
   - SHA256ハッシュベースのタイル識別
   - 51テストスイート（機能・パフォーマンス・エッジケース）

2. **Cloudflare Workers API (Hono)** ✅ 完了
   - R2直接アクセス、Cache API統合
   - アップローダーUI（Hono JSX）
   - プログレッシブメタデータ取得（ページ範囲指定）

3. **Svelte 5 Web Component** ✅ 完了
   - 再利用可能なビューア（`<pamphlet-viewer>`）
   - Vite 6 + Tailwind CSS v4
   - hono/client による型安全なAPI呼び出し
   - モバイル最適化（ピンチズーム、スワイプ）

## 技術スタック

### Frontend
- **Svelte 5.1.9**: 最新runes（$state, $derived, $effect）
- **Vite 6.0.1**: ビルドツール
- **Tailwind CSS v4.0.0-beta.5**: ユーティリティファーストCSS
- **hono/client**: 型安全なRPC-style API呼び出し
- **lucide-svelte**: アイコンライブラリ
- **TypeScript 5.7.2**: 厳格な型チェック

### Backend
- **Cloudflare Workers**: エッジコンピューティング
- **Hono**: 軽量Webフレームワーク
- **R2**: オブジェクトストレージ
- **Cache API**: エッジキャッシュ

### WASM
- **Rust**: 画像タイル化エンジン
- **wasm-bindgen**: JS/Rust相互運用
- **image crate**: 画像エンコード/デコード

## 実装状況

### ✅ Phase 1: 基盤構築（完了）
- pnpm workspace セットアップ
- Workers Hono基本実装
- R2バインディング設定
- Cache API統合

### ✅ Phase 2: WASM開発（完了）
- Rust プロジェクト作成
- 画像タイル化ロジック実装（パディング対応）
- SHA256ハッシュ・metadata生成
- wasm-pack ビルド確認
- 包括的なテストスイート（51テスト）
- 型定義の共有化（shared/types/wasm.ts）

### ✅ Phase 3: フロント開発（完了）
- Hono JSX アップローダーUI実装
- Svelte 5 + Vite 6 + Tailwind v4 セットアップ
- PamphletViewer.svelte 実装（Canvas描画、タイル取得）
- Web Component化（`<pamphlet-viewer>`）
- hono/client による型安全なAPI呼び出し
- プログレッシブローディング戦略（初期6ページ → バックグラウンドで残り）
- モバイル最適化（ピンチズーム、スワイプ、タッチジェスチャー）
- lucide-svelte アイコン統合
- コード分割（hooks、components）
- 型チェック完全パス（svelte-check + tsc）

### 🚧 Phase 4: 統合（進行中）
- /upload エンドポイント実装（ZIP展開、R2書き込み）
- CORS設定
- エラーハンドリング・ログ

### 📋 Phase 5: 最適化・テスト（未着手）
- キャッシュ戦略テスト
- パフォーマンステスト
- ブラウザ互換性テスト

## 開発環境セットアップ

```bash
# 依存関係インストール
pnpm install

# WASM ビルド
cd wasm
pnpm build

# Frontend 開発サーバー
cd frontend
pnpm dev

# Workers ローカル開発
cd workers
pnpm dev
```

## 主要機能

### プログレッシブローディング
- 初回表示: URLパラメータ周辺6ページのみ取得（高速表示）
- バックグラウンド: 残りページを50ページずつ並列取得（Cloudflare最適化）

### モバイル最適化
- ピンチズーム: 0.5x-5x
- 2本指パン: ズーム中のみ
- スワイプ: ページ遷移
- ダブルタップ: リセット

### 型安全性
- hono/client RPC-style API呼び出し
- workers/src/types/api.ts でAppType定義
- svelte-check + tsc でゼロエラー

### パフォーマンス最適化
- タイルメモリキャッシュ（Map<hash, HTMLImageElement>）
- ObjectURL + revokeObjectURL でメモリリーク防止
- 優先度キューでviewport内タイル優先
- Cloudflare Edge Cache（30日TTL）

## ドキュメント

詳細なアーキテクチャ設計については [CLAUDE.md](./CLAUDE.md) を参照してください。

## ライセンス

MIT
