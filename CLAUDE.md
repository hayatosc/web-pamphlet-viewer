# パンフレットビューア - アーキテクチャ設計書

## プロジェクト概要

InDesignなどのDTP成果物を、高速かつセキュアにWeb上で閲覧できるシステム。タイル化（タイルマップ方式）により大容量画像を効率的に配信し、Cloudflare WorkersのCache APIとR2を組み合わせてエッジでの高速配信を実現する。

### 主要コンポーネント

1. **Rust/WASM タイル化エンジン** - ブラウザ上で画像をタイル分割
2. **Cloudflare Workers API (Hono)** - R2直接アクセス、Cache API統合、アップローダーUI（Hono JSX）
3. **Svelte 5 Web Component** - 再利用可能なビューア（`<pamphlet-viewer>`）

---

## アーキテクチャ概要

### データフロー（アップロード時）

```
ブラウザ（管理者）
  ↓ 画像ファイル群（InDesign出力）
Rust/WASM（ブラウザ内）
  - タイル化（例: 512x512px WebP）
  - SHA256ハッシュ計算（タイル識別用、64文字の16進数）
  - metadata.json生成（各タイルの座標とハッシュのマッピング）
  ↓ タイル群 + metadata（FormData: tile-{hash} フィールド）
Workers /upload エンドポイント
  - R2へ書き込み（ハッシュベース）: pamphlets/{id}/tiles/{hash}.webp
  - R2へmetadata保存: pamphlets/{id}/metadata.json
  - version番号（タイムスタンプ）生成（将来的な用途のため保存）
  ↓
R2 に永続化
```

### データフロー（閲覧時）

```
ブラウザ（閲覧者）- 公開アクセス、認証不要
  ↓ GET /pamphlet/:id/metadata?pages=X-Y （プログレッシブローディング）
Workers
  - R2から metadata.json 取得 (pamphlets/{id}/metadata.json)
  - ページ範囲フィルタリング（start-end）
  ↓ metadata（指定範囲のpages配列、tile_size、version、total_pages、has_more）を返す
ブラウザ（Svelte 5 Web Component）
  【初期表示フェーズ】
  - 初回: URLパラメータ（?page=X）周辺6ページのみ取得
  - Canvas初期化（現在ページ）
  - viewport計算 → 必要タイル特定（優先度10）
  - 残りタイル（優先度1）

  【バックグラウンドフェーズ】
  - 残りページを50ページずつ並列取得（待機時間なし、Cloudflare最適化）
  - metadataから座標に対応するhashを取得

  ↓ GET /pamphlet/:id/tile/:hash （hono/client RPC、6並列制御）
Workers
  - Cache API チェック（caches.default）
    - キャッシュキー: リクエストURL（例: https://api.example.com/pamphlet/{id}/tile/{hash}）
  - HIT → 即座に返す（エッジキャッシュ、レイテンシ 10-30ms）
  - MISS → R2バインディングで取得
    - パス: pamphlets/{id}/tiles/{hash}.webp
    - Content-Type: image/webp
    - Cache-Control: public, max-age=86400, s-maxage=2592000, CDN-Cache-Control: max-age=2592000
    - Cache APIに put（エッジキャッシュ）
  ↓ タイル画像（WebP、Blob）
ブラウザ
  - ObjectURL経由でImage読み込み
  - Canvasに描画（CanvasRenderer）
  - URLリーク防止（revokeObjectURL）
  - タッチジェスチャー対応（ピンチズーム、スワイプ）
```

### なぜこの構成か

#### 署名付きURLの問題とキャッシュ可能な設計

**R2署名付きURLの課題:**

1. **キャッシュ不可**: R2の`presignedUrl`は、URL自体に有効期限やクエリパラメータ（署名）が含まれるため、リクエストごとにURLが異なる
   - キャッシュは「同一URL」が前提 → 署名付きURLは毎回異なるためキャッシュヒットしない
   - 結果: 毎回R2オリジンまでアクセスが発生（レイテンシ増、コスト増）

2. **セキュリティリスク**: 署名付きURLが漏洩すると、有効期限内は誰でもアクセス可能

3. **パフォーマンス**: キャッシュされないため、4KB程度の小さな画像でも800ms程度のレイテンシが発生する事例あり

**本システムの解決策:**

- **Workers内でキャッシュ可能なURLを提供**
  - クライアントには「署名が含まれない、同一のURL」を配布（例: `/pamphlet/{id}/tile/{hash}`）
  - Workers が R2 から取得したレスポンスを Cache API に保存
  - 2回目以降はエッジキャッシュからHIT → レイテンシ30ms以下に改善

- **エッジキャッシュの最大活用**:
  - Cloudflareエッジネットワーク（330都市以上）でタイルをキャッシュ
  - 世界中の閲覧者に低レイテンシで配信
  - R2へのリクエスト数削減 → コスト最適化

- **シンプルなURLベースキャッシング**:
  - リクエストURLをそのままキャッシュキーとして使用（ダミーURL不要）
  - キャッシュ無効化は `/invalidate` エンドポイントでメタデータキャッシュをクリア
  - タイルキャッシュはTTL（30日）で自然に期限切れ、または手動で削除可能
  - 実装がシンプルで保守性が高い

- **ハッシュベースURLによる限定的セキュリティ**:
  - **ハッシュベースURL**: タイルURLが座標から推測不可能（`/tile/:hash`）
    - 座標ベース（`/tile/:x/:y`）だと連番でアクセス可能 → ハッシュベースで防止
    - ただし、metadataは公開されており、全タイルのhash情報が含まれる
  - **公開アクセス方式**:
    - 全てのエンドポイント（metadata、tile）は認証不要で公開
    - 用途: パンフレット、カタログ等の公開コンテンツ配信
    - 機械的ダウンロードは技術的に防げない（許容する設計）
  - **オプション: 機械的アクセス対策**:
    1. **Rate Limiting** (Cloudflare標準機能): 1IPあたり秒間リクエスト数制限（例: 10req/sec）
    2. **Referrer/Origin チェック**: 特定ドメインからのみアクセス許可（ただし偽装可能）
    3. **Cloudflare Bot Management** (有料): 機械的アクセス検出・制限、人間のブラウザは許可
    4. **コンテンツ保護**: 透かし、低解像度版の配布、利用規約による規制
  - **管理エンドポイント保護**:
    - `POST /pamphlet/:id/invalidate` はCloudflare Access、API key等で保護推奨
    - アップロードエンドポイントも同様に保護

