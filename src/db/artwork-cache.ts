/**
 * Persistent artwork cache. Embedded pictures are downscaled once at import
 * (max 512px, JPEG) and stored as Blobs in IndexedDB — Blob storage is native
 * to IDB in all modern browsers, so no OPFS indirection is needed.
 *
 * Dedupe is by content hash: album tracks sharing bytes share one record via
 * refCount. Runtime object URLs are minted on demand and revoked when the
 * last referencing track is removed or the library is cleared.
 */
import type { ArtworkRecord } from "./schema";

export interface ProcessedArtwork {
	/** Content id: `art-<fnv-of-bytes>`. */
	id: string;
	blob: Blob;
	mime: string;
	width: number | null;
	height: number | null;
}

const MAX_DIMENSION = 512;

/** FNV-1a over raw bytes. Full-content hash: a collision would show the wrong cover. */
export function hashArtworkBytes(bytes: Uint8Array): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < bytes.length; i++) {
		hash ^= bytes[i] ?? 0;
		hash = Math.imul(hash, 0x01000193);
	}
	return `art-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function canvasAvailable(): boolean {
	return (
		typeof document !== "undefined" &&
		typeof createImageBitmap !== "undefined" &&
		typeof document.createElement === "function"
	);
}

/**
 * Downscale large artwork for the cache. Falls back to the original bytes
 * when bitmap/canvas APIs are missing (Node tests) or the image is corrupt.
 */
export async function processArtwork(
	bytes: Uint8Array,
	mime: string,
): Promise<ProcessedArtwork> {
	const id = hashArtworkBytes(bytes);
	const original: ProcessedArtwork = {
		id,
		blob: new Blob([bytes as BlobPart], { type: mime || "image/jpeg" }),
		mime: mime || "image/jpeg",
		width: null,
		height: null,
	};
	if (!canvasAvailable()) return original;
	try {
		const bitmap = await createImageBitmap(
			new Blob([bytes as BlobPart], { type: mime }),
		);
		const scale = Math.min(
			1,
			MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
		);
		if (scale >= 1) {
			bitmap.close();
			return { ...original, width: bitmap.width, height: bitmap.height };
		}
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			bitmap.close();
			return original;
		}
		ctx.drawImage(bitmap, 0, 0, width, height);
		bitmap.close();
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/jpeg", 0.82),
		);
		if (!blob)
			return { ...original, width: bitmap.width, height: bitmap.height };
		return { id, blob, mime: "image/jpeg", width, height };
	} catch {
		return original;
	}
}

/** Build a cache record for a fresh artwork id (refs start at 0; caller bumps). */
export function toRecord(art: ProcessedArtwork): ArtworkRecord {
	return {
		id: art.id,
		blob: art.blob,
		mime: art.mime,
		width: art.width,
		height: art.height,
		refs: 0,
	};
}

/**
 * Runtime object-URL registry. URLs are process-local (never persisted);
 * the cache owns exactly one URL per artwork id.
 */
export class ArtworkUrlCache {
	private urls = new Map<string, string>();

	get(id: string): string | null {
		return this.urls.get(id) ?? null;
	}

	create(id: string, blob: Blob): string {
		const existing = this.urls.get(id);
		if (existing) return existing;
		const url = URL.createObjectURL(blob);
		this.urls.set(id, url);
		return url;
	}

	revoke(id: string): void {
		const url = this.urls.get(id);
		if (url) {
			URL.revokeObjectURL(url);
			this.urls.delete(id);
		}
	}

	revokeAll(): void {
		for (const url of this.urls.values()) URL.revokeObjectURL(url);
		this.urls.clear();
	}

	get size(): number {
		return this.urls.size;
	}
}
