import { describe, expect, it } from "vitest";
import type { SerializedPEQ } from "../dsp/types";
import {
	buildDevicePresetCounts,
	buildDevicePresetSources,
	catalogManufacturers,
	catalogSources,
	devicePresets,
	EMPTY_FILTER,
	getDevice,
	searchDevices,
	sortDevices,
} from "./catalog";
import { SEED_CATALOG } from "./seed";
import type { DeviceCatalog } from "./types";
import { validateCatalog } from "./validate";

describe("seed catalog", () => {
	it("passes the ingestion gate", () => {
		expect(validateCatalog(SEED_CATALOG)).toEqual([]);
	});

	it("ships metadata only, no third-party measurement data", () => {
		expect(SEED_CATALOG.devices.length).toBeGreaterThan(0);
		for (const d of SEED_CATALOG.devices) {
			expect(d.presetIds).toEqual([]);
			expect(["metadata-only", "none"]).toContain(d.provenance.redistribution);
		}
		// The only bundled PEQ is in-repo authored and says so.
		for (const p of SEED_CATALOG.presets) {
			expect(p.origin).toBe("tutorial");
			expect(p.deviceId).toBeNull();
			expect(p.provenance.redistribution).toBe("full");
		}
	});
});

describe("catalog queries", () => {
	it("looks up devices and their presets", () => {
		expect(getDevice(SEED_CATALOG, "sennheiser-hd-600")?.model).toBe("HD 600");
		expect(getDevice(SEED_CATALOG, "nope")).toBeNull();
		expect(devicePresets(SEED_CATALOG, "sennheiser-hd-600")).toEqual([]);
		expect(devicePresets(SEED_CATALOG, "nope")).toEqual([]);
	});

	it("searches across manufacturer, model, and aliases", () => {
		const ids = (q: string) =>
			searchDevices(SEED_CATALOG, { ...EMPTY_FILTER, query: q }).map(
				(d) => d.id,
			);
		expect(ids("HD600")).toContain("sennheiser-hd-600");
		expect(ids("sennheiser")).toContain("sennheiser-hd-600");
		expect(ids("M50x")).toContain("audio-technica-ath-m50x");
		expect(ids("  qc   ULTRA ")).toContain("bose-qc-ultra-headphones");
		expect(ids("zzz-no-such-device")).toEqual([]);
	});

	it("filters by type, manufacturer, and EQ availability", () => {
		const tws = searchDevices(SEED_CATALOG, {
			...EMPTY_FILTER,
			deviceType: "tws",
		});
		expect(tws.length).toBeGreaterThan(0);
		expect(tws.every((d) => d.deviceType === "tws")).toBe(true);
		const makers = catalogManufacturers(SEED_CATALOG);
		expect(makers).toContain("Sennheiser");
		const byMaker = searchDevices(SEED_CATALOG, {
			...EMPTY_FILTER,
			manufacturer: "Sennheiser",
		});
		expect(byMaker.every((d) => d.manufacturer === "Sennheiser")).toBe(true);
		expect(
			searchDevices(SEED_CATALOG, { ...EMPTY_FILTER, hasEq: true }),
		).toEqual([]);
	});

	it("returns stable sorted order", () => {
		const once = searchDevices(SEED_CATALOG, EMPTY_FILTER).map((d) => d.id);
		const twice = searchDevices(SEED_CATALOG, EMPTY_FILTER).map((d) => d.id);
		expect(twice).toEqual(once);
	});

	it("filters by source and measurement availability", () => {
		expect(catalogSources(SEED_CATALOG)).toContain("Shure official site");
		const bySource = searchDevices(SEED_CATALOG, {
			...EMPTY_FILTER,
			source: "Shure official site",
		});
		expect(bySource.length).toBeGreaterThan(0);
		expect(
			bySource.every((d) => d.provenance.source === "Shure official site"),
		).toBe(true);
		// Seed carries no verified external measurement links (honest state).
		expect(
			searchDevices(SEED_CATALOG, { ...EMPTY_FILTER, hasMeasurements: true }),
		).toEqual([]);
		const withRef: DeviceCatalog = {
			version: 1,
			devices: [
				{
					...SEED_CATALOG.devices[0]!,
					measurementRefs: [
						{
							label: "Example rig",
							sourceUrl: "https://example.com/m",
							channel: "left",
							note: null,
						},
					],
				},
			],
			presets: [],
		};
		expect(
			searchDevices(withRef, { ...EMPTY_FILTER, hasMeasurements: true }),
		).toHaveLength(1);
	});

	it("sorts by name, manufacturer, category, and EQ availability", () => {
		const devices = SEED_CATALOG.devices;
		// Name sort is manufacturer+model alphabetical.
		const labels = sortDevices(devices, "name").map(
			(d) => `${d.manufacturer} ${d.model}`,
		);
		expect([...labels].sort((a, b) => a.localeCompare(b))).toEqual(labels);
		const byMaker = sortDevices(devices, "manufacturer");
		expect(byMaker[0]?.manufacturer).toBe("Apple");
		const byCat = sortDevices(devices, "category");
		const cats = byCat.map((d) => d.deviceType);
		expect([...cats].sort()).toEqual(cats);
		// Deterministic across runs.
		expect(sortDevices(devices, "eq").map((d) => d.id)).toEqual(
			sortDevices(devices, "eq").map((d) => d.id),
		);
	});
});