**参考**:
- Cloudflare Meetup 2023の「キャッシュ可能な署名付きURL」パターン（Oliver氏）を参考にキャッシュ設計を最適化
- 公開コンテンツ配信のため、認証は削除してシンプルな設計に

---

## プロジェクト構造（pnpm workspace）

### ディレクトリ構成

```
web-pamphlet-viewer/
├── pnpm-workspace.yaml        # pnpmワークスペース定義
├── package.json               # ルートpackage.json（共通dev依存等）
├── .gitignore                 # Git除外設定
├── CLAUDE.md                  # 本ファイル（アーキテクチャ設計書）
├── README.md                  # プロジェクト概要
│
├── workers/                   # Cloudflare Workers (Hono API + JSX UI)
│   ├── package.json           # workers依存関係
│   ├── wrangler.toml          # Workers設定、R2/KVバインディング、環境変数
│   ├── tsconfig.json          # TypeScript設定
│   ├── .dev.vars              # ローカル開発用環境変数（.gitignore）
│   └── src/
│       ├── index.ts           # Honoアプリエントリポイント
│       │                      # - ルーティング定義
│       │                      # - ミドルウェア適用
│       │                      # - エラーハンドリング
│       ├── routes/
│       │   ├── upload.ts      # POST /upload (API)
│       │   │                  # - multipart/form-data 受信
│       │   │                  # - ZIP展開
│       │   │                  # - R2書き込み（並列）
│       │   │                  # - metadata更新（R2）
│       │   └── pamphlet.ts    # パンフレット閲覧エンドポイント
│       │                      # - GET /:id/metadata (metadataキャッシュ統合)
│       │                      # - GET /:id/tile/:hash (タイルキャッシュ)
│       │                      # - POST /:id/invalidate (キャッシュ無効化)
│       ├── pages/
│       │   └── uploader.tsx   # GET /upload (Hono JSX UI)
│       │                      # - アップローダー画面レンダリング
│       │                      # - WASM初期化スクリプト
│       │                      # - クライアントサイドJS埋め込み
│       ├── middleware/
│       │   ├── metadata.ts    # メタデータ読み込みミドルウェア
│       │   │                  # - Cache APIチェック
│       │   │                  # - R2から取得（cache miss時）
│       │   │                  # - Cache保存
│       │   │                  # - c.set('metadata', ...)
│       │   └── cache.ts       # キャッシュミドルウェアファクトリ
│       │                      # - createCacheMiddleware()
│       │                      # - カスタムキャッシュヘッダー設定
│       ├── services/
│       │   ├── r2.ts          # R2操作ヘルパー
│       │   │                  # - ファイル書き込み
│       │   │                  # - ファイル取得（metadata、tile）
│       │   │                  # - パス生成ユーティリティ
│       │   └── cache.ts       # Cache API操作ヘルパー
│       │                      # - getFromCache(url)
│       │                      # - putIntoCache(url, response)
│       │                      # - deleteFromCache(url)
│       └── types/
│           └── bindings.ts    # Workers bindings型定義
│                              # - Env型（R2_BUCKET等）
│                              # - Variables型
│
├── wasm/                      # Rust/WASM タイル化エンジン
│   ├── Cargo.toml             # Rust依存関係、crateメタデータ
│   ├── Cargo.lock             # 依存関係ロックファイル
│   ├── package.json           # wasm-pack ビルドスクリプト
│   ├── .gitignore             # pkg/ を除外
│   └── src/
│       ├── lib.rs             # wasm-bindgen エントリポイント
│       │                      # - JS公開関数定義
│       │                      # - モジュール宣言
│       ├── tiler.rs           # タイル化ロジック
│       │                      # - 画像デコード
│       │                      # - タイル分割
│       │                      # - WebPエンコード
│       │                      # - 重複排除
│       └── hasher.rs          # SHA256ハッシュ計算
│                              # - タイル命名用
│                              # - 重複検出用
│   └── pkg/                   # wasm-pack出力先（.gitignore）
│       ├── *.wasm             # WASMバイナリ
│       ├── *.js               # JSバインディング
│       └── *.d.ts             # TypeScript型定義
│
├── frontend/                  # Svelte 5 Web Component (Viewer only)
│   ├── package.json           # frontend依存関係
│   ├── vite.config.ts         # Vite設定（Svelte plugin、build設定）
│   ├── svelte.config.js       # Svelte設定（customElement: true）
│   ├── tsconfig.json          # TypeScript設定
│   ├── .gitignore             # dist/ を除外
│   └── src/
│       ├── components/
│       │   └── PamphletViewer.svelte
│       │                      # <pamphlet-viewer> Web Component
│       │                      # - metadata取得
│       │                      # - Canvas描画
│       │                      # - タイル並列取得
│       │                      # - ページネーション
│       │                      # - ズーム/パン
│       ├── lib/
│       │   ├── tile-loader.ts            # タイル並列取得ロジック
│       │   │                             # - 優先度キュー管理
│       │   │                             # - プリフェッチ戦略
│       │   │                             # - 並列数制御（p-queue）
│       │   ├── canvas-renderer.ts        # Canvas描画ロジック
│       │   │                             # - タイル配置計算
│       │   │                             # - ImageBitmap描画
│       │   │                             # - 高DPI対応
│       │   └── viewport.ts               # viewport計算ロジック
│       │                                 # - 可視タイル特定
│       │                                 # - スクロール検出
│       ├── types/
│       │   └── metadata.ts               # metadata.json型定義
│       │                                 # - Metadata, Page, Tile型
│       └── main.ts                       # エントリポイント
│                                         # - customElements.define()
│                                         # - Web Component登録
│   └── dist/                             # ビルド出力（.gitignore）
│       └── pamphlet-viewer.js            # 単一バンドル（UMD or ESM）
│
└── shared/                    # 共通型定義・ユーティリティ（オプション）
    ├── package.json           # shared依存関係
    ├── tsconfig.json          # TypeScript設定
    └── src/
        ├── types/
        │   ├── metadata.ts    # metadata.json共通型（workers/frontendで共有）
        │   └── api.ts         # API レスポンス型
        └── utils/
            └── constants.ts   # 定数（TILE_SIZE等）
```

