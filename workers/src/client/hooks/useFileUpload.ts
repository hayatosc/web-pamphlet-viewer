import type { ProcessedPage, UploadResponse } from '../types';

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

	// FormDataを構築（ハッシュベース、重複排除）
	const formData = new FormData();
	formData.append('id', pamphletId);
	formData.append('metadata', JSON.stringify(metadata));

	const addedHashes = new Set<string>();
	for (const page of pages) {
		for (const tile of page.tiles) {
			if (!addedHashes.has(tile.hash)) {
				// Create new Uint8Array from the data to ensure ArrayBuffer type
				const dataArray = new Uint8Array(tile.data);
				const blob = new Blob([dataArray], { type: 'image/webp' });
				formData.append(`tile-${tile.hash}`, blob);
				addedHashes.add(tile.hash);
			}
		}
	}

	// Hono RPC not supported this
	const res = await fetch('/admin/upload', {
		method: 'POST',
		body: formData,
	});

	if (!res.ok) {
		const errorText = await res.text();
		throw new Error(`Upload failed: ${res.status} ${errorText}`);
	}

	const result = (await res.json()) as UploadResponse;
	onProgress(100);

	return result;
}
