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
  - version番号（タイムスタンプ）生成（キャッシュ無効化用）
  ↓
R2 に永続化
```

### データフロー（閲覧時）

```
管理者
  ↓ POST /pamphlet/:id/generate-token（管理者操作）
Workers
  - pamphlet存在確認
  - HMAC-SHA256署名付きトークン生成（時間ベース）
  ↓ token（timestamp.signature形式）
管理者 → 閲覧者にトークン配布

ブラウザ（閲覧者）
  ↓ GET /pamphlet/:id/metadata (Authorization: Bearer {token})
Workers
  - トークン検証（HMAC署名確認、有効期限チェック）
  - R2から metadata.json 取得 (pamphlets/{id}/metadata.json)
  ↓ metadata（pages配列、tile_size、version、各タイルのhash情報）を返す
ブラウザ
  - Canvas初期化
  - viewport計算 → 必要タイル特定
  - metadataから座標に対応するhashを取得
  ↓ GET /pamphlet/:id/tile/:hash?token={token} （並列リクエスト）
Workers
  - トークン検証（HMAC署名確認、有効期限チェック）
  - R2から metadata.json 取得してversion番号を確認
  - Cache API チェック（caches.default）
    - キャッシュキー: pamphlet:{id}:tile:{hash}:v{version}
  - HIT → 即座に返す
  - MISS → R2バインディングで取得
    - パス: pamphlets/{id}/tiles/{hash}.webp
    - Content-Type: image/webp
    - Cache-Control: public, max-age=86400
    - Cache APIに put（エッジキャッシュ）
  ↓ タイル画像（WebP）
ブラウザ
  - Image.decode()後、Canvasに描画
  - プリフェッチ（前後ページ）
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

- **バージョニング方式**:
  - metadata.versionをキャッシュキーに含めることで、再アップロード時に古いキャッシュを即座に無効化（cacheキーが変わる）
  - Purge API不要、実装がシンプル

- **ハッシュベースURL + 署名付きトークンによるセキュリティ**:
  - **ハッシュベースURL**: タイルURLが座標から推測不可能（`/tile/:hash`）
    - 座標ベース（`/tile/:x/:y`）だと連番でアクセス可能 → ハッシュベースで防止
  - **署名付きトークン認証**: HMAC-SHA256ベースのトークンで全エンドポイントを保護
    - トークンは時間ベースのバケット方式（デフォルト5分）でキャッシュ可能性を維持
    - 有効期限設定可能（デフォルト1時間）
    - 認証されたユーザーのみがmetadataとタイルにアクセス可能
  - **多層防御**:
    1. トークンなしではmetadataにアクセス不可 → タイルhash情報が取得できない
    2. トークンなしではタイルにアクセス不可 → 仮にhashを知っていてもダウンロード不可
    3. ハッシュベースURLで推測攻撃を防止
  - **注意**: 認証されたユーザーによる機械的ダウンロードは技術的に防げない
    - metadataに全タイルのhash情報が含まれるため、正規のトークンを持つユーザーは全タイルにアクセス可能
    - 追加対策: Rate Limiting、利用規約、透かし等を検討

