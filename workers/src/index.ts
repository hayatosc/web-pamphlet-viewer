/**
 * Pamphlet Viewer Workers API
 * Built with Hono framework
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env, Variables } from './types/bindings';

// Route handlers
import { getMetadata } from './routes/metadata';
import { getTile } from './routes/tile';
import { handleUpload } from './routes/upload';
import { invalidateCache } from './routes/invalidate';

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

// API Routes

// Get pamphlet metadata
app.get('/pamphlet/:id/metadata', getMetadata);

// Get tile image
app.get('/pamphlet/:id/page/:page/tile/:x/:y', getTile);

// Upload pamphlet
app.post('/upload', handleUpload);

// Invalidate cache (update version)
app.post('/pamphlet/:id/invalidate', invalidateCache);

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
