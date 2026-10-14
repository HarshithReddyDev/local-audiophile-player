import { describe, expect, it } from "vitest";
import {
	ArtworkUrlCache,
	hashArtworkBytes,
	processArtwork,
	toRecord,
} from "./artwork-cache";

describe("hashArtworkBytes", () => {
	it("is stable and content-sensitive", () => {
		const a = new Uint8Array([1, 2, 3, 4]);
		const b = new Uint8Array([1, 2, 3, 5]);
		expect(hashArtworkBytes(a)).toBe(
			hashArtworkBytes(new Uint8Array([1, 2, 3, 4])),
		);
		expect(hashArtworkBytes(a)).not.toBe(hashArtworkBytes(b));
		expect(hashArtworkBytes(a)).toMatch(/^art-[0-9a-f]{8}$/);
	});
});

describe("processArtwork", () => {
	it("falls back to original bytes without canvas APIs", async () => {
		const bytes = new Uint8Array([10, 20, 30]);
		const out = await processArtwork(bytes, "image/png");
		expect(out.id).toBe(hashArtworkBytes(bytes));
		expect(out.mime).toBe("image/png");
		expect(await out.blob.arrayBuffer().then((b) => new Uint8Array(b))).toEqual(
			bytes,
		);
	});

	it("builds a zero-ref record", () => {
		const record = toRecord({
			id: "art-x",
			blob: new Blob(["x"]),
			mime: "image/jpeg",
			width: null,
			height: null,
		});
		expect(record.refs).toBe(0);
	});
});

describe("ArtworkUrlCache", () => {
	it("mints one URL per id and revokes", () => {
		const cache = new ArtworkUrlCache();
		const blob = new Blob(["cover"]);
		const first = cache.create("a", blob);
		expect(cache.create("a", blob)).toBe(first);
		expect(cache.get("a")).toBe(first);
		expect(cache.size).toBe(1);
		cache.revoke("a");
		expect(cache.get("a")).toBeNull();
		cache.revokeAll();
		expect(cache.size).toBe(0);
	});
});
