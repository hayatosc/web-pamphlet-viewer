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
import upload from './routes/upload';

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

// Health check endpoint
app.get('/', (c) => {
  return c.json({
    service: 'Pamphlet Viewer API',
    status: 'ok',
    version: '1.0.0',
  });
});

// Mount routers
app.route('/pamphlet', pamphlet);
app.route('/', upload);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
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
export default app;
