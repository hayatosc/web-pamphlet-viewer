import { Hono } from 'hono';
import type { Env, Variables } from '../types/bindings';
import { html } from 'hono/html';
import { ViteClient, Script, Link } from 'vite-ssr-components/hono';

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

admin.get('/', (c) => {
  return c.html(
    html`<!DOCTYPE html>
      <html lang="ja">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>パンフレットアップローダー</title>
          ${<Link src="/src/style.css" />}
          ${<Script type="module" src="/src/client.tsx" />}
          ${<ViteClient />}
        </head>
        <body>
          <div id="root"></div>
        </body>
      </html>`
  );
});

export default admin;
