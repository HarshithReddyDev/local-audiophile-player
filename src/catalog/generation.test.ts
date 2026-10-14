import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, searchDevices } from "./catalog";
import { FULL_CATALOG, fullCatalogCheck } from "./index";
import { buildCatalogData, ingestRecords } from "./ingest";
import { CATALOG_DATA_VERSION, SEED_CATALOG } from "./seed";
import { validateCatalog } from "./validate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXAMPLE = join(ROOT, "scripts", "catalog", "example-source.json");

describe("catalog refresh path", () => {
	it("ingests the checked-in example end to end", () => {
		const raw: unknown = JSON.parse(readFileSync(EXAMPLE, "utf-8"));
		const batch = ingestRecords(raw, 42);
		// Near-duplicate kept separate + flagged; nameless rejected; the
		// factory preset (pretend full grant) passes the gate.
		expect(batch.devices).toHaveLength(2);
		expect(batch.duplicates).toHaveLength(1);
		expect(batch.rejected.map((r) => r.reason)).toEqual(
			expect.arrayContaining([expect.stringMatching(/manufacturer\/model/)]),
		);
		expect(batch.presets).toHaveLength(1);

		const { catalog, problems, report } = buildCatalogData(SEED_CATALOG, [
			batch,
		]);
		expect(problems).toEqual([]);
		expect(report.devices).toBe(SEED_CATALOG.devices.length + 2);
		expect(report.duplicates).toHaveLength(1);
		expect(report.rejected).toHaveLength(1);
		expect(report.sources).toContain("Example Audio official specs");
		expect(report.needsReview.length).toBeGreaterThan(0);

		// Deterministic refresh: same bytes in, same catalog out.
		const again = buildCatalogData(SEED_CATALOG, [ingestRecords(raw, 42)]);
		expect(JSON.stringify(again.catalog)).toBe(JSON.stringify(catalog));
	});

	it("seed + generated layer validate clean with a data version", () => {
		expect(validateCatalog(SEED_CATALOG)).toEqual([]);
		expect(validateCatalog(FULL_CATALOG)).toEqual([]);
		expect(Number.isInteger(CATALOG_DATA_VERSION)).toBe(true);
		const check = fullCatalogCheck();
		expect(check.problems).toEqual([]);
		expect(check.report.devices).toBe(FULL_CATALOG.devices.length);
	});
});

describe("catalog performance", () => {
	it("stays fast at 100 / 1k / 5k / 10k devices", () => {
		for (const n of [100, 1000, 5000, 10000]) {
			const devices = Array.from({ length: n }, (_, i) => ({
				id: `perf-${i}`,
				manufacturer: `Maker${i % 50}`,
				model: `Model ${i}`,
				aliases: [`M${i}`],
				deviceType: "iem" as const,
				driver: { configuration: null, connectivity: null },
				provenance: {
					source: "perf fixture (not shipped)",
					sourceType: "in-repo" as const,
					sourceUrl: "",
					attribution: "synthetic",
					license: "MIT",
					redistribution: "metadata-only" as const,
					importedAt: null,
				},
				releaseYear: null,
				notes: null,
				presetIds: [],
				measurementRefs: [],
			}));
			const catalog = { version: 1, devices, presets: [] };
			const t0 = performance.now();
			expect(validateCatalog(catalog)).toEqual([]);
			const t1 = performance.now();
			const hits = searchDevices(catalog, { ...EMPTY_FILTER, query: "maker3" });
			const t2 = performance.now();
			expect(hits.length).toBeGreaterThan(0);
			const mem = Math.round(process.memoryUsage().heapUsed / 1048576);
			console.log(
				`catalog/perf n=${n}: validate=${(t1 - t0).toFixed(1)}ms search=${(t2 - t1).toFixed(1)}ms heap=${mem}MB`,
			);
			// Generous tripwires: metadata must stay interactive; chunking
			// only if these ever approach them (they don't — see report).
			expect(t1 - t0).toBeLessThan(5000);
			expect(t2 - t1).toBeLessThan(1000);
		}
	}, 120000);
});
