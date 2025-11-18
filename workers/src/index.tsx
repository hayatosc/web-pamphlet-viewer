/**
 * Pamphlet Viewer Workers API
 * Built with Hono framework
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env, Variables } from './types/bindings';

// Import routers
import pamphlet from './routes/pamphlet';
import admin from './routes/admin';

// Create Hono app with type definitions
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: '*', // TODO: Restrict in production
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
);

// Redirect root to admin page
app.get('/', (c) => {
  return c.redirect('/admin', 302);
});

// Mount routers and configure handlers
const routes = app
  .route('/pamphlet', pamphlet)
  .route('/admin', admin)
  .notFound((c) => {
    return c.json({ error: 'Not found' }, 404);
  })
  .onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json(
      {
        error: 'Internal server error',
        message: err.message,
      },
      500
    );
  });

// Export the app
export default routes;

// Export type for RPC client
export type AppType = typeof routes;
