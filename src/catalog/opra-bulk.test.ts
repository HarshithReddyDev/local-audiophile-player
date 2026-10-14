import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_CATALOG } from "./generated";
import { normalizeIdentity } from "./ingest";
import {
	ingestOpraSnapshot,
	isRtingsLinked,
	OPRA_SUBTYPE_MAP,
} from "./opra-bulk";
import { SEED_CATALOG } from "./seed";

function jsonl(rows: unknown[]): string {
	return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

function vendor(id: string, name: string): unknown {
	return { type: "vendor", id, data: { name } };
}

function product(id: string, name: string, subtype: string): unknown {
	return { type: "product", id, data: { name, type: "headphones", subtype } };
}

function eq(
	id: string,
	author: string,
	details: string,
	bands: unknown[] = [{ type: "peak_dip", frequency: 1000, gain_db: 1, q: 1 }],
): unknown {
	return {
		type: "eq",
		id,
		data: {
			author,
			details,
			type: "parametric_eq",
			parameters: { gain_db: 0, bands },
		},
	};
}

const SEED = new Map([["acme--widget", "acme-widget"]]);

describe("OPRA subtype mapping", () => {
	it("covers every observed subtype explicitly", () => {
		expect(OPRA_SUBTYPE_MAP).toEqual({
			in_ear: "iem",
			earbuds: "earbuds",
			true_wireless: "tws",
			over_the_ear: "headphones",
			on_ear: "headphones",
		});
	});
});

describe("isRtingsLinked", () => {
	it("catches author and details variants", () => {
		expect(isRtingsLinked("Rtings/AutoEQ", "Harman Target")).toBe(true);
		expect(isRtingsLinked("AutoEQ", "Measured by Rtings")).toBe(true);
		expect(isRtingsLinked("AutoEQ", "Measured by oratory1990")).toBe(false);
		expect(isRtingsLinked("oratory1990", "Harman Target")).toBe(false);
	});
});

describe("ingestOpraSnapshot", () => {
	const base = [
		vendor("acme", "Acme"),
		product("acme::widget", "Widget", "in_ear"),
		product("acme::gadget", "Gadget", "mystery_subtype"),
		eq("acme:widget::autoeq_jane", "AutoEQ", "Measured by Jane"),
		eq("acme:widget::autoeq_rtings", "Rtings/AutoEQ", "Harman Target"),
		eq("acme:widget::broken", "AutoEQ", "Measured by Jane", [
			{ type: "peak_dip", frequency: 100, gain_db: null, q: 1 },
		]),
		eq("acme:gadget::autoeq_jane", "AutoEQ", "Measured by Jane"),
		eq("acme:ghost::autoeq_jane", "AutoEQ", "Measured by Jane"),
	];

	it("imports, merges, rejects, and flags deterministically", () => {
		const text = jsonl(base);
		const once = ingestOpraSnapshot(text, SEED);
		const twice = ingestOpraSnapshot(text, SEED);
		expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
		expect(once.stats.vendors).toBe(1);
		expect(once.stats.products).toBe(2);
		expect(once.stats.eqInspected).toBe(5);
		expect(once.stats.rejectedRtings).toBe(1);
		expect(once.stats.rejectedMalformed).toBe(1);
		expect(once.stats.rejectedUnknownSubtype).toBe(1);
		expect(once.stats.rejectedDangling).toBe(2);
		// Widget merges into the seed device (metadata untouched).
		expect(once.stats.mergedIntoSeed).toBe(1);
		expect(once.stats.importedDevices).toBe(0);
		expect(once.stats.importedPresets).toBe(1);
		expect(once.presets[0]?.deviceId).toBe("acme-widget");
		expect(once.presets[0]?.provenance.shareAlike).toBe(true);
	});

	it("flags band outliers and value anomalies without dropping", () => {
		const wide = Array.from({ length: 15 }, (_, i) => ({
			type: "peak_dip",
			frequency: 100 + i * 100,
			gain_db: 1,
			q: 1,
		}));
		const out = ingestOpraSnapshot(
			jsonl([
				vendor("acme", "Acme"),
				product("acme::big", "Big", "in_ear"),
				eq("acme:big::autoeq_jane", "AutoEQ", "Measured by Jane", wide),
			]),
			new Map(),
		);
		expect(out.stats.bandOutliers).toBe(1);
		expect(out.presets).toHaveLength(1);
		expect(out.presets[0]?.peq.bands).toHaveLength(15);
	});

	it("counts malformed lines without aborting", () => {
		const out = ingestOpraSnapshot(
			'{"type":"vendor","id":"a","data":{"name":"A"}}\nnot json\n{"type":"product","id":"a::b","data":{"name":"B","subtype":"in_ear"}}\n',
			new Map(),
		);
		expect(out.stats.malformedLines).toBe(1);
		expect(out.stats.importedDevices).toBe(1);
	});

	it("keeps generated ids off hand-reviewed seed ids (never duplicates)", () => {
		// Seed device id "a-b-c" (identity "a--b-c"); the OPRA product
		// "A B / C" (identity "a-b--c") is a naming overlap, not an exact
		// match: it must merge nowhere, duplicate nothing, and be flagged.
		const seedIds = new Map([["a--b-c", "a-b-c"]]);
		const out = ingestOpraSnapshot(
			jsonl([
				vendor("a_b", "A B"),
				product("a_b::c", "C", "in_ear"),
				eq("a_b:c::autoeq_jane", "AutoEQ", "Measured by Jane"),
			]),
			seedIds,
		);
		expect(out.stats.mergedIntoSeed).toBe(0);
		expect(out.stats.importedDevices).toBe(1);
		expect(out.devices[0]?.id).toBe("a-b-c-2");
		expect(out.presets[0]?.deviceId).toBe("a-b-c-2");
		expect(out.review.join("\n")).toMatch(
			/collides with a hand-reviewed seed id/,
		);
	});
});

describe("bulk determinism against the frozen snapshot (Phase 14)", () => {
	const SNAP = join(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"..",
		"scripts",
		"catalog",
		"opra-snapshot",
		"database_v1.jsonl",
	);

	function regenerate() {
		const text = readFileSync(SNAP, "utf-8");
		const seedMap = new Map(
			SEED_CATALOG.devices.map((d) => [
				normalizeIdentity(d.manufacturer, d.model),
				d.id,
			]),
		);
		return ingestOpraSnapshot(text, seedMap);
	}

	it("produces byte-identical output on identical input", () => {
		const once = regenerate();
		const twice = regenerate();
		expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
		expect(once.stats.importedDevices).toBe(6208);
		expect(once.stats.importedPresets).toBe(11288);
		expect(once.stats.rejectedRtings).toBe(1301);
		expect(once.stats.mergedIntoSeed).toBe(22);
	}, 300000);

	it("committed generated layer equals pipeline output", () => {
		const out = regenerate();
		const byId = (a: { id: string }, b: { id: string }) =>
			a.id.localeCompare(b.id);
		expect(GENERATED_CATALOG.version).toBe(1);
		expect([...GENERATED_CATALOG.devices].sort(byId)).toEqual(
			[...out.devices].sort(byId),
		);
		expect([...GENERATED_CATALOG.presets].sort(byId)).toEqual(
			[...out.presets].sort(byId),
		);
		// PoC records survived expansion with chains intact.
		const hd600 = GENERATED_CATALOG.presets.filter(
			(p) => p.deviceId === "sennheiser-hd-600",
		);
		expect(hd600.length).toBeGreaterThanOrEqual(2);
		for (const p of hd600) {
			expect(p.provenance.attribution).toMatch(/via OPRA/);
			expect(p.provenance.shareAlike).toBe(true);
		}
	}, 300000);
});
