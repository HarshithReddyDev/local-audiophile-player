/**
 * Bulk OPRA ingestion: frozen dist snapshot (JSONL) → catalog records.
 *
 * Runs the same gates as everything else (adapter validation, Rtings
 * exclusion, license gate, cross-references, determinism) at full-dataset
 * scale. Reads the frozen snapshot file — never the live site.
 *
 * Rejection policy (documented in docs/catalog-data-licenses.md):
 * - Rtings-linked records (author or details): explicit restrictive
 *   posture upstream → rejected.
 * - Malformed records (adapter errors, dangling product refs): rejected.
 * - Unknown product subtypes: device skipped, preset orphan impossible
 *   (linkage is by product record, checked first).
 * - Everything else with complete author+details credits: accepted under
 *   OPRA's asserted CC BY-SA grant, chains preserved, residual upstream
 *   risk documented per record via attribution.
 */

import { normalizeIdentity, stableDeviceId } from "./ingest";
import { adaptOpraPreset, OPRA_LICENSE, OpraAdapterError } from "./opra";
import type { CatalogDevice, CatalogPreset, DeviceType } from "./types";

/**
 * Explicit OPRA subtype mapping (Phase 7). Openness is NOT in OPRA product
 * records, so over_the_ear/on_ear map to the generic "headphones" bucket
 * rather than a guessed open/closed split. Evidence: info.json carries
 * only name/type/subtype (verified on 7hz/sennheiser samples).
 */
export const OPRA_SUBTYPE_MAP: Record<string, DeviceType> = {
	in_ear: "iem",
	earbuds: "earbuds",
	true_wireless: "tws",
	over_the_ear: "headphones",
	on_ear: "headphones",
};

export interface OpraBulkStats {
	vendors: number;
	products: number;
	eqInspected: number;
	malformedLines: number;
	rejectedRtings: number;
	rejectedMalformed: number;
	rejectedUnknownSubtype: number;
	rejectedDangling: number;
	importedDevices: number;
	importedPresets: number;
	mergedIntoSeed: number;
	bandOutliers: number;
	valueAnomalies: number;
}

export interface OpraBulkResult {
	devices: CatalogDevice[];
	presets: CatalogPreset[];
	/** Human-readable per-record notes (review + report input). */
	review: string[];
	stats: OpraBulkStats;
}

interface JsonlProduct {
	id: string;
	name: string;
	subtype: string;
	vendorDir: string;
	vendorName: string;
}

function splitId(id: string): {
	vendor: string;
	slug: string;
	eq: string | null;
} {
	const vendor = id.split(":")[0] ?? "";
	const rest = id.slice(vendor.length).replace(/^:+/, "");
	const parts = rest.split("::").filter((p) => p !== "");
	return { vendor, slug: parts[0] ?? "", eq: parts[1] ?? null };
}

/** True when the record's credits trigger the Rtings exclusion. */
export function isRtingsLinked(author: string, details: string): boolean {
	return author === "Rtings/AutoEQ" || details.toLowerCase().includes("rtings");
}

function productSlug(opraProductId: string): string {
	return splitId(opraProductId).slug;
}

export const ACQUIRED_AT = 1789344000000; // 2026-09-14 UTC, snapshot fetch date

function emptyStats(): OpraBulkStats {
	return {
		vendors: 0,
		products: 0,
		eqInspected: 0,
		malformedLines: 0,
		rejectedRtings: 0,
		rejectedMalformed: 0,
		rejectedUnknownSubtype: 0,
		rejectedDangling: 0,
		importedDevices: 0,
		importedPresets: 0,
		mergedIntoSeed: 0,
		bandOutliers: 0,
		valueAnomalies: 0,
	};
}

/**
 * Ingest a frozen OPRA dist JSONL snapshot.
 *
 * @param text snapshot bytes as text
 * @param seedIdentityToId normalized "manufacturer--model" identity → real
 *   catalog device id, for products already present: matching products
 *   merge (presets attach, metadata untouched) instead of duplicating.
 */
