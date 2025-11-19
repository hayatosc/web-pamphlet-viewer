/**
 * API Type Export for Frontend
 * Manually defined to avoid importing workers code
 */

/**
 * Metadata response type
 */
export interface MetadataResponse {
	version: number;
	tile_size: number;
	pages: Array<{
		page: number;
		width: number;
		height: number;
		tiles: Array<{
			x: number;
			y: number;
			hash: string;
		}>;
	}>;
	total_pages: number;
	has_more: boolean;
	has_previous: boolean;
}
