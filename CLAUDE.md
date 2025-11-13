# パンフレットビューア - アーキテクチャ設計書

## プロジェクト概要

InDesignなどのDTP成果物を、高速かつセキュアにWeb上で閲覧できるシステム。タイル化（タイルマップ方式）により大容量画像を効率的に配信し、Cloudflare WorkersのCache APIとR2を組み合わせてエッジでの高速配信を実現する。

### 主要コンポーネント

1. **Rust/WASM タイル化エンジン** - ブラウザ上で画像をタイル分割
2. **Cloudflare Workers API (Hono)** - R2直接アクセス、Cache API統合、認証、アップローダーUI（Hono JSX）
3. **Svelte 5 Web Component** - 再利用可能なビューア（`<pamphlet-viewer>`）

---

## アーキテクチャ概要

### データフロー（アップロード時）

```
ブラウザ（管理者）
  ↓ 画像ファイル群（InDesign出力）
Rust/WASM（ブラウザ内）
  - タイル化（例: 512x512px WebP）
  - SHA256ハッシュ命名（重複排除）
  - metadata.json生成
  ↓ ZIP/タイル群 + metadata
Workers /upload エンドポイント
  - 認証チェック（JWT/Cookie）
  - ZIP展開
  - R2へ書き込み: pamphlets/{id}/page-{n}/tile-{x}-{y}.webp
  - KVへmetadata保存: meta:{id}
  - version番号インクリメント（キャッシュ無効化用）
  ↓
R2 + KV に永続化
```

### データフロー（閲覧時）

```
ブラウザ（閲覧者）
  ↓ GET /pamphlet/:id/metadata
Workers
  - KVから metadata.json 取得
  - 認証チェック（オプション）
  ↓ metadata（pages配列、tile_size、version等）を返す
ブラウザ
  - Canvas初期化
  - viewport計算 → 必要タイル特定
  ↓ GET /pamphlet/:id/page/:p/tile/:x/:y （並列リクエスト）
Workers
  - Cache API チェック（caches.default）
    - キャッシュキー: pamphlet:{id}:p{page}:x{x}:y{y}:v{version}
  - HIT → 即座に返す
  - MISS → R2バインディングで取得
    - Content-Type: image/webp
    - Cache-Control: public, max-age=86400
    - Cache APIに put（エッジキャッシュ）
  ↓ タイル画像（WebP）
ブラウザ
  - Image.decode()後、Canvasに描画
  - プリフェッチ（前後ページ）
```

### なぜこの構成か

- **署名付きURLの問題回避**: R2の署名付きURLをそのまま配布すると、ブラウザキャッシュが効きにくく、URLが漏洩するとセキュリティリスクが生じる
- **エッジキャッシュの最大活用**: Workers Cache APIを使うことで、Cloudflareエッジネットワークでタイルをキャッシュ。世界中の閲覧者に低レイテンシで配信
- **バージョニング方式**: metadata.versionをキャッシュキーに含めることで、再アップロード時に古いキャッシュを即座に無効化（cacheキーが変わる）

---

## プロジェクト構造（pnpm workspace）

```
web-pamphlet-viewer/
├── pnpm-workspace.yaml        # pnpmワークスペース定義
├── package.json               # ルートpackage.json（共通dev依存等）
├── CLAUDE.md                  # 本ファイル
├── README.md
│
├── workers/                   # Cloudflare Workers (Hono API + JSX UI)
│   ├── package.json
│   ├── wrangler.toml          # Workers設定、R2/KVバインディング
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # Honoアプリエントリポイント
│       ├── routes/
│       │   ├── upload.ts      # POST /upload (API)
│       │   ├── metadata.ts    # GET /pamphlet/:id/metadata
│       │   └── tile.ts        # GET /pamphlet/:id/page/:p/tile/:x/:y
│       ├── pages/
│       │   └── uploader.tsx   # GET /upload (Hono JSX UI)
│       ├── middleware/
│       │   ├── auth.ts        # JWT/Cookie認証
│       │   └── cors.ts        # CORS設定
│       ├── services/
│       │   ├── r2.ts          # R2操作ヘルパー
│       │   ├── kv.ts          # KV操作ヘルパー
│       │   └── cache.ts       # Cache API操作
│       └── types/
│           └── bindings.ts    # Workers bindings型定義
│
├── wasm/                      # Rust/WASM タイル化エンジン
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── package.json           # wasm-pack ビルド用
│   └── src/
│       ├── lib.rs             # wasm-bindgen エントリ
│       ├── tiler.rs           # タイル化ロジック
│       └── hasher.rs          # SHA256ハッシュ計算
│   └── pkg/                   # wasm-pack出力先（.gitignore）
│
├── frontend/                  # Svelte 5 Web Component (Viewer only)
│   ├── package.json
│   ├── vite.config.ts         # Vite設定（Svelte plugin）
│   ├── tsconfig.json
│   └── src/
│       ├── components/
│       │   └── PamphletViewer.svelte     # <pamphlet-viewer>
│       ├── lib/
│       │   ├── tile-loader.ts            # タイル並列取得ロジック
│       │   ├── canvas-renderer.ts        # Canvas描画
│       │   └── viewport.ts               # viewport計算
│       ├── types/
│       │   └── metadata.ts               # metadata.json型定義
│       └── main.ts                       # customElements.define()
│   └── dist/                             # ビルド出力（.gitignore）
│
└── shared/                    # 共通型定義・ユーティリティ（オプション）
    ├── package.json
    └── src/
        └── types/
            └── metadata.ts    # metadata.json共通型
```