export function ingestOpraSnapshot(
	text: string,
	seedIdentityToId: Map<string, string>,
): OpraBulkResult {
	const stats = emptyStats();
	const review: string[] = [];
	const devices: CatalogDevice[] = [];
	const presets: CatalogPreset[] = [];
	const vendorNames = new Map<string, string>();
	const products = new Map<string, JsonlProduct>();
	// Seed ids are reserved: a generated stable id that collides with a
	// hand-reviewed seed id (same slug, different upstream naming, e.g.
	// "AirPods Pro 2" vs "AirPods Pro (2nd generation)") must never
	// silently duplicate it — disambiguate + flag for review, never merge
	// (uncertain duplicates are never merged) and never overwrite.
	const seedIds = new Set<string>(seedIdentityToId.values());
	const seenDeviceIds = new Set<string>(seedIds);
	const lines = text.split("\n");

	const records: Record<string, unknown>[] = [];
	for (const line of lines) {
		if (line.trim() === "") continue;
		try {
			const record: unknown = JSON.parse(line);
			if (typeof record !== "object" || record === null) {
				stats.malformedLines += 1;
				continue;
			}
			records.push(record as Record<string, unknown>);
		} catch {
			stats.malformedLines += 1;
		}
	}

	// Pass 1: vendors (products reference display names).
	for (const rec of records) {
		if (rec["type"] !== "vendor" || typeof rec["id"] !== "string") continue;
		const data = rec["data"];
		const name =
			typeof data === "object" &&
			data !== null &&
			typeof (data as Record<string, unknown>)["name"] === "string"
				? ((data as Record<string, unknown>)["name"] as string)
				: (rec["id"] as string);
		vendorNames.set(rec["id"] as string, name);
	}

	// Pass 2: products → devices (seed overlap merges, never overwrites).
	const deviceByOpraId = new Map<string, string>();
	const productOrder: string[] = [];
	for (const rec of records) {
		if (rec["type"] !== "product" || typeof rec["id"] !== "string") {
			continue;
		}
		const opraId = rec["id"] as string;
		const data = (rec["data"] as Record<string, unknown>) ?? {};
		const { vendor, slug } = splitId(opraId);
		const vendorName = vendorNames.get(vendor) ?? vendor;
		const name = typeof data["name"] === "string" ? data["name"] : slug;
		const subtype = typeof data["subtype"] === "string" ? data["subtype"] : "";
		productOrder.push(opraId);
		products.set(opraId, {
			id: opraId,
			name,
			subtype,
			vendorDir: vendor,
			vendorName,
		});
	}
	stats.vendors = vendorNames.size;
	stats.products = products.size;
	productOrder.sort((a, b) => a.localeCompare(b));

	for (const opraId of productOrder) {
		const product = products.get(opraId);
		if (!product) continue;
		const mapped = OPRA_SUBTYPE_MAP[product.subtype];
		if (!mapped) {
			stats.rejectedUnknownSubtype += 1;
			review.push(`unmapped subtype for ${opraId}: kept out, needs review`);
			continue;
		}
		const identity = normalizeIdentity(product.vendorName, product.name);
		const seedId = seedIdentityToId.get(identity);
		if (seedId !== undefined) {
			stats.mergedIntoSeed += 1;
			deviceByOpraId.set(opraId, seedId);
			continue;
		}
		// Upstream duplicate vendor directories (e.g. plunge vs
		// plunge_audio) can yield identical normalized ids for distinct
		// source records: never merge, never drop — disambiguate
		// deterministically and flag for review.
		let id = stableDeviceId(product.vendorName, product.name);
		if (seenDeviceIds.has(id)) {
			let n = 2;
			while (seenDeviceIds.has(`${id}-${n}`)) n += 1;
			review.push(
				seedIds.has(id)
					? `device id ${id} for ${opraId} collides with a hand-reviewed seed id: kept separate as ${id}-${n} (naming overlap, needs review)`
					: `duplicate device id for ${opraId}: kept separate as ${id}-${n} (likely upstream duplicate directories)`,
			);
			id = `${id}-${n}`;
		}
		seenDeviceIds.add(id);
		deviceByOpraId.set(opraId, id);
		devices.push({
			id,
			manufacturer: product.vendorName,
			model: product.name,
			aliases: [],
			deviceType: mapped,
			driver: { configuration: null, connectivity: null },
			provenance: {
				source: "OPRA",
				sourceType: "community",
				sourceUrl: `https://github.com/opra-project/OPRA/tree/main/database/vendors/${product.vendorDir}/products/${productSlug(opraId)}`,
				attribution:
					"Product identity via OPRA (facts only; no measurement data bundled)",
				license: OPRA_LICENSE,
				redistribution: "metadata-only",
				shareAlike: false,
				importedAt: ACQUIRED_AT,
			},
			releaseYear: null,
			notes: null,
			presetIds: [],
			measurementRefs: [],
		});
		stats.importedDevices += 1;
	}

	// Pass 3: eq entries → presets (deterministic id order).
	const eqEntries: { id: string; data: unknown }[] = [];
	for (const rec of records) {
		if (rec["type"] === "eq" && typeof rec["id"] === "string") {
			eqEntries.push({ id: rec["id"] as string, data: rec["data"] });
		}
	}
	eqEntries.sort((a, b) => a.id.localeCompare(b.id));
	stats.eqInspected = eqEntries.length;
	const seenPresetIds = new Set<string>();
	for (const entry of eqEntries) {
		const { vendor, slug, eq } = splitId(entry.id);
		const data =
			typeof entry.data === "object" && entry.data !== null
				? (entry.data as Record<string, unknown>)
				: {};
		const author = typeof data["author"] === "string" ? data["author"] : "";
		const details = typeof data["details"] === "string" ? data["details"] : "";
		if (isRtingsLinked(author, details)) {
			stats.rejectedRtings += 1;
			continue;
		}
		// Resolve the product linkage deterministically.
		const productKey = [...products.keys()].find((pid) => {
			const p = splitId(pid);
			return p.vendor === vendor && p.slug === slug && eq !== null;
		});
		if (!productKey || !deviceByOpraId.has(productKey)) {
			stats.rejectedDangling += 1;
			review.push(`dangling eq ${entry.id}: no device kept, rejected`);
			continue;
		}
		try {
			const { preset } = adaptOpraPreset(vendor, slug, eq ?? "eq", entry.data);
			const target = deviceByOpraId.get(productKey);
			if (!target) {
				stats.rejectedDangling += 1;
				review.push(`dangling eq ${entry.id}: seed target unresolvable`);
				continue;
			}
			preset.deviceId = target;
			if (seenPresetIds.has(preset.id)) {
				let n = 2;
				while (seenPresetIds.has(`${preset.id}-${n}`)) n += 1;
				review.push(
					`duplicate preset id for ${entry.id}: kept separate as ${preset.id}-${n} (likely upstream duplicate directories)`,
				);
				preset.id = `${preset.id}-${n}`;
			}
			seenPresetIds.add(preset.id);
			if (preset.peq.bands.length > 12) {
				stats.bandOutliers += 1;
				review.push(
					`${preset.id}: ${preset.peq.bands.length} bands exceed the 12-band editor (kept whole; UI truncates per OPRA schema guidance)`,
				);
			}
			for (const b of preset.peq.bands) {
				if (b.frequency < 10 || b.frequency > 24000 || b.q < 0.1 || b.q > 10) {
					stats.valueAnomalies += 1;
					review.push(
						`${preset.id}: out-of-range band f=${b.frequency} q=${b.q} kept as-is (downstream clamps; never silently repaired)`,
					);
					break;
				}
			}
			presets.push(preset);
			stats.importedPresets += 1;
		} catch (error) {
			stats.rejectedMalformed += 1;
			review.push(
				`malformed eq ${entry.id}: ${error instanceof OpraAdapterError ? error.message : "unknown error"}`,
			);
		}
	}

	return { devices, presets, review, stats };
}
