/**
 * Authentication Middleware
 * Validates signed tokens for protected routes
 */

import { Context } from 'hono';
import type { Env, Variables } from '../types/bindings';
import { validateToken, extractToken } from '../services/token';

/**
 * Token authentication middleware
 * Validates token for pamphlet access
 *
 * Token can be provided via:
 * - Authorization: Bearer <token> header
 * - Query parameter: ?token=<token>
 *
 * Token format: {timestamp}.{signature}
 * The pamphlet ID is extracted from the route parameter
 */
export async function requireToken(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Function
) {
  // Extract pamphlet ID from route parameter
  const pamphletId = c.req.param('id');

  if (!pamphletId) {
    return c.json({ error: 'Missing pamphlet ID' }, 400);
  }

  // Extract token from request
  const authHeader = c.req.header('Authorization');
  const queryToken = c.req.query('token');
  const token = extractToken(authHeader, queryToken);

  if (!token) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Missing authentication token. Provide token via Authorization header or ?token= query parameter',
      },
      401
    );
  }

  // Validate token
  const isValid = await validateToken(c.env, pamphletId, token);

  if (!isValid) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      },
      401
    );
  }

  // Token is valid, proceed to next handler
  await next();
}