### pnpm workspace設定ファイル

#### pnpm-workspace.yaml

```yaml
packages:
  - 'workers'
  - 'wasm'
  - 'frontend'
  - 'shared'
```

#### ルート package.json

```json
{
  "name": "web-pamphlet-viewer",
  "version": "1.0.0",
  "private": true,
  "description": "InDesign pamphlet viewer with tiling and edge caching",
  "scripts": {
    "dev": "pnpm --filter workers dev",
    "build": "pnpm --filter wasm build && pnpm --filter frontend build && pnpm --filter workers build",
    "deploy": "pnpm --filter workers deploy",
    "lint": "pnpm --recursive run lint",
    "type-check": "pnpm --recursive run type-check"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0",
    "prettier": "^3.1.0",
    "eslint": "^8.55.0"
  },
  "engines": {
    "node": ">=20",
    "pnpm": ">=8"
  }
}
```

### 各ワークスペースのpackage.json例

#### workers/package.json

```json
{
  "name": "workers",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "build": "tsc --noEmit",
    "type-check": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "hono": "^4.0.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20231218.0",
    "wrangler": "^3.22.0",
    "typescript": "^5.3.0"
  }
}
```

#### wasm/package.json

```json
{
  "name": "wasm",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "wasm-pack build --target web --out-dir pkg",
    "build:release": "wasm-pack build --release --target web --out-dir pkg",
    "test": "cargo test"
  },
  "devDependencies": {
    "wasm-pack": "^0.12.0"
  }
}
```

#### frontend/package.json

```json
{
  "name": "frontend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "type-check": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "svelte": "^5.0.0",
    "p-queue": "^8.0.0"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "vite": "^5.0.0",
    "typescript": "^5.3.0"
  }
}
```

#### shared/package.json

```json
{
  "name": "shared",
  "version": "1.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types/index.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

### .gitignore

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
pkg/
target/

# Environment
.env
.dev.vars
.wrangler/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
```

### ワークスペース間の依存関係

```
shared (共通型定義)
  ↓ 参照
workers ← wasm/pkg (WASM配信用)
  ↓ API提供
frontend → workers (HTTP経由)
frontend → wasm/pkg (import)
```

- **shared**: workers と frontend で共通の型定義を参照（`shared`を依存に追加）
- **workers**: wasm/pkg をアップローダーUI経由で配信（Workers Assets）
- **frontend**: wasm/pkg を開発時に `import` して型チェック
- **API通信**: frontend → workers はHTTP経由（ビルド時依存なし）

---

## 各コンポーネントの責務と実装方針

### 1. workers/ - Cloudflare Workers API (Hono)

#### 責務

- R2への読み書き（直接バインディング経由）
  - タイル画像の保存・取得
  - metadata.jsonの保存・取得
- Cache API（caches.default）を使ったエッジキャッシュ
- CORS設定

#### 実装方針

**wrangler.toml 設定**
- R2バケット: `pamphlet-storage` をバインディング `R2_BUCKET` として設定
- メタデータとタイル画像の両方をR2に保存（KV不使用）

**主要エンドポイント**

1. `GET /upload` (Hono JSX UI)
   - Hono JSXでアップローダーUIをレンダリング
   - 画面内容:
     - ドラッグ&ドロップエリア（複数画像対応）
     - WASM初期化スクリプト読み込み（`<script src="/wasm/pkg/...">`)
     - タイル化進捗表示（ページ単位）
     - アップロード実行ボタン
   - クライアントサイドJS:
     - WASM呼び出し（`tile_image()`）
     - タイルをハッシュごとにFormDataに追加（`tile-{hash}`）
     - `POST /upload` にmultipart送信
     - 並列数制御（例: 6並列）
   - レスポンス: HTML（Hono JSX）

2. `POST /upload` (API)
   - ペイロード: multipart/form-data（タイル: `tile-{hash}`、metadata: JSON文字列）またはJSON（metadata のみ）
   - 処理:
     - FormDataからハッシュベースのタイルを取得（`tile-{hash}` パターン）
     - R2に各タイルを書き込み（ハッシュベース）: `pamphlets/{id}/tiles/{hash}.webp`
     - metadata.jsonをR2に保存: `pamphlets/{id}/metadata.json`
     - metadata.versionを生成（timestamp、将来的な用途のため保存）
   - レスポンス: `{ id, version, status: 'ok' }`
   - **注意**: アップロード後、メタデータキャッシュを無効化したい場合は `/invalidate` エンドポイントを使用

3. `GET /pamphlet/:id/metadata`
   - **公開アクセス**: 認証不要
   - **ミドルウェア**: `loadMetadata`
     - Cache APIチェック（キャッシュキー: リクエストURL）
     - キャッシュミス時: R2から `pamphlets/{id}/metadata.json` を取得
     - レスポンス成功時: Cache APIに保存
   - レスポンス: metadata.json（pages配列、tile_size、version、各タイルのhash情報等）
   - Cache-Control: `private, max-age=60`

