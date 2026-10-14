import { describe, expect, it } from "vitest";
import { diffScan } from "./diff";

describe("diffScan", () => {
	it("classifies added, changed, unchanged, and removed", () => {
		const existing = new Map([
			["a", { size: 100, lastModified: 1 }],
			["b", { size: 200, lastModified: 2 }],
			["gone", { size: 50, lastModified: 1 }],
		]);
		const diff = diffScan(
			[
				{ id: "a", size: 100, lastModified: 1 },
				{ id: "b", size: 250, lastModified: 2 },
				{ id: "new", size: 10, lastModified: 9 },
			],
			existing,
		);
		expect(diff.added.map((f) => f.id)).toEqual(["new"]);
		expect(diff.changed.map((f) => f.id)).toEqual(["b"]);
		expect(diff.unchanged.map((f) => f.id)).toEqual(["a"]);
		expect(diff.removed).toEqual(["gone"]);
	});

	it("handles empty scans and empty libraries", () => {
		expect(diffScan([], new Map()).removed).toEqual([]);
		const diff = diffScan([], new Map([["a", { size: 1, lastModified: 1 }]]));
		expect(diff.removed).toEqual(["a"]);
	});
});
