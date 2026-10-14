/**
 * Deterministic ingestion pipeline: external source records → normalized
 * → validated → deduped → license-gated → cross-referenced → catalog data
 * + human-readable quality report.
 *
 * Rules: never merge uncertain duplicates (keep separate + flag); never
 * silently drop (every rejection carries a reason); third-party origins
 * without redistribution rights are rejected at the gate, not cleaned.
 * All functions are pure; generation output is byte-stable for byte-identical
 * input (tested).
 */

import { parseProfile } from "../dsp/types";
import { bundlingVerdict, findSource } from "./sources";
import type {
	CatalogDevice,
	CatalogPreset,
	DeviceCatalog,
	DeviceType,
	PresetOrigin,
	Redistribution,
	SourceProvenance,
} from "./types";
import { DEVICE_TYPE_IDS } from "./types";
import { isPermittedUrl, validateCatalog } from "./validate";

export const MAX_INGEST_RECORDS = 50000;
export const MAX_STRING_FIELD = 500;

export interface IngestRejection {
	index: number;
	reason: string;
}

export interface DuplicateCandidate {
	identity: string;
	keptId: string;
	otherIndex: number;
}

export interface IngestReport {
	totalInput: number;
	devices: number;
	presets: number;
	byCategory: Record<string, number>;
	manufacturers: number;
	externalMeasurements: number;
	sources: string[];
	fullRedistribution: number;
	metadataOnly: number;
	duplicates: DuplicateCandidate[];
	rejected: IngestRejection[];
	needsReview: string[];
	/** Gate conditions that apply when anything was admitted. */
	gateConditions: string[];
}

/**
 * Source-level legal gate for a batch: every declared source id must
 * carry a bundling verdict of allowed. Unknown ids fail closed.
 */
export function gateSources(sourceIds: string[]): {
	allowed: boolean;
	reasons: string[];
	conditions: string[];
} {
	const reasons: string[] = [];
	const conditions: string[] = [];
	if (sourceIds.length === 0) {
		reasons.push("no source declared: bundling requires an approved source id");
		return { allowed: false, reasons, conditions };
	}
	for (const id of sourceIds) {
		const source = findSource(id);
		if (!source) {
			reasons.push(`unknown source id ${id}: fail closed`);
			continue;
		}
		const verdict = bundlingVerdict(source);
		if (!verdict.allowed) reasons.push(...verdict.reasons);
		else conditions.push(...verdict.conditions);
	}
	return { allowed: reasons.length === 0, reasons, conditions };
}