4. `GET /pamphlet/:id/tile/:hash`
   - **公開アクセス**: 認証不要
   - **ミドルウェア**: `tileCache` (createCacheMiddleware)
     - Cache APIチェック（キャッシュキー: リクエストURL）
     - キャッシュミス時: 次のハンドラを実行
     - レスポンス成功時: Cache APIに保存
   - ハッシュ形式検証: 64文字の16進数（SHA256）
   - R2バインディングで取得: `R2_BUCKET.get('pamphlets/{id}/tiles/{hash}.webp')`
   - レスポンスヘッダ:
     - `Content-Type: image/webp`
     - `Cache-Control: public, max-age=86400, s-maxage=2592000`
     - `CDN-Cache-Control: max-age=2592000`
   - レスポンス: 画像バイナリ（WebP）

5. `POST /pamphlet/:id/invalidate` (管理用)
   - **管理エンドポイント**: Cloudflare Access、API key等で保護推奨
   - メタデータURLを構築（`/pamphlet/{id}/metadata`）
   - Cache APIから該当URLのキャッシュを削除
   - レスポンス: `{ id, status, message, deleted }`
   - **注意**: タイルキャッシュは削除しない（TTLで自然に期限切れ、または個別に削除可能）

**キャッシュ無効化戦略**

- **メタデータキャッシュのクリア** (`POST /pamphlet/:id/invalidate`)
  - `/pamphlet/{id}/metadata` のキャッシュを削除
  - 次回アクセス時にR2から最新のメタデータを取得
  - クライアントは最新のタイルハッシュ情報を受け取る

- **タイルキャッシュの扱い**
  - 基本: TTL（30日）で自然に期限切れ
  - 即時削除が必要な場合: 各タイルURLのキャッシュを `cache.delete()` で個別削除
  - 大量タイルの場合は並列削除（コスト注意）

- **実装方針**
  - URLベースのシンプルなキャッシング（バージョン管理不要）
  - ミドルウェアで統一的なキャッシュ処理
  - `createCacheMiddleware()` ファクトリでカスタムキャッシュヘッダー設定可能

**並列処理・制御**

- アップロード時のR2書き込み: Promise.all で並列化（並列数は調整、例: 10並列）
- タイル取得時のCache API操作: 自然に並列化される

**Hono JSX によるアップローダーUI実装**

- `GET /upload` エンドポイントで Hono JSX を使ってHTML生成
- 依存パッケージ: `hono` (JSX機能は標準搭載)
- 実装方針:
  - `src/pages/uploader.tsx` に JSX コンポーネントを作成
  - HTML内に `<script>` タグでクライアントサイドロジックを埋め込み:
    - WASM初期化（`wasm/pkg/` から読み込み）
    - ドラッグ&ドロップイベントハンドラ
    - タイル化処理ループ（Web Worker推奨）
    - ZIP生成（JSZip CDN or Workers経由）
    - `POST /upload` に multipart 送信
  - スタイル: インラインCSS or Workers Assets（静的ファイル配信）
  - レイアウト:
    ```tsx
    export const UploaderPage = () => (
      <html>
        <head>
          <title>Pamphlet Uploader</title>
          <script src="/wasm/pkg/tile_wasm.js"></script>
          <script src="https://cdn.jsdelivr.net/npm/jszip@3/dist/jszip.min.js"></script>
        </head>
        <body>
          <h1>Upload Pamphlet</h1>
          <div id="drop-zone">Drag & drop images here</div>
          <div id="progress"></div>
          <script>{`/* client-side logic */`}</script>
        </body>
      </html>
    );
    ```
  - WASM配信: Workers Assets または R2 経由で `/wasm/pkg/*` を配信

---

### 2. wasm/ - Rust/WASM タイル化エンジン

#### 責務

- ブラウザ上で画像をタイル分割（例: 512x512px）
- WebP形式にエンコード
- SHA256ハッシュ計算（タイル識別用）
- metadata.json生成
- タイルサイズが画像の約数でない場合のパディング処理

#### 実装方針

**依存クレート**

- `wasm-bindgen`: JSとのインターフェース（v0.2.95）
- `js-sys`: JavaScript標準ライブラリへのアクセス（タイムスタンプ生成等）
- `web-sys`: Web API（console等）
- `image`: 画像デコード・エンコード（v0.25.5、png/jpeg/webp features有効）
- `sha2`: SHA256ハッシュ計算（v0.10.8）
- `hex`: ハッシュの16進数文字列変換（v0.4.3）
- `serde`, `serde_json`: metadata生成・シリアライズ用（v1.0系）
- `serde-wasm-bindgen`: Rust型とJavaScript型の相互変換（v0.6.5）
- `console_error_panic_hook`: エラーログ改善（optional、デフォルト有効）
- `wee_alloc`: メモリ最適化（optional、現在未使用）

**主要関数**

1. `tile_image(image_data: &[u8], tile_size: u32, quality: Option<f32>) -> JsValue`
   - 入力: 画像バイナリ（JPEG/PNG等）、タイルサイズ、品質（未サポート）
   - 処理:
     - imageクレートでデコード
     - 切り上げ除算でタイル数を計算（`(width + tile_size - 1) / tile_size`）
     - タイルサイズでループ切り出し
     - 端のタイルは透明ピクセル（RGBA [255,255,255,0]）でパディング
     - 各タイルをWebPエンコード（品質パラメータは現在未サポート、image crateの制限）
     - SHA256ハッシュ計算 → タイル識別用（64文字の16進数文字列）
     - **注**: 全タイルを保持（重複排除なし）。座標→ハッシュのマッピングが容易
   - 出力: `{ tiles: [{ x, y, hash, data: Uint8Array }], width, height, tile_size }`

2. `generate_metadata(pages: Vec<PageInfo>) -> String`
   - 各ページのタイル情報を集約
   - JSON生成:
     ```json
     {
       "version": "timestamp",
       "tile_size": 512,
       "pages": [
         {
           "page": 0,
           "width": 2480,
           "height": 3508,
           "tiles": [
             { "x": 0, "y": 0, "hash": "abc123..." },
             ...
           ]
         }
       ]
     }
     ```

