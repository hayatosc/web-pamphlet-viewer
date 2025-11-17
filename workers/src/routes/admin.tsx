import { Hono } from 'hono';
import type { Env, Variables } from '../types/bindings';
import { ViteClient, Script, Link } from 'vite-ssr-components/hono';
import upload from './upload';

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

// Mount upload router under /admin/upload
admin.route('/upload', upload);

admin.get('/', (c) => {
  return c.html(
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>パンフレットアップローダー</title>
        <Link src="/src/style.css" />
        <Script type="module" src="/src/client/index.tsx" />
        <ViteClient />
      </head>
      <body>
        <div id="root"></div>
      </body>
    </html>
  );
});

export default admin;
