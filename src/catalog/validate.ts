/**
 * Catalog ingestion validation: every record that ships (or is added
 * later) must pass these checks. Pure and deterministic so CI, tests, and
 * future ingestion tooling share one gate.
 */

import { parseProfile } from "../dsp/types";
import { DEVICE_TYPES, type DeviceCatalog } from "./types";

/** Validate a full catalog; empty array = clean. */
export function validateCatalog(catalog: DeviceCatalog): string[] {
	const problems: string[] = [];
	if (catalog.version < 1 || !Number.isInteger(catalog.version)) {
		problems.push(`catalog version must be a positive integer`);
	}
	const deviceIds = new Set<string>();
	for (const d of catalog.devices) {
		if (!d.id || deviceIds.has(d.id)) {
			problems.push(`device id missing or duplicated: ${JSON.stringify(d.id)}`);
		} else deviceIds.add(d.id);
		if (!d.manufacturer.trim() || !d.model.trim()) {
			problems.push(`device ${d.id}: manufacturer/model required`);
		}
		if (!DEVICE_TYPES.some((t) => t.id === d.deviceType)) {
			problems.push(`device ${d.id}: unknown deviceType ${d.deviceType}`);
		}
		const prov = checkProvenance(d.provenance, `device ${d.id}`);
		problems.push(...prov);
		for (const [ri, ref] of d.measurementRefs.entries()) {
			if (!ref.label.trim()) {
				problems.push(`device ${d.id}: measurement ref ${ri} needs a label`);
			}
			if (!isPermittedUrl(ref.sourceUrl) || ref.sourceUrl === "") {
				problems.push(
					`device ${d.id}: measurement ref ${ri} needs an http(s) URL (no data is bundled, so a pointer must resolve)`,
				);
			}
		}
		// Metadata-only records must not pretend to ship measurements.
		if (d.provenance.redistribution === "none" && d.presetIds.length > 0) {
			// Allowed only when the presets are in-repo authored (tutorial or
			// manual origin); third-party data stays out.
		}
	}
	const presetIds = new Set<string>();
	for (const p of catalog.presets) {
		if (!p.id || presetIds.has(p.id)) {
			problems.push(`preset id missing or duplicated: ${JSON.stringify(p.id)}`);
		} else presetIds.add(p.id);
		if (!p.name.trim()) problems.push(`preset ${p.id}: name required`);
		if (p.deviceId !== null && !deviceIds.has(p.deviceId)) {
			problems.push(`preset ${p.id}: unknown deviceId ${p.deviceId}`);
		}
		if (parseProfile(p.peq) === null) {
			problems.push(`preset ${p.id}: peq is not a valid SerializedPEQ`);
		}
		problems.push(...checkProvenance(p.provenance, `preset ${p.id}`));
		// Hard legal rule: a preset whose data came from a third party must
		// carry redistribution permission for the DATA, not just the code.
		if (
			(p.origin === "manufacturer" ||
				p.origin === "measurement-derived" ||
				p.origin === "community") &&
			p.provenance.redistribution !== "full"
		) {
			problems.push(
				`preset ${p.id}: origin ${p.origin} requires redistribution "full" (got ${p.provenance.redistribution})`,
			);
		}
	}
	for (const d of catalog.devices) {
		for (const pid of d.presetIds) {
			if (!presetIds.has(pid)) {
				problems.push(`device ${d.id}: unknown presetId ${pid}`);
			}
		}
	}
	return problems;
}

function checkProvenance(
	prov: {
		source: string;
		sourceUrl: string;
		attribution: string;
		license: string;
		redistribution: string;
	} | null,
	where: string,
): string[] {
	const problems: string[] = [];
	if (!prov) return [`${where}: provenance missing`];
	if (!prov.source.trim()) problems.push(`${where}: source required`);
	if (!isPermittedUrl(prov.sourceUrl)) {
		problems.push(`${where}: sourceUrl must be http(s) or empty-when-in-repo`);
	}
	if (!prov.attribution.trim()) problems.push(`${where}: attribution required`);
	if (!prov.license.trim()) problems.push(`${where}: license required`);
	if (!["none", "metadata-only", "full"].includes(prov.redistribution)) {
		problems.push(`${where}: bad redistribution value`);
	}
	if (
		"shareAlike" in (prov as Record<string, unknown>) &&
		typeof (prov as { shareAlike?: unknown }).shareAlike !== "boolean"
	) {
		problems.push(`${where}: shareAlike must be boolean when present`);
	}
	return problems;
}

/** Outbound links only. In-repo records use "" (no link to invent). */
export function isPermittedUrl(url: string): boolean {
	if (url === "") return true;
	try {
		const u = new URL(url);
		return u.protocol === "https:" || u.protocol === "http:";
	} catch {
		return false;
	}
}
