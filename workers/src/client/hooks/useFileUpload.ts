import type { ProcessedPage, UploadResponse } from '../types';

/**
 * Client-side chunk size for batching tile uploads
 * The server-side /tiles endpoint uses R2_UPLOAD_CHUNK_SIZE=50 and will further split as needed
 * See PR description for rationale on different chunk sizes
 */
const CLIENT_CHUNK_SIZE = 100;

/**
 * Maximum progress percentage allocated to tile uploads
 * Remaining percentage is reserved for metadata upload
 */
const TILE_UPLOAD_PROGRESS_MAX = 90;

export async function uploadTiles(
	pages: ProcessedPage[],
	pamphletId: string,
	tileSize: number,
	onProgress: (progress: number) => void
): Promise<UploadResponse> {
	if (pages.length === 0) {
		throw new Error('アップロード可能なページがありません');
	}

	onProgress(0);

	// メタデータを構築（versionはサーバー側で設定される）
	const metadata = {
		tile_size: tileSize,
		pages: pages.map((page) => ({
			page: page.pageNumber,
			width: page.width,
			height: page.height,
			tiles: page.tiles.map((tile) => ({
				x: tile.x,
				y: tile.y,
				hash: tile.hash,
			})),
		})),
	};

	// Collect unique tiles (hash-based deduplication)
	const uniqueTiles = new Map<string, Uint8Array>();
	for (const page of pages) {
		for (const tile of page.tiles) {
			if (!uniqueTiles.has(tile.hash)) {
				uniqueTiles.set(tile.hash, tile.data);
			}
		}
	}

	const totalTiles = uniqueTiles.size;
	const tiles = Array.from(uniqueTiles.entries());
	let uploadedTiles = 0;

	// Upload tiles in chunks
	for (let i = 0; i < tiles.length; i += CLIENT_CHUNK_SIZE) {
		const chunk = tiles.slice(i, i + CLIENT_CHUNK_SIZE);
		const formData = new FormData();
		formData.append('id', pamphletId);

		// Add metadata to first chunk for server-side validation (optional)
		if (i === 0) {
			formData.append('metadata', JSON.stringify(metadata));
		}

		// Add tiles to FormData
		for (const [hash, data] of chunk) {
			// Pass Uint8Array directly to Blob constructor (no need for .buffer)
			const blob = new Blob([data], { type: 'image/webp' });
			formData.append(`tile-${hash}`, blob);
		}

		// Upload chunk
		const res = await fetch('/admin/upload/tiles', {
			method: 'POST',
			body: formData,
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw new Error(`Tile upload failed: ${res.status} ${errorText}`);
		}

		uploadedTiles += chunk.length;
		const progress = Math.floor((uploadedTiles / totalTiles) * TILE_UPLOAD_PROGRESS_MAX);
		onProgress(progress);
	}

	// Finalize upload with metadata
	const completeRes = await fetch('/admin/upload/complete', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			id: pamphletId,
			metadata,
		}),
	});

	if (!completeRes.ok) {
		const errorText = await completeRes.text();
		throw new Error(`Upload completion failed: ${completeRes.status} ${errorText}`);
	}

	const result = (await completeRes.json()) as UploadResponse;
	onProgress(100);

	return result;
}
