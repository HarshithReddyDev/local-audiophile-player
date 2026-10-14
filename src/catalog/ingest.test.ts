import { describe, expect, it } from "vitest";
import {
	buildCatalogData,
	ingestRecords,
	normalizeIdentity,
	stableDeviceId,
} from "./ingest";
import { SEED_CATALOG } from "./seed";
import { validateCatalog } from "./validate";

function prov(over: Record<string, unknown> = {}) {
	return {
		source: "Test source",
		sourceType: "manufacturer",
		sourceUrl: "https://example.com",
		attribution: "test",
		license: "test",
		redistribution: "metadata-only",
		...over,
	};
}

function device(over: Record<string, unknown> = {}) {
	return {
		manufacturer: "Acme",
		model: "Widget",
		aliases: [],
		deviceType: "iem",
		driver: {},
		provenance: prov(),
		...over,
	};
}

describe("identity", () => {
	it("normalizes deterministically", () => {
		expect(normalizeIdentity("Sennheiser", "HD 600")).toBe(
			normalizeIdentity("sennheiser ", "hd-600"),
		);
		expect(stableDeviceId("Acme", "Widget Pro")).toBe("acme-widget-pro");
	});
});

describe("ingestRecords", () => {
	it("normalizes, validates, and gates licenses", () => {
		const batch = ingestRecords(
			{
				devices: [
					device(),
					device({ model: "" }),
					{ manufacturer: "Acme" },
					"nope",
				],
				presets: [
					{
						name: "P",
						peq: { version: 1, preamp: 0, enabled: true, bands: [] },
						origin: "community",
						provenance: prov({ redistribution: "metadata-only" }),
					},
				],
			},
			1,
		);
		expect(batch.devices).toHaveLength(1);
		expect(batch.devices[0]?.id).toBe("acme-widget");
		expect(batch.rejected.map((r) => r.reason)).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/manufacturer\/model required/),
				expect.stringMatching(/must be an object/),
				expect.stringMatching(/requires redistribution/),
			]),
		);
		expect(batch.rejected).toHaveLength(4);
	});

	it("keeps uncertain duplicates separate and flags them", () => {
		const batch = ingestRecords(
			[device(), device({ aliases: ["W"] }), device()],
			2,
		);
		// All three kept (never merged); two flagged as duplicate candidates.
		expect(batch.devices).toHaveLength(3);
		expect(batch.duplicates).toHaveLength(2);
		expect(batch.duplicates[0]?.keptId).toBe("acme-widget");
	});

	it("rejects garbage shapes and oversized payloads loudly", () => {
		expect(ingestRecords("nope", 0).rejected).toHaveLength(1);
		expect(ingestRecords({}, 0).rejected).toHaveLength(1);
		expect(ingestRecords({ devices: "x" }, 0).rejected).toHaveLength(1);
		const big = { devices: Array.from({ length: 50001 }, () => device()) };
		const out = ingestRecords(big, 0);
		expect(out.devices).toEqual([]);
		expect(out.rejected[0]?.reason).toMatch(/exceeds/);
	});

	it("is deterministic for identical input", () => {
		const input = { devices: [device({ model: "B" }), device({ model: "A" })] };
		const a = JSON.stringify(ingestRecords(input, 9));
		const b = JSON.stringify(ingestRecords(input, 9));
		expect(a).toBe(b);
	});
});

describe("buildCatalogData", () => {
	it("merges batches onto the seed with cross-refs and a report", () => {
		const batch = ingestRecords(
			{
				devices: [device({ manufacturer: "NewCo", model: "One" })],
				presets: [
					{
						id: "newco-preset",
						name: "Factory",
						deviceId: "newco-one",
						peq: { version: 1, preamp: 0, enabled: true, bands: [] },
						origin: "manufacturer",
						provenance: prov({ redistribution: "full" }),
					},
					{
						id: "dangling",
						name: "Dangling",
						deviceId: "ghost",
						peq: { version: 1, preamp: 0, enabled: true, bands: [] },
						origin: "manual",
						provenance: prov(),
					},
				],
			},
			3,
		);
		const { catalog, problems, report } = buildCatalogData(SEED_CATALOG, [
			batch,
		]);
		expect(problems).toEqual([]);
		expect(validateCatalog(catalog)).toEqual([]);
		expect(report.devices).toBe(SEED_CATALOG.devices.length + 1);
		expect(report.presets).toBe(SEED_CATALOG.presets.length + 1);
		expect(report.manufacturers).toBeGreaterThan(1);
		expect(report.sources).toContain("Test source");
		expect(report.rejected.map((r) => r.reason)).toEqual(
			expect.arrayContaining([expect.stringMatching(/unknown deviceId/)]),
		);
		const again = buildCatalogData(SEED_CATALOG, [batch]);
		expect(JSON.stringify(again.catalog)).toBe(JSON.stringify(catalog));
	});

	it("rejects preset id collisions with the base catalog", () => {
		const batch = ingestRecords(
			{
				presets: [
					{
						id: "tutorial-gentle-trim",
						name: "Copycat",
						peq: { version: 1, preamp: 0, enabled: true, bands: [] },
						origin: "manual",
						provenance: prov(),
					},
				],
			},
			4,
		);
		const { report } = buildCatalogData(SEED_CATALOG, [batch]);
		expect(report.rejected.map((r) => r.reason)).toEqual(
			expect.arrayContaining([expect.stringMatching(/duplicate preset id/)]),
		);
	});
});

describe("source gate", () => {
	it("admits approved sources and surfaces their conditions", () => {
		const batch = ingestRecords({ devices: [device()] }, 5, {
			sourceIds: ["opra"],
		});
		expect(batch.gate.allowed).toBe(true);
		expect(batch.devices).toHaveLength(1);
		const { report } = buildCatalogData(SEED_CATALOG, [batch]);
		expect(report.gateConditions.join("\n")).toMatch(/ShareAlike/);
	});

	it("refuses denied sources wholesale, with reasons, admitting nothing", () => {
		for (const id of ["autoeq-data", "oratory1990", "rtings", "ghost"]) {
			const batch = ingestRecords({ devices: [device()] }, 5, {
				sourceIds: [id],
			});
			expect(batch.gate.allowed, id).toBe(false);
			expect(batch.devices, id).toEqual([]);
			expect(batch.presets, id).toEqual([]);
			expect(batch.rejected.length, id).toBeGreaterThan(0);
		}
	});

	it("requires a declared source id (fail closed)", () => {
		const batch = ingestRecords({ devices: [device()] }, 5, { sourceIds: [] });
		expect(batch.gate.allowed).toBe(false);
		expect(batch.devices).toEqual([]);
	});

	it("ungated batches keep legacy behavior", () => {
		const batch = ingestRecords({ devices: [device()] }, 5);
		expect(batch.gate.allowed).toBe(true);
		expect(batch.devices).toHaveLength(1);
	});
});
