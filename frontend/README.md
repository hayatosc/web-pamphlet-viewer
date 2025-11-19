# Frontend - Pamphlet Viewer Web Component

Svelte 5とTailwind CSS v4で構築された、パンフレットビューアのWeb Componentです。

## 技術スタック

- **Svelte 5**: Web Component化対応
- **Vite 6**: 高速ビルドツール
- **Tailwind CSS v4 (beta)**: ユーティリティファーストCSS
- **TypeScript**: 型安全な開発

## プロジェクト構造

```
frontend/
├── src/
│   ├── components/
│   │   └── PamphletViewer.svelte  # メインWeb Component
│   ├── lib/
│   │   ├── tile-loader.ts          # タイル並列読み込み
│   │   ├── canvas-renderer.ts      # Canvas描画ロジック
│   │   └── viewport.ts             # viewport計算
│   ├── types/
│   │   └── metadata.ts             # 型定義
│   ├── app.css                     # Tailwind CSS
│   └── main.ts                     # エントリポイント
├── index.html                      # 開発用HTML
├── vite.config.ts                  # Vite設定
├── svelte.config.js                # Svelte設定
└── package.json
```

## 開発

### インストール

```bash
pnpm install
```

### 開発サーバー起動

```bash
pnpm dev
```

ブラウザで http://localhost:5173 を開きます。

### ビルド

```bash
pnpm build
```

ビルド成果物は `dist/` に出力されます：
- `pamphlet-viewer.js` - ESM形式
- `pamphlet-viewer.umd.cjs` - UMD形式
- `pamphlet-viewer.css` - スタイル

### 型チェック

```bash
pnpm type-check
```

## 使い方

### Web Componentとして使用

ビルド後のファイルをHTMLに読み込み：

```html
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./dist/pamphlet-viewer.css">
  </head>
  <body>
    <pamphlet-viewer
      pamphlet-id="your-pamphlet-id"
      api-base="https://your-api.example.com"
    ></pamphlet-viewer>

    <script type="module" src="./dist/pamphlet-viewer.js"></script>
  </body>
</html>
```

### 属性

- **pamphlet-id** (必須): パンフレットID
- **api-base** (オプション): APIのベースURL（デフォルト: `''`）

### URLパラメータ

- **page**: 初回表示ページ（1始まり）
  - 例: `?page=3` で3ページ目から表示

## 機能

### 実装済み

- ✅ メタデータ取得とパース
- ✅ Canvasベースのページ描画
- ✅ タイルの並列読み込み（6並列、カスタマイズ可能）
- ✅ 優先度ベースのタイル読み込み（viewport内を優先）
- ✅ ページネーション（前へ/次へボタン、キーボード操作）
- ✅ URLパラメータによるページ指定
- ✅ 高DPI対応
- ✅ ローディングインジケーター
- ✅ Tailwind CSSによる完全スタイリング
- ✅ **モバイル最適化**
  - ピンチイン・ピンチアウト（ズーム: 0.5倍〜5倍）
  - 2本指パン（ズーム時に画像を移動）
  - スワイプでページ遷移（左右）
  - ダブルタップでズームリセット
  - タッチ操作最適化（パッシブリスナー、オーバースクロール防止）
  - モバイル向けUIボタンサイズ

### 操作方法

#### デスクトップ
- **←** (左矢印): 前のページへ
- **→** (右矢印): 次のページへ

#### モバイル
- **左スワイプ**: 次のページへ
- **右スワイプ**: 前のページへ
- **ピンチイン・アウト**: ズーム
- **2本指ドラッグ**: パン（ズーム時）
- **ダブルタップ**: ズームリセット

## アーキテクチャ

### タイル読み込み戦略

1. **viewport計算**: 現在表示されている領域のタイルを特定
2. **優先度付け**: viewport内のタイルを優先度10、その他を優先度1で読み込み
3. **並列制御**: 最大6並列でタイル取得（`TileLoader`で管理）
4. **キャッシュ**: 読み込んだタイルはメモリキャッシュに保存

### Canvas描画

- `CanvasRenderer`クラスがCanvas操作を管理
- デバイスピクセル比（DPR）対応で高解像度ディスプレイに最適化
- プレースホルダー表示で読み込み中のタイルを視覚化
- **ズーム・パン対応**: Canvas transformを使用した効率的な描画
  - スケール範囲: 0.5倍〜5倍
  - パン範囲制限で画像が画面外に行きすぎないように制御
  - requestAnimationFrameで滑らかな再描画

### タッチ操作

- `TouchHandler`クラスがタッチイベントを管理
- ピンチジェスチャー検出（2本指の距離計算）
- スワイプ検出（横方向のみ、縦方向の誤検出を防止）
- パッシブリスナーでスクロールパフォーマンス向上
- コンテキストメニュー・テキスト選択の無効化

### 状態管理

Svelte 5の`$state`、`$derived`、`$effect`を使用したリアクティブな状態管理。

## カスタマイズ

### 並列読み込み数の変更

`src/components/PamphletViewer.svelte`の`TileLoader`初期化部分：

```typescript
tileLoader = new TileLoader(6); // 6を任意の数に変更
```

### スタイルのカスタマイズ

Tailwind CSSのユーティリティクラスを直接編集するか、`app.css`にカスタムスタイルを追加します。

## トラブルシューティング

### Web Componentが表示されない

1. `pamphlet-id`と`api-base`が正しく設定されているか確認
2. APIエンドポイントが正しくレスポンスを返しているか確認（ブラウザの開発者ツールで確認）
3. CORSが正しく設定されているか確認

### タイルが読み込まれない

1. ブラウザのコンソールでエラーを確認
2. ネットワークタブでタイルリクエストのステータスを確認
3. APIのタイルエンドポイント（`/pamphlet/:id/tile/:hash`）が正しく動作しているか確認

## ライセンス

このプロジェクトはプライベートです。
