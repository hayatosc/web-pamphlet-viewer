/**
 * Zod validation schemas for pamphlet data structures
 */
import { z } from 'zod';

/**
 * タイルのメタデータスキーマ
 */
export const tileMetadataSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  hash: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid SHA256 hash format'),
});

/**
 * ページ情報スキーマ
 */
export const pageInfoSchema = z.object({
  page: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tiles: z.array(tileMetadataSchema).min(1),
});

/**
 * メタデータスキーマ（サーバー保存用）
 */
export const metadataSchema = z.object({
  version: z.number().int().positive(),
  tile_size: z.number().int().positive(),
  pages: z.array(pageInfoSchema).min(1),
});

/**
 * アップロード時のメタデータスキーマ（クライアント送信用）
 * versionはサーバー側で設定されるため含まない
 */
export const uploadMetadataSchema = z.object({
  tile_size: z.number().int().positive(),
  pages: z.array(pageInfoSchema).min(1),
});

/**
 * アップロードレスポンススキーマ
 */
export const uploadResponseSchema = z.object({
  id: z.string(),
  version: z.number(),
  status: z.literal('ok'),
});

/**
 * アップロードフォームデータスキーマ（multipart/form-data）
 */
export const uploadFormDataSchema = z.object({
  id: z.string().min(1).max(255),
  metadata: uploadMetadataSchema,
});