### pnpm-workspace.yaml

```yaml
packages:
  - 'workers'
  - 'wasm'
  - 'frontend'
  - 'shared'
```

---

## 各コンポーネントの責務と実装方針

### 1. workers/ - Cloudflare Workers API (Hono)

#### 責務

- R2への読み書き（直接バインディング経由）
- Workers KVでのmetadata管理
- Cache API（caches.default）を使ったエッジキャッシュ
- 認証・認可（JWT/Cookie）
- CORS設定

#### 実装方針

**wrangler.toml 設定**
- R2バケット: `pamphlet-storage` をバインディング `R2_BUCKET` として設定
- KV namespace: `pamphlet-metadata` をバインディング `META_KV` として設定
- Secrets: JWT_SECRET（認証用）

**主要エンドポイント**

1. `GET /upload` (Hono JSX UI)
   - 認証: JWT/Cookie必須（管理者のみ）
   - Hono JSXでアップローダーUIをレンダリング
   - 画面内容:
     - ドラッグ&ドロップエリア（複数画像対応）
     - WASM初期化スクリプト読み込み（`<script src="/wasm/pkg/...">`)
     - タイル化進捗表示（ページ単位）
     - アップロード実行ボタン
   - クライアントサイドJS:
     - WASM呼び出し（`tile_image()`）
     - ZIP生成（JSZip）
     - `POST /upload` にmultipart送信
     - 並列数制御（例: 6並列）
   - レスポンス: HTML（Hono JSX）

2. `POST /upload` (API)
   - 認証: JWT/Cookie必須（管理者のみ）
   - ペイロード: multipart/form-data（ZIP）またはJSON（タイル配列+metadata）
   - 処理:
     - ZIP展開（ZIP形式の場合）
     - R2に各タイルを書き込み: `pamphlets/{id}/page-{n}/tile-{x}-{y}.webp`
     - metadata.jsonをR2とKVに保存
     - metadata.versionをインクリメント（timestamp or sequential number）
   - レスポンス: `{ id, version, status: 'ok' }`

3. `GET /pamphlet/:id/metadata`
   - 認証: オプション（運用方針による）
   - KVから `meta:{id}` を取得
   - レスポンス: metadata.json（pages配列、tile_size、version、dimensions等）

4. `GET /pamphlet/:id/page/:page/tile/:x/:y`
   - 認証: オプション（運用方針による）
   - キャッシュキー生成: `pamphlet:{id}:p{page}:x{x}:y{y}:v{version}`
     - versionはmetadataから取得
   - Cache APIチェック（caches.default.match(cacheKey)）
   - HIT → 即座に返す
   - MISS:
     - R2バインディングで取得: `R2_BUCKET.get(tilePath)`
     - レスポンスヘッダ:
       - `Content-Type: image/webp`
       - `Cache-Control: public, max-age=86400, s-maxage=2592000`
       - `Surrogate-Key: pamphlet:{id}` （オプション: Purge用）
     - Cache APIに保存: `cache.put(cacheKey, response.clone())`
   - レスポンス: 画像バイナリ（WebP）

