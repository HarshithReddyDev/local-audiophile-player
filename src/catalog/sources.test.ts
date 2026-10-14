import { describe, expect, it } from "vitest";
import {
	bundlingVerdict,
	findSource,
	mayBundleSource,
	SOURCE_REGISTRY,
} from "./sources";

describe("source registry", () => {
	it("is well-formed: unique ids, valid statuses, sane links", () => {
		const ids = SOURCE_REGISTRY.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const s of SOURCE_REGISTRY) {
			expect(["A", "B", "C", "D", "E", "U"]).toContain(s.status);
			expect(s.name.trim().length).toBeGreaterThan(0);
			expect(s.attribution.trim().length).toBeGreaterThan(0);
			expect(/^\d{4}-\d{2}-\d{2}$/.test(s.verifiedAt)).toBe(true);
			expect(s.evidence.trim().length).toBeGreaterThan(0);
			for (const url of [s.website, s.datasetUrl, s.licenseUrl]) {
				if (url === null || url === "") continue;
				expect(() => new URL(url)).not.toThrow();
				expect(url.startsWith("https://") || url.startsWith("http://")).toBe(
					true,
				);
			}
		}
		expect(findSource("opra")?.status).toBe("B");
		expect(findSource("nope")).toBeNull();
	});
});

describe("bundlingVerdict (legal-safety gate)", () => {
	it("allows in-repo authored content unconditionally", () => {
		const v = bundlingVerdict(findSource("in-repo")!);
		expect(v).toEqual({ allowed: true, conditions: [], reasons: [] });
		expect(mayBundleSource("in-repo")).toBe(true);
	});

	it("allows OPRA with attribution + ShareAlike conditions", () => {
		const v = bundlingVerdict(findSource("opra")!);
		expect(v.allowed).toBe(true);
		expect(v.reasons).toEqual([]);
		expect(v.conditions.join("\n")).toMatch(/ShareAlike/);
		expect(v.conditions.join("\n")).toMatch(/attribut/i);
		expect(mayBundleSource("opra")).toBe(true);
	});

	it("denies C/D/E/U and unknown ids, with reasons", () => {
		for (const id of [
			"manufacturer-metadata",
			"autoeq-data",
			"oratory1990",
			"crinacle",
			"innerfidelity",
			"rtings",
			"squiglink",
			"harman-targets",
			"headphonecom-legacy",
		]) {
			const v = bundlingVerdict(findSource(id)!);
			expect(v.allowed, id).toBe(false);
			expect(v.reasons.length, id).toBeGreaterThan(0);
			expect(mayBundleSource(id), id).toBe(false);
		}
		expect(mayBundleSource("ghost-source")).toBe(false);
	});

	it("denies missing attribution and unclear modification", () => {
		const base = findSource("opra")!;
		expect(bundlingVerdict({ ...base, attribution: "  " }).allowed).toBe(false);
		expect(bundlingVerdict({ ...base, modification: "unclear" }).allowed).toBe(
			false,
		);
		expect(
			bundlingVerdict({ ...base, redistribution: "unknown" }).allowed,
		).toBe(false);
	});
});
