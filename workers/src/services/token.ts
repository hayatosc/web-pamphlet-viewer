/**
 * Token Service
 * Handles signed token generation and validation using HMAC-SHA256
 *
 * Based on Oliver's cacheable signed URL pattern:
 * https://zenn.dev/oliver/articles/cloudflare-meetup-2023-10-06
 */

import type { Env } from '../types/bindings';

/**
 * Token parameters for signature generation
 */
export interface TokenParams {
  pamphletId: string;
  timestamp: number;  // Rounded timestamp for cache buckets
  expiresIn?: number; // Optional expiration in seconds
}

/**
 * Round timestamp to nearest bucket (default: 5 minutes = 300 seconds)
 * This enables caching while maintaining security
 */
export function roundTimestamp(timestamp: number, bucketSize: number = 300): number {
  return Math.floor(timestamp / bucketSize) * bucketSize;
}

/**
 * Generate HMAC-SHA256 signature for token
 */
async function generateSignature(
  secret: string,
  pamphletId: string,
  timestamp: number
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${pamphletId}:${timestamp}`);
  const keyData = encoder.encode(secret);

  // Import secret as CryptoKey
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Generate signature
  const signature = await crypto.subtle.sign('HMAC', key, data);

  // Convert to base64url
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate signed token for pamphlet access
 *
 * @param env - Workers environment with SECRET_KEY
 * @param pamphletId - Pamphlet ID to generate token for
 * @param expiresIn - Optional expiration time in seconds (default: 3600 = 1 hour)
 * @returns Token string in format: timestamp.signature
 */
export async function generateToken(
  env: Env,
  pamphletId: string,
  expiresIn: number = 3600
): Promise<string> {
  const secret = env.SECRET_KEY || 'default-secret-key-change-me';

  // Use rounded timestamp for cache bucketing
  const now = Date.now() / 1000;
  const roundedTimestamp = roundTimestamp(now);

  // Generate signature
  const signature = await generateSignature(secret, pamphletId, roundedTimestamp);

  // Return token: timestamp.signature
  return `${roundedTimestamp}.${signature}`;
}

/**
 * Validate signed token
 *
 * @param env - Workers environment with SECRET_KEY
 * @param pamphletId - Pamphlet ID to validate against
 * @param token - Token string to validate
 * @param maxAge - Maximum token age in seconds (default: 3600 = 1 hour)
 * @returns true if token is valid, false otherwise
 */
export async function validateToken(
  env: Env,
  pamphletId: string,
  token: string,
  maxAge: number = 3600
): Promise<boolean> {
  try {
    const secret = env.SECRET_KEY || 'default-secret-key-change-me';

    // Parse token: timestamp.signature
    const parts = token.split('.');
    if (parts.length !== 2) {
      return false;
    }

    const [timestampStr, providedSignature] = parts;
    const timestamp = parseInt(timestampStr, 10);

    if (isNaN(timestamp)) {
      return false;
    }

    // Check expiration
    const now = Date.now() / 1000;
    if (now - timestamp > maxAge) {
      console.log(`Token expired: now=${now}, timestamp=${timestamp}, maxAge=${maxAge}`);
      return false;
    }

    // Recompute signature
    const expectedSignature = await generateSignature(secret, pamphletId, timestamp);

    // Compare signatures (constant-time comparison)
    return constantTimeEqual(expectedSignature, providedSignature);
  } catch (error) {
    console.error('Token validation error:', error);
    return false;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Extract token from Authorization header or query parameter
 *
 * Supports:
 * - Authorization: Bearer <token>
 * - Query parameter: ?token=<token>
 */
export function extractToken(authHeader: string | undefined, queryToken: string | undefined): string | null {
  // Try Authorization header first
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      return match[1];
    }
  }

  // Fall back to query parameter
  if (queryToken) {
    return queryToken;
  }

  return null;
}