**メモリ管理**

- 大きな画像を扱うため、ページ単位で処理（一度に全ページをメモリに載せない）
- Web Worker内で実行してUIスレッドをブロックしない

**wasm-pack ビルド**

- `wasm-pack build --target web --out-dir pkg`
- 出力: `pkg/` に `.wasm`, `.js`, `.d.ts` が生成される
- frontendからは `import init, { tile_image } from '../../wasm/pkg'` で読み込み

---

### 3. frontend/ - Svelte 5 Web Component

#### 責務

- Web Component形式でビューア提供（`<pamphlet-viewer>`）
- 任意のHTMLページに埋め込み可能
- Canvas描画、タイル並列取得、viewport計算

#### 実装方針（実装済み）

**技術スタック**

- **Svelte 5.1.9**: 最新のrunes（$state, $derived, $effect）を使用
- **Vite 6.0.1**: ビルドツール、開発サーバー
- **Tailwind CSS v4.0.0-beta.5**: ユーティリティファーストCSS、カスタムCSSなし
- **hono/client**: 型安全なRPC-style API呼び出し
- **lucide-svelte 0.554.0**: アイコンライブラリ（ページネーション等）
- **TypeScript 5.7.2**: 厳格な型チェック

**Svelte 5 Web Component化**

- `svelte.config.js` で `customElement: true` を設定
- `<svelte:options customElement="pamphlet-viewer" />` を指定
- ビルド出力: `dist/pamphlet-viewer.js`（ESM + UMD）

**コンポーネント構成**

- **PamphletViewer.svelte**: メインコンポーネント（110行、リファクタリング済み）
- **ViewerCanvas.svelte**: Canvas表示コンテナ
- **PaginationControls.svelte**: ページネーション UI（lucide-svelte アイコン使用）
- **LoadingOverlay.svelte**: ローディング状態表示

**hooks（カスタムロジック）**

- **usePamphletViewer.ts**: パンフレット表示ロジック（300行）
  - プログレッシブローディング（初期6ページ → バックグラウンドで残り50ページずつ）
  - URLパラメータ対応（`?page=3`）
  - ページ遷移管理
- **useTouchGestures.ts**: タッチジェスチャー処理
  - ピンチズーム（0.5x-5x）
  - 2本指パン
  - スワイプでページ遷移
  - ダブルタップでリセット

**ライブラリ（自作）**

- **api-client.ts**: hono/clientラッパー（型安全なAPI呼び出し）
- **tile-loader.ts**: タイル並列取得（6並列、優先度キュー）
- **canvas-renderer.ts**: Canvas描画エンジン（高DPI対応、transform管理）
- **viewport.ts**: viewport計算ユーティリティ
- **touch-handler.ts**: TouchEvent処理クラス

#### PamphletViewer実装詳細

**props（attribute）**

- `pamphlet-id`: string（必須）
- `api-base`: string（Workers URL、デフォルト `''`）

**主要機能**

1. **プログレッシブメタデータ取得**（Cloudflare最適化）
   - 初回: URLパラメータ周辺6ページのみ取得（`?pages=X-Y`）
   - バックグラウンド: 残りを50ページずつ並列取得（待機時間なし）
   - hono/client RPC呼び出し:
     ```typescript
     const res = await client.pamphlet[':id'].metadata.$get({
       param: { id: pamphletId },
       query: { pages: `${start}-${end}` }
     });
     ```

2. **Canvas描画**
   - devicePixelRatio考慮（高DPI対応）
   - Canvas transform管理（scale, translate）
   - プレースホルダー描画 → タイル読み込み順次更新

3. **viewport最適化タイル取得**
   - viewport内タイルを優先度10で先読み
   - 残りタイルは優先度1でバックグラウンド取得
   - TileLoaderクラスで6並列制御（カスタム実装、p-queue不使用）

4. **タイル取得（hono/client）**
   ```typescript
   const res = await client.pamphlet[':id'].tile[':hash'].$get({
     param: { id, hash }
   });
   const blob = await res.blob();
   const img = await loadImageFromBlob(blob); // ObjectURL経由
   ```

5. **モバイル最適化**
   - TouchHandlerクラスでジェスチャー管理
   - ピンチズーム: getDistance()で2点間距離計算
   - スワイプ: 水平移動量でページ遷移判定
   - ダブルタップ: 300ms以内の2回タップでリセット
   - passive: true リスナーでスクロール性能向上

6. **ページネーション**
   - lucide-svelte（ChevronLeft/Right）アイコン使用
   - レスポンシブ: モバイルはアイコンのみ、デスクトップはテキスト付き
   - キーボード: 左右矢印キー、スワイプ、ボタンでページ遷移
   - URLパラメータ自動更新（`?page=X`）

7. **ズーム・パン**
   - CanvasRendererがtransform管理（setScale, setPan, resetTransform）
   - ピンチズーム: 0.5x - 5.0x
   - 2本指パン: ズーム中のみ
   - ダブルタップ: リセット（scale=1, pan=0）

8. **型安全性**
   - workers/src/types/api.ts でAppType定義
   - frontend/src/types/api.ts でre-export
   - hono/clientで完全型推論（`as any`なし）
   - svelte-check + tsc でゼロエラー

**UI要素（Tailwind v4）**

- Canvas要素（shadow-lg、max-w-full、max-h-full）
- ページネーションコントロール（flex、items-center、gap-4）
- lucide-svelteアイコン（size={20}、モバイル最適化）
- ローディングオーバーレイ（absolute、inset-0、bg-black/50）
- レスポンシブデザイン（sm:, md: breakpoints使用）

**パフォーマンス最適化**

