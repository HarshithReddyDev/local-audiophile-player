/**
 * Pure catalog queries: lookup, search (incl. aliases), and filtering.
 * Operates on small metadata records only — measurement arrays are never
 * loaded for browsing. Deterministic; safe to call during render.
 */

import type {
	CatalogDevice,
	CatalogPreset,
	DeviceCatalog,
	DeviceType,
} from "./types";

export interface CatalogFilter {
	query: string;
	deviceType: DeviceType | "all";
	manufacturer: string | "all";
	/** Only devices that ship bundled presets. */
	hasEq: boolean;
	/** Only devices with verified external measurement pointers. */
	hasMeasurements: boolean;
	/** Only records from one provenance source. */
	source: string | "all";
}

export const EMPTY_FILTER: CatalogFilter = {
	query: "",
	deviceType: "all",
	manufacturer: "all",
	hasEq: false,
	hasMeasurements: false,
	source: "all",
};

function norm(text: string): string {
	return text
		.normalize("NFKD")
		.replaceAll(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();
}

/** Distinct provenance sources present, sorted. */
export function catalogSources(catalog: DeviceCatalog): string[] {
	return [
		...new Set([
			...catalog.devices.map((d) => d.provenance.source),
			...catalog.presets.map((p) => p.provenance.source),
		]),
	].sort();
}

/** Manufacturers present in the catalog, sorted. */
export function catalogManufacturers(catalog: DeviceCatalog): string[] {
	return [...new Set(catalog.devices.map((d) => d.manufacturer))].sort();
}

export function getDevice(
	catalog: DeviceCatalog,
	id: string,
): CatalogDevice | null {
	return catalog.devices.find((d) => d.id === id) ?? null;
}

export type DeviceSortKey = "name" | "manufacturer" | "category" | "eq";

/**
 * Number of bundled presets per device id, derived from the same scan
 * `devicePresets` uses (deviceId linkage + legacy presetIds). The bulk
 * OPRA layer attaches presets via deviceId without editing canonical
 * seed records, so `device.presetIds.length` alone undercounts — this
 * map is the source of truth for counts, filtering, and sorting.
 */
export function buildDevicePresetCounts(
	catalog: DeviceCatalog,
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const p of catalog.presets) {
		if (p.deviceId === null) continue;
		counts.set(p.deviceId, (counts.get(p.deviceId) ?? 0) + 1);
	}
	// Legacy presetIds linkage (seed-era): count ids not already covered
	// by the deviceId scan so older records keep their EQ status.
	const byPresetId = new Map<string, string>();
	for (const p of catalog.presets) byPresetId.set(p.id, p.deviceId ?? "");
	for (const d of catalog.devices) {
		let extra = 0;
		for (const pid of d.presetIds) {
			if (byPresetId.has(pid) && byPresetId.get(pid) === d.id) continue;
			if (!byPresetId.has(pid)) extra += 1;
		}
		if (extra > 0) counts.set(d.id, (counts.get(d.id) ?? 0) + extra);
	}
	return counts;
}

/** Preset provenance sources per device id (for source filtering). */
export function buildDevicePresetSources(
	catalog: DeviceCatalog,
): Map<string, Set<string>> {
	const map = new Map<string, Set<string>>();
	for (const p of catalog.presets) {
		if (p.deviceId === null) continue;
		let set = map.get(p.deviceId);
		if (!set) {
			set = new Set();
			map.set(p.deviceId, set);
		}
		set.add(p.provenance.source);
	}
	return map;
}

/** Deterministic ordering for the browser (default: name). */
export function sortDevices(
	devices: CatalogDevice[],
	sort: DeviceSortKey,
	presetCounts?: ReadonlyMap<string, number>,
): CatalogDevice[] {
	return [...devices].sort((a, b) => {
		switch (sort) {
			case "manufacturer":
				return (
					a.manufacturer.localeCompare(b.manufacturer) ||
					a.model.localeCompare(b.model)
				);
			case "category":
				return (
					a.deviceType.localeCompare(b.deviceType) ||
					a.manufacturer.localeCompare(b.manufacturer) ||
					a.model.localeCompare(b.model)
				);
			case "eq":
				return (
					Number((presetCounts?.get(b.id) ?? b.presetIds.length) > 0) -
						Number((presetCounts?.get(a.id) ?? a.presetIds.length) > 0) ||
					(presetCounts?.get(b.id) ?? b.presetIds.length) -
						(presetCounts?.get(a.id) ?? a.presetIds.length) ||
					a.manufacturer.localeCompare(b.manufacturer) ||
					a.model.localeCompare(b.model)
				);
			case "name":
			default:
				return `${a.manufacturer} ${a.model}`.localeCompare(
					`${b.manufacturer} ${b.model}`,
				);
		}
	});
}

/**
 * Presets for a device: every preset whose deviceId points at it.
 * Scanned (not just device.presetIds) so generated-layer presets attach
 * without editing canonical seed records.
 */
export function devicePresets(
	catalog: DeviceCatalog,
	deviceId: string,
): CatalogPreset[] {
	const device = getDevice(catalog, deviceId);
	if (!device) return [];
	const wanted = new Set(device.presetIds);
	return catalog.presets.filter(
		(p) => p.deviceId === deviceId || wanted.has(p.id),
	);
}

export function searchDevices(
	catalog: DeviceCatalog,
	filter: CatalogFilter,
): CatalogDevice[] {
	const q = norm(filter.query);
	// Derived once per search: bulk OPRA presets attach via deviceId scan,
	// so EQ availability and preset-source matching must use the same scan
	// (device.presetIds alone undercounts generated-layer presets).
	const needCounts = filter.hasEq || filter.source !== "all";
	const counts = needCounts ? buildDevicePresetCounts(catalog) : null;
	const presetSources =
		filter.source !== "all" ? buildDevicePresetSources(catalog) : null;
	return catalog.devices
		.filter((d) => {
			if (filter.deviceType !== "all" && d.deviceType !== filter.deviceType)
				return false;
			if (
				filter.manufacturer !== "all" &&
				d.manufacturer !== filter.manufacturer
			)
				return false;
			if (filter.hasEq) {
				const n = (counts as Map<string, number>).get(d.id) ?? 0;
				if (!(d.presetIds.length > 0 || n > 0)) return false;
			}
			if (filter.hasMeasurements && d.measurementRefs.length === 0)
				return false;
			if (filter.source !== "all") {
				if (d.provenance.source === filter.source) {
					// Device-level match: keep.
				} else {
					// Also match devices whose bundled presets come from the
					// source (e.g. seed HD 600 with OPRA presets).
					const sources = (presetSources as Map<string, Set<string>>).get(d.id);
					if (!sources || !sources.has(filter.source)) return false;
				}
			}
			if (q === "") return true;
			const hay = [d.manufacturer, d.model, ...d.aliases].map(norm).join(" ");
			return q.split(/\s+/).every((token) => hay.includes(token));
		})
		.sort(
			(a, b) =>
				a.manufacturer.localeCompare(b.manufacturer) ||
				a.model.localeCompare(b.model),
		);
}