**参考**:
- Cloudflare Meetup 2023の「キャッシュ可能な署名付きURL」パターン（Oliver氏）に基づく設計
- 時間ベースのトークンバケット方式により、署名付きでもキャッシュ可能

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
│       │   │                  # - metadata更新（KV）
│       │   ├── metadata.ts    # GET /pamphlet/:id/metadata
│       │   │                  # - KVからmetadata取得
│       │   └── tile.ts        # GET /pamphlet/:id/page/:p/tile/:x/:y
│       │                      # - Cache API確認
│       │                      # - R2取得（cache miss時）
│       │                      # - Cache保存
│       ├── pages/
│       │   └── uploader.tsx   # GET /upload (Hono JSX UI)
│       │                      # - アップローダー画面レンダリング
│       │                      # - WASM初期化スクリプト
│       │                      # - クライアントサイドJS埋め込み
│       ├── middleware/
│       │   └── cors.ts        # CORS設定ミドルウェア
│       │                      # - オリジン検証
│       │                      # - プリフライトレスポンス
│       ├── services/
│       │   ├── r2.ts          # R2操作ヘルパー
│       │   │                  # - ファイル書き込み
│       │   │                  # - ファイル取得
│       │   │                  # - パス生成ユーティリティ
│       │   ├── kv.ts          # KV操作ヘルパー
│       │   │                  # - metadata保存/取得
│       │   │                  # - version管理
│       │   └── cache.ts       # Cache API操作ヘルパー
│       │                      # - カスタムキー生成
│       │                      # - キャッシュ保存/取得
│       └── types/
│           └── bindings.ts    # Workers bindings型定義
│                              # - Env型（R2_BUCKET, META_KV等）
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
- KV namespace: 将来的な用途のため予約（現在は未使用）
- Secret: `SECRET_KEY` を設定（HMAC署名用、`.dev.vars` または `wrangler secret put`）

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
     - metadata.versionを生成（timestamp）
   - レスポンス: `{ id, version, status: 'ok' }`

3. `POST /pamphlet/:id/generate-token` (トークン生成)
   - **認証**: 本番環境では追加の管理者認証が必要（API key等）
   - リクエストボディ（オプション）: `{ expiresIn: 3600 }` （秒単位、デフォルト3600=1時間）
   - 処理:
     - pamphlet存在確認
     - HMAC-SHA256署名付きトークン生成（時間ベースのバケット方式）
     - トークン形式: `{timestamp}.{signature}`
   - レスポンス: `{ pamphletId, token, expiresIn, expiresAt }`
   - 用途: 生成されたトークンを閲覧者に配布（URLパラメータまたはAuthorizationヘッダ）

4. `GET /pamphlet/:id/metadata`
   - **認証**: 署名付きトークン必須（`Authorization: Bearer {token}` または `?token={token}`）
   - トークン検証: HMAC署名確認、有効期限チェック
   - R2から `pamphlets/{id}/metadata.json` を取得
   - レスポンス: metadata.json（pages配列、tile_size、version、各タイルのhash情報等）

5. `GET /pamphlet/:id/tile/:hash`
   - **認証**: 署名付きトークン必須（`Authorization: Bearer {token}` または `?token={token}`）
   - ハッシュ形式検証: 64文字の16進数（SHA256）
   - トークン検証: HMAC署名確認、有効期限チェック
   - キャッシュキー生成: `pamphlet:{id}:tile:{hash}:v{version}`（versionはmetadataから取得）
   - Cache APIチェック（caches.default.match(cacheKey)）
   - HIT → 即座に返す
   - MISS:
     - R2バインディングで取得: `R2_BUCKET.get('pamphlets/{id}/tiles/{hash}.webp')`
     - レスポンスヘッダ:
       - `Content-Type: image/webp`
       - `Cache-Control: public, max-age=86400, s-maxage=2592000`
     - Cache APIに保存: `cache.put(cacheKey, response.clone())`
   - レスポンス: 画像バイナリ（WebP）

6. `POST /pamphlet/:id/invalidate` (管理用)
   - **認証**: 署名付きトークン必須
   - R2からmetadata.jsonを取得
   - metadata.versionを更新（新しいtimestamp）
   - 更新したmetadata.jsonをR2に保存
   - レスポンス: `{ id, version, status, message }`

**キャッシュ無効化戦略**

- **バージョニング方式（推奨）**: metadata.versionをキャッシュキーに含める
  - 再アップロード時にversionをインクリメント → 新しいキャッシュキーで取得
  - 古いキャッシュは自然にTTLで削除される
  - メリット: 即座に反映、実装シンプル