describe("validateCatalog", () => {
	function valid(): DeviceCatalog {
		return JSON.parse(JSON.stringify(SEED_CATALOG)) as DeviceCatalog;
	}

	it("rejects duplicate ids, bad refs, and malformed PEQ", () => {
		const dup = valid();
		dup.devices.push({ ...dup.devices[0]! });
		expect(validateCatalog(dup).join("\n")).toMatch(/duplicated/);

		const ref = valid();
		ref.devices[0]!.presetIds = ["ghost-preset"];
		expect(validateCatalog(ref).join("\n")).toMatch(/unknown presetId/);

		const peq = valid();
		const badPeq = {
			version: 1,
			preamp: 0,
			enabled: true,
			bands: [{ type: "wah", frequency: 1000, gain: 0, q: 1, enabled: true }],
		} as unknown as SerializedPEQ;
		peq.presets[0]!.peq = badPeq;
		expect(validateCatalog(peq).join("\n")).toMatch(/not a valid/);
	});

	it("rejects third-party origins without redistribution rights", () => {
		const c = valid();
		c.presets[0]!.origin = "community";
		c.presets[0]!.provenance.redistribution = "metadata-only";
		expect(validateCatalog(c).join("\n")).toMatch(/requires redistribution/);
	});

	it("rejects missing provenance and non-http(s) links", () => {
		const c = valid();
		c.devices[0]!.provenance.sourceUrl = "ftp://example.com/x";
		expect(validateCatalog(c).join("\n")).toMatch(/sourceUrl/);
		const c2 = valid();
		c2.devices[0]!.provenance.attribution = "  ";
		expect(validateCatalog(c2).join("\n")).toMatch(/attribution/);
	});
});

describe("generated-layer preset linkage (bulk OPRA)", () => {
	function linked(): DeviceCatalog {
		const c = JSON.parse(JSON.stringify(SEED_CATALOG)) as DeviceCatalog;
		// Simulate a generated-layer preset: attached via deviceId scan,
		// canonical device.presetIds untouched (never edited by ingestion).
		const deviceId = "sennheiser-hd-600";
		c.presets.push({
			...c.presets[0]!,
			id: "opra-sennheiser-hd-600-autoeq-oratory1990",
			name: "autoeq oratory1990",
			deviceId,
			origin: "community",
			provenance: {
				source: "OPRA",
				sourceType: "community",
				sourceUrl:
					"https://github.com/opra-project/OPRA/tree/main/database/vendors/sennheiser/products/hd_600/eq/autoeq_oratory1990",
				attribution: "EQ by AutoEQ via OPRA (Measured by oratory1990)",
				license: "CC BY-SA 4.0",
				redistribution: "full",
				shareAlike: true,
				importedAt: 1,
			},
		});
		return c;
	}

	it("counts presets via the deviceId scan, not presetIds", () => {
		const counts = buildDevicePresetCounts(linked());
		expect(counts.get("sennheiser-hd-600")).toBe(1);
		expect(counts.get("sony-wf-1000xm5") ?? 0).toBe(0);
	});

	it("hasEq matches devices whose presets attach via scan", () => {
		const c = linked();
		const withEq = searchDevices(c, { ...EMPTY_FILTER, hasEq: true });
		expect(withEq.map((d) => d.id)).toContain("sennheiser-hd-600");
		expect(withEq.map((d) => d.id)).not.toContain("sony-wf-1000xm5");
	});

	it("source filter matches via preset provenance too", () => {
		const c = linked();
		// Seed HD 600 provenance is the manufacturer page, but it carries
		// an OPRA preset — filtering by OPRA must still find it.
		const byOpra = searchDevices(c, { ...EMPTY_FILTER, source: "OPRA" });
		expect(byOpra.map((d) => d.id)).toContain("sennheiser-hd-600");
		const sources = buildDevicePresetSources(c);
		expect(sources.get("sennheiser-hd-600")?.has("OPRA")).toBe(true);
	});

	it("eq sort uses derived counts when provided", () => {
		const c = linked();
		const counts = buildDevicePresetCounts(c);
		const sorted = sortDevices(c.devices, "eq", counts);
		expect(sorted[0]?.id).toBe("sennheiser-hd-600");
		// Without counts, legacy presetIds behavior is unchanged.
		const legacy = sortDevices(c.devices, "eq");
		expect(legacy.map((d) => d.id)).toHaveLength(c.devices.length);
	});
});