5. `POST /pamphlet/:id/invalidate` (管理用)
   - 認証: 管理者のみ
   - metadata.versionをインクリメント
   - レスポンス: `{ version }`

**認証戦略**

- アップロード: JWT（Authorization: Bearer token）またはCookie（httpOnly、secure）
- タイル取得:
  - **オプションA（推奨）**: 認証不要 + Workers内でCache API活用（高速配信）
    - 閲覧権限はmetadata取得時にチェック（閲覧可能なIDリストをKVで管理）
    - タイルURLは推測しにくいID（UUID）を使用
  - **オプションB**: 認証必須
    - タイル取得時にJWTチェック
    - ただしAuthorizationヘッダ付きレスポンスはCDNキャッシュされにくいため、内部で認証後に公開レスポンスを生成する工夫が必要

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
  - 認証: Cookie or JWT で保護、middleware で確認
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
- SHA256ハッシュ計算（タイル命名、重複排除）
- metadata.json生成

#### 実装方針

**依存クレート**

- `wasm-bindgen`: JSとのインターフェース
- `image`: 画像デコード・エンコード・リサイズ
- `webp`: WebPエンコーダ（またはimage crateのwebp feature）
- `sha2`: SHA256ハッシュ計算
- `serde`, `serde_json`: metadata生成用
- `console_error_panic_hook`: エラーログ改善
- `wee_alloc`: メモリ最適化（オプション）

**主要関数**

1. `tile_image(image_data: &[u8], tile_size: u32) -> JsValue`
   - 入力: 画像バイナリ（JPEG/PNG等）
   - 処理:
     - imageクレートでデコード
     - タイルサイズでループ切り出し
     - 各タイルをWebPエンコード
     - SHA256ハッシュ計算 → ファイル名決定（`{hash}.webp`）
     - 重複チェック（HashSetで管理）
   - 出力: `{ tiles: [{ x, y, hash, data: Uint8Array }], width, height }`

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
- `auth-token`: string（認証が必要な場合）

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
2. `metadata.version` を更新（`Date.now()` or sequential number）
3. KVに新version保存: `META_KV.put('meta:{id}', JSON.stringify(metadata))`
4. 古いキャッシュはversionが異なるため自動的にミス → 新タイルを取得

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

---

## セキュリティ・認証

### アップロード（管理者のみ）

**認証方式: JWT**

- フロント（管理画面）でログイン → JWTをlocalStorageに保存
- `<pamphlet-uploader auth-token={jwt}>` で渡す
- Workers `/upload` エンドポイントで `Authorization: Bearer {jwt}` をチェック
- JWT検証: `JWT_SECRET`（Workers Secrets）で署名検証
- ペイロード: `{ user_id, role: 'admin', exp }`

**または Cookie ベース**

- httpOnly, secure Cookie
- Workers で Cookie解析 → セッションKVで検証

### タイル取得（閲覧者）

**推奨: metadata取得時に認証、タイルは公開**

- `GET /pamphlet/:id/metadata` で認証チェック
  - JWTまたはCookie検証
  - 閲覧権限チェック（KVに `access:{id}` → `[user_id_list]` を保存）
- metadata取得成功 → タイルURLは認証不要で取得可能
  - タイルURLにIDが含まれるが、IDは推測困難（UUID使用）
  - Workers Cache APIで高速配信

**オプション: タイル取得時も認証**

- タイルリクエスト時にJWTチェック
- ただし `Authorization` ヘッダ付きレスポンスはCDNキャッシュされにくい
- 回避策: Workers内で認証後、ヘッダを外した公開レスポンスを Cache APIに保存

### CORS

- Workers で CORS ヘッダ設定
- `Access-Control-Allow-Origin`: 閲覧アプリのオリジン（wildcard避ける）
- `Access-Control-Allow-Credentials: true`（Cookie認証の場合）

### その他

- **Rate Limiting**: Workers でIP/user_id ベースのレート制限（KVで実装）
- **Logging**: アクセスログをWorkers Analytics or Logpushで記録
- **暗号化**: R2バケットは非公開設定、Workers経由のみアクセス
- **Secrets管理**: `wrangler secret put JWT_SECRET`

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
   # wrangler.tomlでR2/KVバインディング設定（local mode）
   pnpm dev  # wrangler dev
   # http://localhost:8787 でWorkers実行
   ```

5. **Cloudflare R2/KV作成**
   ```bash
   # R2バケット作成
   wrangler r2 bucket create pamphlet-storage

   # KV namespace作成
   wrangler kv:namespace create pamphlet-metadata
   wrangler kv:namespace create pamphlet-metadata --preview  # dev用

   # wrangler.toml に ID を追記
   ```

6. **Secrets設定**
   ```bash
   cd workers
   wrangler secret put JWT_SECRET
   # プロンプトでシークレット入力
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