- **Purge方式（オプション）**: Surrogate-Key を使ったPurge
  - CF EnterpriseプランのみCache Purge APIが使える
  - `cache.delete(key)` を並列実行（ただし大量タイルの場合コスト高）

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

#### 実装方針

**Svelte 5 Web Component化**

- `svelte.config.js` で `customElement: true` を設定
- `<svelte:options customElement="pamphlet-viewer" />` を指定
- ビルド出力: `dist/pamphlet-viewer.js`（単一バンドル、またはESM）

#### PamphletViewer.svelte

**props（attribute）**

- `pamphlet-id`: string（必須）
- `api-base`: string（Workers URL、デフォルト `''`）

**機能**

1. metadata取得
   - `onMount` で `GET {apiBase}/pamphlet/{id}/metadata`
   - metadataから: pages配列、tile_size、version、各ページのwidth/height

2. Canvas初期化
   - 現在ページのwidth/heightでCanvas要素を作成
   - devicePixelRatio考慮（高DPI対応）

3. viewport計算
   - 現在のスクロール位置 + Canvas表示領域から、必要なタイル座標を計算
   - タイル座標: `{ x: Math.floor(scrollX / tile_size), y: Math.floor(scrollY / tile_size) }`

4. タイル取得・描画ループ
   - 優先度: 現在viewport内タイル → 次ページプリフェッチ → 前ページプリフェッチ
   - 並列リクエスト制御（例: 同時6リクエスト、p-queue使用）
   - タイルURL: `{apiBase}/pamphlet/{id}/page/{page}/tile/{x}/{y}`
   - Image要素で読み込み:
     ```js
     const img = new Image();
     img.crossOrigin = 'anonymous'; // CORS対応
     img.src = tileUrl;
     await img.decode();
     ctx.drawImage(img, x * tile_size, y * tile_size);
     ```

5. プリフェッチ戦略
   - 現在ページの全タイル読み込み完了後、次ページの viewport内タイルをプリフェッチ
   - IntersectionObserverでスクロール方向を検出し、先読み方向を最適化

6. ページネーション
   - 左右矢印キー、スワイプ、ボタンでページ遷移
   - ページ遷移時にCanvasクリア → 新ページタイル読み込み

7. ズーム・パン
   - Canvas `scale()` でズーム実装
   - マウスホイール、ピンチジェスチャー対応
   - パンはCanvasの `translate()` またはスクロール位置調整

8. タイル再利用（重複排除の効果）
   - タイルがハッシュ命名されているため、同一タイルはキャッシュから再利用される

**UI要素**

- Canvas要素
- ページネーションコントロール（前へ/次へボタン、ページ番号表示）
- ズームコントロール（+/-ボタン、スライダー）
- ローディングインジケーター

**パフォーマンス最適化**

- タイルをメモリキャッシュ（Map<url, ImageBitmap>）
- OffscreenCanvas（Web Worker）で描画処理（オプション）
- RequestAnimationFrame でスムーズなUI更新

---

## キャッシュ設計

### 階層

1. **ブラウザキャッシュ**
   - タイルレスポンス（image/webp）は `Cache-Control: public, max-age=86400` でブラウザキャッシュ
   - メモリキャッシュ（Map in JS）で重複リクエスト防止

2. **Cloudflare Edge Cache（Cache API）**
   - Workers の `caches.default` に保存
   - キャッシュキー: `pamphlet:{id}:p{page}:x{x}:y{y}:v{version}`
   - TTL: `s-maxage=2592000`（30日、調整可能）

3. **R2（オリジンストレージ）**
   - 永続化
   - キャッシュミス時のみアクセス

### キャッシュキー設計

**重要: versionをキーに含める**

```
pamphlet:{pamphletId}:p{pageNumber}:x{tileX}:y{tileY}:v{version}
例: pamphlet:abc123:p0:x0:y0:v1699999999
```