- タイルメモリキャッシュ（Map<hash, HTMLImageElement>）
- ObjectURL + revokeObjectURL でメモリリーク防止
- 優先度キューで viewport内タイル優先
- Cloudflare向け並列数最適化（6並列、待機時間なし）
- バックグラウンドメタデータフェッチ（50ページバッチ）

---

## キャッシュ設計

### 階層

1. **ブラウザキャッシュ**
   - タイルレスポンス（image/webp）は `Cache-Control: public, max-age=86400` でブラウザキャッシュ
   - メモリキャッシュ（Map in JS）で重複リクエスト防止

2. **Cloudflare Edge Cache（Cache API）**
   - Workers の `caches.default` に保存
   - **キャッシュキー**: リクエストURL（例: `https://api.example.com/pamphlet/{id}/tile/{hash}`）
   - TTL: タイル30日（`s-maxage=2592000`）、メタデータ60秒（`max-age=60`）
   - ミドルウェアで自動的にキャッシュ管理

3. **R2（オリジンストレージ）**
   - 永続化
   - キャッシュミス時のみアクセス

### キャッシュキー設計

**URLベースのシンプルなキャッシング**

```
メタデータ: https://api.example.com/pamphlet/{id}/metadata
タイル:     https://api.example.com/pamphlet/{id}/tile/{hash}
```

- リクエストURLをそのままキャッシュキーとして使用
- ダミーURLの構築不要、実装がシンプル
- ミドルウェア（`loadMetadata`、`createCacheMiddleware`）が自動的に `c.req.url` を使用

### キャッシュ無効化フロー

**メタデータ無効化（POST /pamphlet/:id/invalidate）**

1. メタデータURLを構築: `/pamphlet/{id}/metadata`
2. `cache.delete(url)` でキャッシュから削除
3. 次回アクセス時にR2から最新のメタデータを取得
4. クライアントは最新のタイルハッシュ情報を受け取る

**タイルキャッシュの扱い**

- 基本: TTL（30日）で自然に期限切れ
- 即時削除が必要な場合: 各タイルURLを `cache.delete()` で個別削除
- 実装例:
  ```typescript
  const tileUrl = new URL(`/pamphlet/${id}/tile/${hash}`, c.req.url);
  await deleteFromCache(tileUrl.toString());
  ```

### ミドルウェアアーキテクチャ

**loadMetadata ミドルウェア**
- Cache APIチェック → R2取得 → Cache保存の一連の流れを統合
- コンテキスト変数 `c.set('metadata', metadata)` に保存
- レスポンス成功時（200）に自動的にキャッシュ保存

**createCacheMiddleware ファクトリ**
- カスタムキャッシュヘッダーを指定可能
- Cache APIチェック → ハンドラ実行 → Cache保存の流れを自動化
- 使用例:
  ```typescript
  const tileCache = createCacheMiddleware(() => ({
    'Cache-Control': 'public, max-age=86400, s-maxage=2592000',
    'CDN-Cache-Control': 'max-age=2592000',
  }));
  ```

### Cache-Control ヘッダ戦略

- **タイルレスポンス**:
  - `Cache-Control: public, max-age=86400, s-maxage=2592000`
    - `public`: 共有キャッシュ可
    - `max-age=86400`: ブラウザで1日キャッシュ
    - `s-maxage=2592000`: CDN/プロキシで30日キャッシュ
  - `CDN-Cache-Control: max-age=2592000`
    - Cloudflare特有のヘッダー、CDNキャッシュTTLを明示的に指定
- **metadata**: `Cache-Control: private, max-age=60`
  - 頻繁に変わる可能性があるため短いTTL（60秒）

### 署名付きURLとの比較

| 方式 | キャッシュ | レイテンシ | 実装複雑度 |
|------|-----------|-----------|----------|
| **R2署名付きURL** | ❌ 不可<br>（URLが毎回異なる） | 🐢 800ms+<br>（常にR2アクセス） | ⭕ シンプル<br>（R2のAPIのみ） |
| **Workers + Cache API<br>（本システム）** | ✅ 可能<br>（同一URL） | ⚡ 30ms以下<br>（エッジキャッシュ） | 🔶 中程度<br>（Workers実装必要） |

### パフォーマンス期待値

**キャッシュミス時（初回アクセス）:**
- Workers実行: ~5ms
- R2取得: ~50-200ms（リージョンによる）
- Cache API書き込み: ~10ms
- **合計: 65-215ms**

**キャッシュヒット時（2回目以降）:**
- Workers実行: ~5ms
- Cache API読み込み: ~5-20ms
- **合計: 10-25ms**（署名付きURLの約30倍高速）

**キャッシュヒット率目標: 95%以上**
- タイルは静的コンテンツ
- 同一パンフレットは複数ユーザーが閲覧する想定
- 結果: R2へのリクエスト数を1/20に削減可能

---

## 開発環境セットアップ

### 前提条件

- Node.js 20+
- pnpm 8+
- Rust 1.70+ + wasm-pack
- Cloudflareアカウント + Wrangler CLI

### セットアップ手順

1. **リポジトリクローン・pnpmインストール**
   ```bash
   git clone <repo>
   cd web-pamphlet-viewer
   pnpm install  # 全ワークスペースの依存を一括インストール
   ```

2. **wasm/ ビルド**
   ```bash
   cd wasm
   wasm-pack build --target web --out-dir pkg
   # pkg/ に .wasm, .js, .d.ts が生成される
   ```

3. **frontend/ ビルド（開発モード）**
   ```bash
   cd frontend
   pnpm dev  # Vite dev server起動
   # http://localhost:5173 でプレビュー
   ```

4. **workers/ ローカル開発**
   ```bash
   cd workers
   # wrangler.tomlでR2バインディング設定（local mode）
   pnpm dev  # wrangler dev
   # http://localhost:8787 でWorkers実行
   ```

5. **Cloudflare R2作成**
   ```bash
   # R2バケット作成
   wrangler r2 bucket create pamphlet-storage

   # wrangler.toml でR2バインディングを設定
   ```