### CI/CD（GitHub Actions例）

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 20
          cache: pnpm
      - uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
      - run: cargo install wasm-pack

      - run: pnpm install
      - run: cd wasm && pnpm build
      - run: cd frontend && pnpm build
      - run: cd workers && wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
```

### 本番デプロイ前チェックリスト

- [ ] R2/KVバインディングが本番環境に設定されているか
- [ ] JWT_SECRET が設定されているか
- [ ] CORS設定が正しいオリジンに限定されているか
- [ ] wrangler.toml の `workers_dev = false` に設定
- [ ] Custom Domain設定（例: `api.pamphlet.example.com`）
- [ ] frontendビルドをCDNまたはR2にアップロード
- [ ] ログ・監視設定（Cloudflare Analytics/Logpush）

---

## 実装時の注意事項

### Workers

- **Cache APIの制約**
  - レスポンスサイズ: 最大512MB（タイル単位では問題なし）
  - `cache.put()` はメモリでレスポンスをバッファリング → 大量同時実行時はメモリ注意
  - キャッシュキーは完全一致、クエリパラメータも含まれる（今回はパスのみ）

- **R2バインディング**
  - `R2_BUCKET.get(key)` はReadableStreamを返す
  - `R2_BUCKET.put(key, body, options)` で書き込み
  - アップロード時の並列数を制御（例: Promise.all with chunks of 10）

- **KVの制約**
  - 値サイズ: 最大25MB（metadata.jsonは十分小さい）
  - 書き込みは最終的整合性（eventually consistent）
  - 高頻度読み込みは問題なし

- **CPU時間制限**
  - 無料プラン: 10ms、有料: 50ms（Unboundなら30秒）
  - ZIP展開・大量R2書き込みは Durable Objects or Queues 経由が望ましい（大規模時）

### WASM

- **メモリ管理**
  - 大きな画像（例: A4, 300dpi → 2480x3508px）はメモリを多く消費
  - ページ単位で処理、処理後はメモリ解放
  - `wee_alloc` でメモリ最適化

- **Web Worker化**
  - UI スレッドをブロックしないよう、WASM処理はWeb Workerで実行
  - `postMessage` でタイル結果をメインスレッドに送信

- **エラーハンドリング**
  - `console_error_panic_hook` を使用してRustパニックをJSコンソールに表示

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

### Phase 2: WASM開発
5. wasm/ Rust プロジェクト作成
6. 画像タイル化ロジック実装
7. SHA256ハッシュ・metadata生成
8. wasm-pack ビルド確認

### Phase 3: フロント開発
9. workers/ Hono JSX アップローダーUI実装（src/pages/uploader.tsx）
10. frontend/ Svelte 5プロジェクト作成
11. PamphletViewer.svelte 実装（Canvas描画、タイル取得）
12. Web Component化・ビルド確認

### Phase 4: 統合・認証
13. JWT認証実装（Workers middleware）
14. /upload エンドポイント実装（ZIP展開、R2書き込み）
15. CORS・セキュリティ設定
16. エラーハンドリング・ログ

### Phase 5: 最適化・テスト
17. キャッシュ戦略テスト（version無効化確認）
18. パフォーマンステスト（並列数調整）
19. ブラウザ互換性テスト（Chrome, Firefox, Safari）
20. ドキュメント整備

---

## 参考リソース

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Hono Web Framework](https://hono.dev/)
- [wasm-bindgen Guide](https://rustwasm.github.io/wasm-bindgen/)
- [Svelte 5 Docs](https://svelte-5-preview.vercel.app/)
- [Cache API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Cache)
- [R2 Documentation](https://developers.cloudflare.com/r2/)
- [Workers KV](https://developers.cloudflare.com/kv/)

---

このドキュメントは実装の指針となるアーキテクチャ設計書です。各コンポーネントの詳細な実装は、このガイドラインに従って進めてください。