- 再アップロード時に `metadata.version` をインクリメント（timestamp推奨）
- 新versionのタイルは新しいキャッシュキーで取得される
- 古いversionのキャッシュは自然にTTL expireで削除

### キャッシュ無効化フロー

**アップロード時**

1. Workers `/upload` が完了
2. `metadata.version` を生成（`Date.now()` timestamp）
3. R2に新metadata保存: `pamphlets/{id}/metadata.json`
4. 古いキャッシュはversionが異なるため自動的にミス → 新タイルを取得

**手動無効化時（POST /pamphlet/:id/invalidate）**

1. R2から現在のmetadata.jsonを取得
2. `metadata.version` を更新（新しい`Date.now()` timestamp）
3. 更新したmetadata.jsonをR2に保存
4. 次回のタイルリクエスト時、新しいversionでキャッシュキーが生成される

**オプション: 即時削除**

- CF Enterprise プランなら Purge API使用可能
- または Workers で `cache.delete(oldKey)` を並列実行（コスト高、大量タイル時は注意）

### Cache-Control ヘッダ戦略

- **タイルレスポンス**: `Cache-Control: public, max-age=86400, s-maxage=2592000`
  - `public`: 共有キャッシュ可
  - `max-age=86400`: ブラウザで1日キャッシュ
  - `s-maxage=2592000`: CDN/プロキシで30日キャッシュ
- **metadata**: `Cache-Control: private, max-age=60`
  - 頻繁に変わる可能性があるため短いTTL

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

   # wrangler.toml のコメントを外して設定
   # KV namespaceは現在未使用（将来的な拡張のため予約）
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
    - 例: `new Request('https://dummy/pamphlet/abc/tile/0/0')` をキーにして `cache.match()` / `cache.put()`

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

### Frontend (Svelte)

- **Web Component化の注意点**
  - Shadow DOMは使わない（スタイル隔離が複雑）
  - `customElement` モードでビルド → 単一JSバンドル
  - 外部CSSは `<link>` で読み込み、またはインラインスタイル

- **Canvasパフォーマンス**
  - `requestAnimationFrame` でスムーズな再描画
  - タイル描画は `ImageBitmap` を使うとさらに高速（`createImageBitmap(blob)`）
  - OffscreenCanvas（Web Worker）でバックグラウンド描画（オプション）

- **並列取得制御**
  - `p-queue` または独自実装でリクエスト並列数制限（例: 6並列）
  - 過剰な並列リクエストはブラウザ・CDNに負荷

- **メモリリーク防止**
  - 不要なタイルImageはGCに任せる（参照を保持しない）
  - Canvas要素が多い場合は適宜破棄

---

## パフォーマンス目標

### WASM タイル化処理（実測値）
- **平均処理時間**: 12-15ms（512x512画像、256pxタイル、4タイル生成）
- **最小処理時間**: 12ms
- **最大処理時間**: 50ms以下（128pxタイルの最悪ケース）
- **スケーラビリティ**: 100回連続処理でも性能劣化なし
- **メモリ効率**: メモリリーク検出なし

### フロントエンド（目標値）
- **初回表示**: 1秒以内（metadata取得 + 現在viewport タイル取得）
- **ページ遷移**: 0.5秒以内（プリフェッチ済みの場合は即座）
- **キャッシュヒット率**: 95%以上（2回目以降のアクセス）
- **並列タイル取得**: 6-10並列（調整可能）

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

### Phase 3: フロント開発
9. workers/ Hono JSX アップローダーUI実装（src/pages/uploader.tsx）
10. frontend/ Svelte 5プロジェクト作成
11. PamphletViewer.svelte 実装（Canvas描画、タイル取得）
12. Web Component化・ビルド確認

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
- [wasm-bindgen Guide](https://rustwasm.github.io/wasm-bindgen/)
- [Svelte 5 Docs](https://svelte-5-preview.vercel.app/)
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