/** Canonical identity: normalized make + model. Exact match only. */
export function normalizeIdentity(manufacturer: string, model: string): string {
	const norm = (s: string): string =>
		s
			.normalize("NFKD")
			.replaceAll(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replaceAll(/[^a-z0-9]+/g, "-")
			.replaceAll(/^-+|-+$/g, "");
	return `${norm(manufacturer)}--${norm(model)}`;
}

/** Deterministic generated id from identity (stable across refreshes). */
export function stableDeviceId(manufacturer: string, model: string): string {
	const id = normalizeIdentity(manufacturer, model).replaceAll("--", "-");
	return id === "-" || id === "" ? "unknown-device" : id;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cleanString(v: unknown, max = MAX_STRING_FIELD): string | null {
	if (typeof v !== "string") return null;
	const t = v.trim();
	if (t === "" || t.length > max) return null;
	return t;
}

function cleanNullableString(v: unknown): string | null {
	if (v === undefined || v === null) return null;
	if (typeof v !== "string") return null;
	const t = v.trim();
	return t === "" || t.length > MAX_STRING_FIELD ? null : t;
}

const PRESET_ORIGINS: PresetOrigin[] = [
	"manufacturer",
	"measurement-derived",
	"autoeq",
	"community",
	"manual",
	"tutorial",
];

function cleanProvenance(
	v: unknown,
	where: string,
): { provenance: SourceProvenance | null; error: string | null } {
	if (!isRecord(v))
		return {
			provenance: null,
			error: `${where}: provenance must be an object`,
		};
	const source = cleanString(v["source"]);
	const sourceUrl =
		typeof v["sourceUrl"] === "string" ? v["sourceUrl"].trim() : null;
	const attribution = cleanString(v["attribution"]);
	const license = cleanString(v["license"]);
	const redistribution = v["redistribution"];
	if (!source) return { provenance: null, error: `${where}: source required` };
	if (sourceUrl === null || (!isPermittedUrl(sourceUrl) && sourceUrl !== "")) {
		return { provenance: null, error: `${where}: sourceUrl must be http(s)` };
	}
	if (!attribution)
		return { provenance: null, error: `${where}: attribution required` };
	if (!license)
		return { provenance: null, error: `${where}: license required` };
	if (
		redistribution !== "none" &&
		redistribution !== "metadata-only" &&
		redistribution !== "full"
	) {
		return { provenance: null, error: `${where}: bad redistribution value` };
	}
	return {
		provenance: {
			source,
			sourceType:
				v["sourceType"] === "manufacturer" ||
				v["sourceType"] === "community" ||
				v["sourceType"] === "in-repo" ||
				v["sourceType"] === "user"
					? v["sourceType"]
					: "community",
			sourceUrl,
			attribution,
			license,
			redistribution: redistribution as Redistribution,
			importedAt:
				typeof v["importedAt"] === "number" ? v["importedAt"] : Date.now(),
		},
		error: null,
	};
}

export interface IngestedBatch {
	devices: CatalogDevice[];
	presets: CatalogPreset[];
	rejected: IngestRejection[];
	duplicates: DuplicateCandidate[];
	/** Source-gate outcome for this batch (empty sourceIds = ungated). */
	gate: { allowed: boolean; reasons: string[]; conditions: string[] };
}

/**
 * Ingest one source file's records (already JSON-parsed). Accepts
 * `{devices: [...], presets: [...]}` or a bare array of device records.
 * Deterministic: output order follows input order; ids derive from identity.
 */
export function ingestRecords(
	raw: unknown,
	now = Date.now(),
	opts: { sourceIds?: string[] } = {},
): IngestedBatch {
	const devices: CatalogDevice[] = [];
	const presets: CatalogPreset[] = [];
	const rejected: IngestRejection[] = [];
	const duplicates: DuplicateCandidate[] = [];
	const seen = new Map<string, string>();
	const gate =
		opts.sourceIds !== undefined
			? gateSources(opts.sourceIds)
			: { allowed: true, reasons: [], conditions: [] };
	const denied = (reason: string): IngestedBatch => ({
		devices: [],
		presets: [],
		rejected: [{ index: -1, reason }],
		duplicates: [],
		gate,
	});
	// Source-level legal gate runs before any record is admitted.
	if (!gate.allowed) {
		return {
			devices: [],
			presets: [],
			rejected: gate.reasons.map((reason) => ({ index: -1, reason })),
			duplicates: [],
			gate,
		};
	}

	const pushDevice = (item: unknown, index: number): void => {
		if (!isRecord(item)) {
			rejected.push({ index, reason: "device record must be an object" });
			return;
		}
		const manufacturer = cleanString(item["manufacturer"]);
		const model = cleanString(item["model"]);
		if (!manufacturer || !model) {
			rejected.push({ index, reason: "manufacturer/model required" });
			return;
		}
		const deviceType: DeviceType = DEVICE_TYPE_IDS.includes(
			item["deviceType"] as DeviceType,
		)
			? (item["deviceType"] as DeviceType)
			: "other";
		const { provenance, error } = cleanProvenance(
			item["provenance"],
			`device ${index}`,
		);
		if (!provenance || error) {
			rejected.push({ index, reason: error ?? "bad provenance" });
			return;
		}
		const identity = normalizeIdentity(manufacturer, model);
		const prior = seen.get(identity);
		const id =
			typeof item["id"] === "string" && item["id"].trim() !== ""
				? item["id"].trim().slice(0, 120)
				: stableDeviceId(manufacturer, model);
		if (prior !== undefined) {
			// Uncertain duplicates are NEVER merged: keep separate + flag.
			duplicates.push({ identity, keptId: prior, otherIndex: index });
		} else {
			seen.set(identity, id);
		}
		const aliases = Array.isArray(item["aliases"])
			? item["aliases"]
					.filter((a): a is string => typeof a === "string")
					.slice(0, 20)
			: [];
		const driver = isRecord(item["driver"]) ? item["driver"] : {};
		devices.push({
			id,
			manufacturer,
			model,
			aliases,
			deviceType,
			driver: {
				configuration: cleanNullableString(driver["configuration"]),
				connectivity: cleanNullableString(driver["connectivity"]),
			},
			provenance: { ...provenance, importedAt: now },
			releaseYear:
				typeof item["releaseYear"] === "number" &&
				Number.isInteger(item["releaseYear"]) &&
				item["releaseYear"] >= 1970 &&
				item["releaseYear"] <= 2100
					? item["releaseYear"]
					: null,
			notes: cleanNullableString(item["notes"]),
			presetIds: [],
			measurementRefs: [],
		});
	};

	const pushPreset = (item: unknown, index: number): void => {
		if (!isRecord(item)) {
			rejected.push({ index, reason: "preset record must be an object" });
			return;
		}
		const name = cleanString(item["name"]);
		if (!name) {
			rejected.push({ index, reason: "preset name required" });
			return;
		}
		if (parseProfile(item["peq"]) === null) {
			rejected.push({ index, reason: "preset peq malformed" });
			return;
		}
		const origin: PresetOrigin = PRESET_ORIGINS.includes(
			item["origin"] as PresetOrigin,
		)
			? (item["origin"] as PresetOrigin)
			: "manual";
		const { provenance, error } = cleanProvenance(
			item["provenance"],
			`preset ${index}`,
		);
		if (!provenance || error) {
			rejected.push({ index, reason: error ?? "bad provenance" });
			return;
		}
		// LICENSE GATE: third-party origins need redistribution rights.
		if (
			(origin === "manufacturer" ||
				origin === "measurement-derived" ||
				origin === "community") &&
			provenance.redistribution !== "full"
		) {
			rejected.push({
				index,
				reason: `origin ${origin} requires redistribution "full"`,
			});
			return;
		}
		presets.push({
			id:
				typeof item["id"] === "string" && item["id"].trim() !== ""
					? item["id"].trim().slice(0, 120)
					: `preset-${presets.length}`,
			name,
			deviceId:
				typeof item["deviceId"] === "string" && item["deviceId"].trim() !== ""
					? item["deviceId"].trim().slice(0, 120)
					: null,
			origin,
			peq: item["peq"] as CatalogPreset["peq"],
			measurementRef: cleanNullableString(item["measurementRef"]),
			targetRef: cleanNullableString(item["targetRef"]),
			provenance: { ...provenance, importedAt: now },
			createdAt:
				typeof item["createdAt"] === "number" ? item["createdAt"] : now,
		});
	};

	let deviceItems: unknown[] = [];
	let presetItems: unknown[] = [];
	if (Array.isArray(raw)) {
		deviceItems = raw;
	} else if (isRecord(raw)) {
		if (raw["devices"] !== undefined) {
			if (!Array.isArray(raw["devices"])) {
				return denied('"devices" must be an array');
			}
			deviceItems = raw["devices"];
		}
		if (raw["presets"] !== undefined) {
			if (!Array.isArray(raw["presets"])) {
				return denied('"presets" must be an array');
			}
			presetItems = raw["presets"];
		}
		if (deviceItems.length === 0 && presetItems.length === 0) {
			return denied("no devices or presets found");
		}
	} else {
		return denied("top level must be an object or array");
	}
	if (deviceItems.length + presetItems.length > MAX_INGEST_RECORDS) {
		return denied(`payload exceeds ${MAX_INGEST_RECORDS} records (DoS guard)`);
	}
	deviceItems.forEach((item, i) => pushDevice(item, i));
	presetItems.forEach((item, i) => pushPreset(item, i));
	return { devices, presets, rejected, duplicates, gate };
}

export interface GeneratedCatalog {
	catalog: DeviceCatalog;
	report: IngestReport;
	/** validateCatalog problems on the merged result (must be empty). */
	problems: string[];
}

/**
 * Merge ingested batches onto a base catalog: cross-reference preset
 * deviceIds (dropped with reason when dangling), sort deterministically,
 * validate the merge, and build the quality report.
 */
export function buildCatalogData(
	base: DeviceCatalog,
	batches: IngestedBatch[],
	now = Date.now(),
): GeneratedCatalog {
	void now;
	const devices = [...base.devices];
	const presets = [...base.presets];
	const rejected: IngestRejection[] = [];
	const duplicates: DuplicateCandidate[] = [];
	const deviceIds = new Set(devices.map((d) => d.id));
	for (const batch of batches) {
		for (const d of batch.devices) {
			if (deviceIds.has(d.id)) {
				duplicates.push({
					identity: `${d.manufacturer} ${d.model}`,
					keptId: d.id,
					otherIndex: -1,
				});
				continue;
			}
			deviceIds.add(d.id);
			devices.push(d);
		}
		rejected.push(...batch.rejected);
		duplicates.push(...batch.duplicates);
	}
	const presetIds = new Set(presets.map((p) => p.id));
	for (const batch of batches) {
		for (const p of batch.presets) {
			if (presetIds.has(p.id)) {
				rejected.push({ index: -1, reason: `duplicate preset id ${p.id}` });
				continue;
			}
			if (p.deviceId !== null && !deviceIds.has(p.deviceId)) {
				rejected.push({
					index: -1,
					reason: `preset ${p.id}: unknown deviceId ${p.deviceId}`,
				});
				continue;
			}
			presetIds.add(p.id);
			presets.push(p);
		}
	}
	devices.sort((a, b) => a.id.localeCompare(b.id));
	presets.sort((a, b) => a.id.localeCompare(b.id));
	const catalog: DeviceCatalog = { version: base.version, devices, presets };
	const problems = validateCatalog(catalog);
	const byCategory: Record<string, number> = {};
	for (const d of devices)
		byCategory[d.deviceType] = (byCategory[d.deviceType] ?? 0) + 1;
	const sources = [
		...new Set([
			...devices.map((d) => d.provenance.source),
			...presets.map((p) => p.provenance.source),
		]),
	].sort();
	const needsReview = [
		...duplicates.map(
			(d) => `duplicate candidate: ${d.identity} (kept ${d.keptId})`,
		),
		...rejected.map((r) => `rejected #${r.index}: ${r.reason}`),
		...problems.map((p) => `validation: ${p}`),
	];
	const gateConditions = [
		...new Set(batches.flatMap((b) => b.gate.conditions)),
	];
	return {
		catalog,
		problems,
		report: {
			totalInput: batches.reduce(
				(n, b) => n + b.devices.length + b.presets.length + b.rejected.length,
				0,
			),
			devices: devices.length,
			presets: presets.length,
			byCategory,
			manufacturers: new Set(devices.map((d) => d.manufacturer)).size,
			externalMeasurements: devices.reduce(
				(n, d) => n + d.measurementRefs.length,
				0,
			),
			sources,
			fullRedistribution: presets.filter(
				(p) => p.provenance.redistribution === "full",
			).length,
			metadataOnly: devices.filter(
				(d) => d.provenance.redistribution === "metadata-only",
			).length,
			duplicates,
			rejected,
			needsReview,
			gateConditions,
		},
	};
}
