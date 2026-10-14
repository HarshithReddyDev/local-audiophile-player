/**
 * Device catalog domain: known public audio-device information.
 *
 * A catalog device is NOT user state — it is static, versioned, canonical
 * data describing a public product plus pointers to where measurements and
 * presets can legitimately be obtained. Users copy what they need into
 * their own local IEM profiles / EQ presets; the copy is independent.
 *
 * Legal posture: code license != data license. No scraped measurement
 * database is bundled. Entries are either metadata-only (facts + outbound
 * links) or presets authored in-repo from synthetic curves. Every record
 * carries machine-readable provenance — see docs/device-catalog.md.
 */

import type { SerializedPEQ } from "../dsp/types";

export const CATALOG_VERSION = 1;

/** Broad wearable-audio categories. Generic union, not a conditional. */
export type DeviceType =
	| "iem"
	| "earbuds"
	| "tws"
	| "headphones-open"
	| "headphones-closed"
	| "headphones-planar"
	| "headphones"
	| "headset"
	| "studio"
	| "other";

export const DEVICE_TYPES: { id: DeviceType; label: string }[] = [
	{ id: "iem", label: "IEMs" },
	{ id: "earbuds", label: "Earbuds" },
	{ id: "tws", label: "TWS / wireless earbuds" },
	{ id: "headphones-open", label: "Open-back headphones" },
	{ id: "headphones-closed", label: "Closed-back headphones" },
	{ id: "headphones-planar", label: "Planar headphones" },
	{
		id: "headphones",
		label: "Headphones (type unspecified)",
	},
	{ id: "headset", label: "Gaming / office headsets" },
	{ id: "studio", label: "Studio / monitoring" },
	{ id: "other", label: "Other wearables" },
];

/** Plain id list for validation (DEVICE_TYPES carries labels). */
export const DEVICE_TYPE_IDS: DeviceType[] = DEVICE_TYPES.map((t) => t.id);

/** Where a preset/measurement pointer came from. Never mislabel origin. */
export type PresetOrigin =
	| "manufacturer"
	| "measurement-derived"
	| "autoeq"
	| "community"
	| "manual"
	| "tutorial";

export type Redistribution = "none" | "metadata-only" | "full";

export interface SourceProvenance {
	/** Human-readable source name, e.g. "Manufacturer product page". */
	source: string;
	/** Kind of source: official maker, community database, in-repo authoring… */
	sourceType: "manufacturer" | "community" | "in-repo" | "user";
	/** Outbound link only — never fetched automatically. */
	sourceUrl: string;
	attribution: string;
	/** SPDX id where known, else a plain-language rights statement. */
	license: string;
	/** What, if anything, of this record may be redistributed. */
	redistribution: Redistribution;
	/**
	 * True when a ShareAlike condition travels with this record (e.g. OPRA
	 * CC BY-SA data): adapted datasets must carry the same license +
	 * notice. Code stays separately licensed. Absent = false.
	 */
	shareAlike?: boolean;
	/** Unix ms when the record entered the catalog. Null for static seeds. */
	importedAt: number | null;
}

export interface DriverInfo {
	/** e.g. "1DD", "1DD+4BA", "planar magnetic", or null when unknown. */
	configuration: string | null;
	/** e.g. "wired 3.5mm", "Bluetooth 5.3 + ANC". Null when unknown. */
	connectivity: string | null;
}

/**
 * Pointer to an EXTERNAL measurement (never bundled data). Non-empty means
 * "measurements are known to exist out there" — the user imports their own
 * copy if legally permitted. No implication that any one is "correct".
 */
export interface MeasurementRef {
	/** e.g. "oratory1990 (Reddit index)", "Manufacturer whitepaper". */
	label: string;
	sourceUrl: string;
	/** e.g. "left", "right", "average". Null when unknown. */
	channel: string | null;
	note: string | null;
}

export interface CatalogDevice {
	id: string;
	manufacturer: string;
	model: string;
	/** Alternate names/spellings users search for. */
	aliases: string[];
	deviceType: DeviceType;
	driver: DriverInfo;
	provenance: SourceProvenance;
	releaseYear: number | null;
	notes: string | null;
	/** Ids of CatalogPreset records shipped for this device (often empty). */
	presetIds: string[];
	/**
	 * External measurement pointers (D-class sources). Empty when no
	 * per-device link is verified — the common, honest case.
	 */
	measurementRefs: MeasurementRef[];
}

export interface CatalogPreset {
	id: string;
	name: string;
	/** Device this preset was built for; null for generic tutorials. */
	deviceId: string | null;
	origin: PresetOrigin;
	/** PEQ payload in the SAME normalized format manual EQ uses. */
	peq: SerializedPEQ;
	/** Which measurement/target produced it, as display text (no data). */
	measurementRef: string | null;
	targetRef: string | null;
	provenance: SourceProvenance;
	createdAt: number;
}

export interface DeviceCatalog {
	version: number;
	devices: CatalogDevice[];
	presets: CatalogPreset[];
}
