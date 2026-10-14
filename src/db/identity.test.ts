import { describe, expect, it } from "vitest";
import {
	fnv1aHex,
	looseFileTrackId,
	normalizePath,
	resolveCollision,
	stableTrackId,
} from "./identity";

describe("identity", () => {
	it("is deterministic and path-sensitive", () => {
		expect(stableTrackId("s", "a/b.mp3")).toBe(stableTrackId("s", "a/b.mp3"));
		expect(stableTrackId("s", "a/b.mp3")).not.toBe(
			stableTrackId("s", "a/c.mp3"),
		);
		expect(stableTrackId("s1", "a.mp3")).not.toBe(stableTrackId("s2", "a.mp3"));
	});

	it("normalizes separators and case", () => {
		expect(normalizePath("A\\B.MP3")).toBe("a/b.mp3");
		expect(stableTrackId("s", "A/B.mp3")).toBe(stableTrackId("s", "a\\b.mp3"));
	});

	it("gives loose files dedupe-stable ids", () => {
		expect(looseFileTrackId("a.mp3", 100, 5)).toBe(
			looseFileTrackId("a.mp3", 100, 5),
		);
		expect(looseFileTrackId("a.mp3", 100, 5)).not.toBe(
			looseFileTrackId("a.mp3", 101, 5),
		);
	});

	it("resolves collisions with suffixes", () => {
		expect(resolveCollision("trk-x", new Set())).toBe("trk-x");
		expect(resolveCollision("trk-x", new Set(["trk-x"]))).toBe("trk-x-2");
		expect(resolveCollision("trk-x", new Set(["trk-x", "trk-x-2"]))).toBe(
			"trk-x-3",
		);
	});

	it("fnv1a is stable hex", () => {
		expect(fnv1aHex("hello")).toBe(fnv1aHex("hello"));
		expect(fnv1aHex("hello")).toMatch(/^[0-9a-f]{8}$/);
	});
});
