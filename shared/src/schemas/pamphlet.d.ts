/**
 * Zod validation schemas for pamphlet data structures
 */
import { z } from 'zod';
/**
 * タイルのメタデータスキーマ
 */
export declare const tileMetadataSchema: z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    hash: z.ZodString;
}, z.core.$strip>;
/**
 * ページ情報スキーマ
 */
export declare const pageInfoSchema: z.ZodObject<{
    page: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    tiles: z.ZodArray<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        hash: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * メタデータスキーマ（サーバー保存用）
 */
export declare const metadataSchema: z.ZodObject<{
    version: z.ZodNumber;
    tile_size: z.ZodNumber;
    pages: z.ZodArray<z.ZodObject<{
        page: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
        tiles: z.ZodArray<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            hash: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * アップロード時のメタデータスキーマ（クライアント送信用）
 * versionはサーバー側で設定されるため含まない
 */
export declare const uploadMetadataSchema: z.ZodObject<{
    tile_size: z.ZodNumber;
    pages: z.ZodArray<z.ZodObject<{
        page: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
        tiles: z.ZodArray<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            hash: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * アップロードレスポンススキーマ
 */
export declare const uploadResponseSchema: z.ZodObject<{
    id: z.ZodString;
    version: z.ZodNumber;
    status: z.ZodLiteral<"ok">;
}, z.core.$strip>;
/**
 * アップロードフォームデータスキーマ（multipart/form-data）
 */
export declare const uploadFormDataSchema: z.ZodObject<{
    id: z.ZodString;
    metadata: z.ZodObject<{
        tile_size: z.ZodNumber;
        pages: z.ZodArray<z.ZodObject<{
            page: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            tiles: z.ZodArray<z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
                hash: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>;