---

## ビルド・デプロイフロー

### ビルド順序

1. **wasm/ ビルド** (frontend/workers より先に)
   ```bash
   cd wasm
   pnpm build  # wasm-pack build --release --target web
   ```

2. **frontend/ ビルド**
   ```bash
   cd frontend
   pnpm build  # Vite build → dist/pamphlet-viewer.js
   # dist をCDNまたはR2にアップロード（静的ホスティング）
   # <pamphlet-viewer> Web Component として使用
   ```

3. **workers/ デプロイ**
   ```bash
   cd workers
   pnpm deploy  # wrangler deploy
   # Cloudflare Workers にデプロイ（API + Hono JSX アップローダーUI）
   ```

### 本番デプロイ前チェックリスト

- [ ] R2バインディングが本番環境に設定されているか
- [ ] CORS設定が正しいオリジンに限定されているか
- [ ] wrangler.toml の `workers_dev = false` に設定
- [ ] Custom Domain設定（例: `api.pamphlet.example.com`）
- [ ] frontendビルドをCDNまたはR2にアップロード
- [ ] ログ・監視設定（Cloudflare Analytics/Logpush）

---

## 実装時の注意事項

### Workers

- **Cache APIの制約と実装ポイント**
  - レスポンスサイズ: 最大512MB（タイル単位では問題なし）
  - `cache.put()` はメモリでレスポンスをバッファリング → 大量同時実行時はメモリ注意
  - **キャッシュキーは完全一致**が必須:
    - URLのクエリパラメータも含まれる
    - 本実装では `c.req.url`（リクエストURL）をそのまま使用
    - 例: `new Request(c.req.url)` でキャッシュキーを生成
  - **ミドルウェアでの自動化**:
    - `loadMetadata` と `createCacheMiddleware` が自動的にキャッシュ処理
    - エンドポイント実装がシンプルに保たれる

- **R2バインディング**
  - `R2_BUCKET.get(key)` はReadableStreamを返す
  - `R2_BUCKET.put(key, body, options)` で書き込み
  - アップロード時の並列数を制御（例: Promise.all with chunks of 10）
  - metadata.jsonの読み書きも同じR2を使用（シンプルな設計）

- **CPU時間制限**
  - 無料プラン: 10ms、有料: 50ms（Unboundなら30秒）
  - ZIP展開・大量R2書き込みは Durable Objects or Queues 経由が望ましい（大規模時）

### WASM

- **メモリ管理**
  - 大きな画像（例: A4, 300dpi → 2480x3508px）はメモリを多く消費
  - ページ単位で処理、処理後はメモリ解放
  - `wee_alloc` でメモリ最適化

- **タイルサイズと画像サイズの関係**
  - タイルサイズが画像の約数でない場合も自動対応
  - 切り上げ除算でタイル数を計算：`(width + tile_size - 1) / tile_size`
  - 端のタイルは透明ピクセル（RGBA [255,255,255,0]）でパディング
  - 全てのタイルが指定されたタイルサイズを維持
  - 例: 512x512画像を300pxタイルで分割 → 2x2タイル、端は212px実画像+88px透明

- **WebP品質パラメータの制限**
  - 現在、品質パラメータは未サポート
  - `image` crateのWebPエンコーダーがデフォルト品質を使用
  - `quality` パラメータは受け取るが、エンコード時には無視される
  - 将来的に `webp` クレートの直接使用で対応可能

- **重複排除について**
  - 現在の実装では重複排除を行わない（全タイルを保持）
  - 理由: フロントエンドでの座標→ハッシュのマッピングが容易
  - ハッシュはタイル識別のみに使用
  - 将来的にR2側で重複排除を実装可能

- **Web Worker化**
  - UI スレッドをブロックしないよう、WASM処理はWeb Workerで実行
  - `postMessage` でタイル結果をメインスレッドに送信

- **エラーハンドリング**
  - `console_error_panic_hook` を使用してRustパニックをJSコンソールに表示

- **テスト環境**
  - Vitest + TypeScript でテスト実装
  - 3つのテストスイート: 機能テスト、パフォーマンステスト、エッジケーステスト
  - 平均処理時間: 12-15ms（512x512画像、256pxタイル）
  - wasm-pack でnodejsターゲットビルド（テスト用）

### Frontend (Svelte) - 実装済み

- **Web Component化の実装**
  - ✓ Shadow DOMは使わない（Tailwind v4との互換性のため）
  - ✓ `customElement: true` でビルド → ESM + UMD バンドル
  - ✓ Tailwind v4のみでスタイリング（カスタムCSSなし）
  - ✓ index.htmlにviewport metaタグ設定（モバイル最適化）

- **Canvasパフォーマンス**
  - ✓ CanvasRendererクラスで描画管理
  - ✓ devicePixelRatio考慮（高DPI対応）
  - ✓ Canvas transform（scale, translate）でズーム・パン実装
  - ✓ ObjectURL経由でImage読み込み → revokeObjectURLでメモリリーク防止
  - 💡 ImageBitmap、OffscreenCanvasは将来的に検討可能

- **並列取得制御（実装済み）**
  - ✓ TileLoaderクラスで独自実装（p-queue不使用、バンドルサイズ削減）
  - ✓ 6並列制御（maxConcurrent: 6）
  - ✓ 優先度キュー（viewport内タイル: 優先度10、残り: 優先度1）
  - ✓ Cloudflare最適化（待機時間なし、50ページバッチ）

- **メモリリーク防止（実装済み）**
  - ✓ Map<hash, HTMLImageElement>でタイルキャッシュ
  - ✓ ObjectURL作成後、即座にrevokeObjectURL
  - ✓ 参照を保持しない設計（GC任せ）
  - ✓ Canvas要素は単一（ページ遷移時にクリア）

