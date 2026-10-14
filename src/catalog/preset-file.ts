/**
 * Portable preset file format: one JSON document per preset for
 * export/import. Uses the SAME normalized SerializedPEQ as manual EQ —
 * no second schema. Malformed input fails safe with a reason, never a
 * partial preset.
 */

import type { PresetOrigin } from "../catalog/types";
import type { SerializedPEQ } from "../dsp/types";
import { parseProfile } from "../dsp/types";

export const PRESET_FILE_VERSION = 1;

export interface PresetFile {
	schemaVersion: 1;
	kind: "iem-player-preset";
	name: string;
	deviceName: string | null;
	origin: PresetOrigin | "user";
	attribution: string | null;
	peq: SerializedPEQ;
	exportedAt: number;
}

export class PresetFileError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PresetFileError";
	}
}

export function exportPresetFile(args: {
	name: string;
	deviceName?: string;
	origin?: PresetOrigin | "user";
	attribution?: string;
	peq: SerializedPEQ;
	exportedAt?: number;
}): string {
	return (
		JSON.stringify({
			schemaVersion: PRESET_FILE_VERSION,
			kind: "iem-player-preset",
			name: args.name,
			deviceName: args.deviceName ?? null,
			origin: args.origin ?? "user",
			attribution: args.attribution ?? null,
			peq: args.peq,
			exportedAt: args.exportedAt ?? Date.now(),
		} satisfies PresetFile) + "\n"
	);
}

/** Parse and validate; throws PresetFileError with a human reason. */
export function importPresetFile(text: string): PresetFile {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new PresetFileError("Not valid JSON.");
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new PresetFileError("Preset file must be a JSON object.");
	}
	const v = raw as Record<string, unknown>;
	if (v["kind"] !== "iem-player-preset") {
		throw new PresetFileError("Not an IEM Player preset file.");
	}
	if (v["schemaVersion"] !== PRESET_FILE_VERSION) {
		throw new PresetFileError(
			`Unsupported preset version ${JSON.stringify(v["schemaVersion"])}.`,
		);
	}
	if (typeof v["name"] !== "string" || v["name"].trim() === "") {
		throw new PresetFileError("Preset is missing a name.");
	}
	if (parseProfile(v["peq"]) === null) {
		throw new PresetFileError("Preset EQ data is malformed.");
	}
	return {
		schemaVersion: 1,
		kind: "iem-player-preset",
		name: (v["name"] as string).trim(),
		deviceName: typeof v["deviceName"] === "string" ? v["deviceName"] : null,
		origin:
			typeof v["origin"] === "string"
				? (v["origin"] as PresetFile["origin"])
				: "user",
		attribution: typeof v["attribution"] === "string" ? v["attribution"] : null,
		peq: v["peq"] as SerializedPEQ,
		exportedAt: typeof v["exportedAt"] === "number" ? v["exportedAt"] : 0,
	};
}