- **型安全性（実装済み）**
  - ✓ hono/clientでRPC-style API呼び出し
  - ✓ workers/src/types/api.tsでAppType定義
  - ✓ frontend/src/types/api.tsでre-export
  - ✓ svelte-check + tsc でゼロエラー
  - ✓ `as any`なしの完全型推論

- **モバイル最適化（実装済み）**
  - ✓ TouchHandlerクラスでジェスチャー管理
  - ✓ passive: true リスナー（スクロール性能向上）
  - ✓ ピンチズーム: 0.5x-5x
  - ✓ 2本指パン: ズーム中のみ
  - ✓ スワイプ: ページ遷移
  - ✓ ダブルタップ: リセット
  - ✓ touch-action: none（ブラウザデフォルト動作防止）

---

## パフォーマンス目標

### WASM タイル化処理（実測値）
- **平均処理時間**: 12-15ms（512x512画像、256pxタイル、4タイル生成）
- **最小処理時間**: 12ms
- **最大処理時間**: 50ms以下（128pxタイルの最悪ケース）
- **スケーラビリティ**: 100回連続処理でも性能劣化なし
- **メモリ効率**: メモリリーク検出なし

### フロントエンド（実装済み・目標値）
- **初回表示**: 1秒以内（目標）
  - プログレッシブローディング: 初期6ページのみ取得
  - viewport内タイル優先読み込み（優先度10）
  - バックグラウンドで残りページ取得（50ページバッチ、待機時間なし）
- **ページ遷移**: 0.5秒以内（目標）
  - メタデータロード済み: 即座にページ切り替え
  - タイルキャッシュ活用: Map<hash, HTMLImageElement>
- **キャッシュヒット率**: 95%以上（目標、2回目以降のアクセス）
  - Cloudflare Edge Cache: タイル30日TTL
  - ブラウザメモリキャッシュ: タイルMap保持
- **並列タイル取得**: 6並列（固定、TileLoaderクラス）
  - maxConcurrent: 6
  - 優先度キュー実装
  - Cloudflare最適化（待機時間なし）

---

## TODO（実装順序）

### Phase 1: 基盤構築
1. pnpm workspace セットアップ
2. workers/ Hono基本実装（/metadata, /tile エンドポイント）
3. R2/KVバインディング設定
4. Cache API統合

### Phase 2: WASM開発 ✓ 完了
5. ✓ wasm/ Rust プロジェクト作成
6. ✓ 画像タイル化ロジック実装（パディング対応含む）
7. ✓ SHA256ハッシュ・metadata生成
8. ✓ wasm-pack ビルド確認
9. ✓ 包括的なテストスイート作成（51テスト）
   - 機能テスト（27テスト）
   - パフォーマンステスト（17テスト）
   - エッジケーステスト（7テスト）
10. ✓ 型定義の共有化（shared/types/wasm.ts）

### Phase 3: フロント開発 ✓ 完了
9. ✓ workers/ Hono JSX アップローダーUI実装（src/routes/admin.tsx）
10. ✓ frontend/ Svelte 5 + Vite 6 + Tailwind v4 セットアップ
11. ✓ PamphletViewer.svelte 実装（Canvas描画、タイル取得）
12. ✓ Web Component化・ビルド確認（`<pamphlet-viewer>`）
13. ✓ hono/client による型安全なAPI呼び出し実装
14. ✓ プログレッシブローディング戦略実装（初期6ページ → バックグラウンドで残り）
15. ✓ モバイル最適化（ピンチズーム、スワイプ、タッチジェスチャー）
16. ✓ lucide-svelte アイコン統合
17. ✓ コード分割（hooks: usePamphletViewer, useTouchGestures / components: ViewerCanvas, PaginationControls, LoadingOverlay）
18. ✓ 型チェック完全パス（svelte-check + tsc）

### Phase 4: 統合
13. /upload エンドポイント実装（ZIP展開、R2書き込み）
14. CORS設定
15. エラーハンドリング・ログ

### Phase 5: 最適化・テスト
16. キャッシュ戦略テスト（version無効化確認）
17. パフォーマンステスト（並列数調整）
18. ブラウザ互換性テスト（Chrome, Firefox, Safari）
19. ドキュメント整備

---

## 参考リソース

### 公式ドキュメント

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Hono Web Framework](https://hono.dev/)
- [hono/client RPC](https://hono.dev/docs/guides/rpc) - 型安全なAPI呼び出し
- [wasm-bindgen Guide](https://rustwasm.github.io/wasm-bindgen/)
- [Svelte 5 Docs](https://svelte.dev/docs/svelte/overview) - 最新のrunes（$state, $derived, $effect）
- [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4-beta) - ベータ版ドキュメント
- [lucide-svelte](https://lucide.dev/guide/packages/lucide-svelte) - Svelteアイコンライブラリ
- [Cache API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Cache)
- [R2 Documentation](https://developers.cloudflare.com/r2/)
- [Workers KV](https://developers.cloudflare.com/kv/)

### キャッシュ可能な署名付きURL関連

- [キャッシュ可能な署名付きURLを考えてみる - Zenn](https://zenn.dev/oliver/articles/cloudflare-meetup-2023-10-06) - Oliver氏による実装パターン解説
- [Cacheable Presigned URL with Cloudflare Workers - Speaker Deck](https://speakerdeck.com/oliver_diary/cacheable-presigned-url-with-cloudflare-workers) - 上記記事のスライド版
- [Cloudflare R2の画像をCache APIでキャッシュして返すメモ - Zenn](https://zenn.dev/syumai/scraps/d3468205fee0f0) - パフォーマンス改善事例（800ms → 30ms）
- [Cloudflare画像配信パターン - Zenn](https://zenn.dev/yusukebe/articles/7cad4c909f1a60) - R2 + Workers の配信パターン

---

このドキュメントは実装の指針となるアーキテクチャ設計書です。各コンポーネントの詳細な実装は、このガイドラインに従って進めてください。
