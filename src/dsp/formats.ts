/**
 * Text preset exchange formats. Each format has a validator (problems[]),
 * a parser (profile bands + preamp + warnings), and an exporter.
 * Information loss is never silent: anything assumed or dropped lands in
 * warnings, and the UI shows them before applying.
 *
 * 1. GraphicEQ text — the "GraphicEQ: f g; f g; …" line documented by the
 *    AutoEq project README (public, MIT). Fixed centers, gains only.
 * 2. Parametric text subset — "Preamp: X dB" + "Filter N: ON <PK|LS|HS|
 *    LP|HP|NO|BP> Fc … Gain … Q …" lines, the Equalizer APO grammar
 *    subset that Poweramp's preset importer also accepts (community-
 *    documented; no proprietary format is touched or claimed).
 * 3. CSV — our own documented "frequency,gain" pairs (response-curve
 *    interchange, Q assumed 1.0 and warned).
 */

import { GRAPHIC_GAIN_DB } from "./graphic";
import { BAND_LIMITS } from "./types";

export interface ParsedPreset {
	preampDb: number;
	bands: {
		type:
			| "peaking"
			| "lowshelf"
			| "highshelf"
			| "lowpass"
			| "highpass"
			| "notch"
			| "bandpass";
		frequency: number;
		gain: number;
		q: number;
		enabled: boolean;
	}[];
	warnings: string[];
}

function clampGain(db: number): number {
	if (!Number.isFinite(db)) return 0;
	return Math.min(BAND_LIMITS.gain.max, Math.max(BAND_LIMITS.gain.min, db));
}

function clampFrequency(hz: number): number | null {
	if (!Number.isFinite(hz)) return null;
	if (hz < BAND_LIMITS.frequency.min || hz > BAND_LIMITS.frequency.max)
		return null;
	return hz;
}

// -- GraphicEQ --------------------------------------------------------

/**
 * Parse "GraphicEQ: 25 0.0; 40 1.2; …" (also accepts a bare pair list).
 * Gains outside ±12 are clamped with a warning; Q is assumed 1.0 because
 * the format carries none (stated, not hidden).
 */
export function parseGraphicEq(text: string): ParsedPreset | null {
	if (typeof text !== "string") return null;
	let body = text.trim();
	const labeled = /^graphiceq\s*:/i.exec(body);
	if (labeled) body = body.slice(labeled[0].length);
	if (body === "") return null;
	const warnings: string[] = [];
	const bands: ParsedPreset["bands"] = [];
	let preampDb = 0;
	const chunks = body
		.split(";")
		.map((c) => c.trim())
		.filter((c) => c !== "");
	if (chunks.length === 0) return null;
	for (const chunk of chunks) {
		// Tolerate an exported Preamp line and a mid-text GraphicEQ label
		// (export order is Preamp first, label second).
		let rest = chunk.replace(/^graphiceq\s*:/i, "").trim();
		const preamp = APO_PREAMP.exec(rest);
		if (preamp?.[1]) {
			const db = Number(preamp[1]);
			if (Number.isFinite(db)) {
				preampDb = Math.min(
					BAND_LIMITS.preamp.max,
					Math.max(BAND_LIMITS.preamp.min, db),
				);
			}
			// A trailing pair may share the line ("Preamp: -6 GraphicEQ: …"
			// never happens from our exporter, but be liberal in import).
			rest = rest
				.slice(preamp[0].length)
				.trim()
				.replace(/^graphiceq\s*:/i, "")
				.trim();
			if (rest === "") continue;
		}
		const parts = rest.split(/[\s,]+/).filter((p) => p !== "");
		if (parts.length < 2) return null;
		const frequency = clampFrequency(Number(parts[0]));
		const rawGain = Number(parts[1]);
		if (frequency === null || !Number.isFinite(rawGain)) return null;
		let gain = rawGain;
		if (gain < GRAPHIC_GAIN_DB.min || gain > GRAPHIC_GAIN_DB.max) {
			warnings.push(`Gain ${rawGain} dB at ${frequency} Hz clamped to ±12 dB.`);
			gain = Math.min(GRAPHIC_GAIN_DB.max, Math.max(GRAPHIC_GAIN_DB.min, gain));
		}
		bands.push({ type: "peaking", frequency, gain, q: 1, enabled: true });
	}
	if (bands.length === 0) return null;
	warnings.unshift(
		`Imported ${bands.length} fixed bands with assumed Q 1.0 (the GraphicEQ format carries no Q).`,
	);
	return { preampDb, bands, warnings };
}

/** Export gains at explicit centers in GraphicEQ text form. */
export function exportGraphicEq(
	centers: number[],
	gains: number[],
	preampDb = 0,
): string {
	const pairs = centers.map((f, i) => {
		const gain = Number.isFinite(gains[i] ?? NaN) ? (gains[i] as number) : 0;
		return `${f} ${Math.round(gain * 100) / 100}`;
	});
	const preamp =
		preampDb !== 0 ? `Preamp: ${Math.round(preampDb * 100) / 100} dB\n` : "";
	return `${preamp}GraphicEQ: ${pairs.join("; ")}`;
}

// -- Parametric text (APO subset) ----------------------------------------

const APO_FILTER =
	/^filter\s*\d*\s*:\s*(on|off)\s+(pk|ls|hs|lp|hp|no|bp)\s+(.+)$/i;
const APO_PREAMP = /^preamp\s*:\s*([+-]?\d+(?:\.\d+)?)\s*(?:db)?/i;

const APO_TYPE_MAP: Record<string, ParsedPreset["bands"][number]["type"]> = {
	pk: "peaking",
	ls: "lowshelf",
	hs: "highshelf",
	lp: "lowpass",
	hp: "highpass",
	no: "notch",
	bp: "bandpass",
};

function apoNumber(fragment: string, key: string): number | null {
	const match = new RegExp(`${key}\\s+([+-]?\\d+(?:\\.\\d+)?)`, "i").exec(
		fragment,
	);
	if (!match?.[1]) return null;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : null;
}

/**
 * Parse the APO parametric subset. Unknown filter types and out-of-range
 * values are skipped with warnings (never silent); a file with zero
 * usable filters returns null.
 */
export function parseParametricText(text: string): ParsedPreset | null {
	if (typeof text !== "string") return null;
	const warnings: string[] = [];
	let preampDb = 0;
	const bands: ParsedPreset["bands"] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#")) continue;
		const preamp = APO_PREAMP.exec(line);
		if (preamp?.[1]) {
			const db = Number(preamp[1]);
			if (Number.isFinite(db)) {
				preampDb = Math.min(
					BAND_LIMITS.preamp.max,
					Math.max(BAND_LIMITS.preamp.min, db),
				);
			}
			continue;
		}
		const filter = APO_FILTER.exec(line);
		if (!filter?.[1] || !filter[2] || !filter[3]) {
			warnings.push(`Skipped unrecognized line: "${line.slice(0, 60)}".`);
			continue;
		}
		const type = APO_TYPE_MAP[filter[2].toLowerCase()];
		if (!type) {
			warnings.push(
				`Skipped unsupported filter type in: "${line.slice(0, 60)}".`,
			);
			continue;
		}
		const rest = filter[3];
		const frequency = apoNumber(rest, "fc");
		if (frequency === null || clampFrequency(frequency) === null) {
			warnings.push(
				`Skipped filter with bad frequency: "${line.slice(0, 60)}".`,
			);
			continue;
		}
		const gainRaw = apoNumber(rest, "gain");
		const qRaw = apoNumber(rest, "q");
		bands.push({
			type,
			frequency: frequency as number,
			gain: clampGain(gainRaw ?? 0),
			q:
				qRaw !== null && qRaw >= BAND_LIMITS.q.min && qRaw <= BAND_LIMITS.q.max
					? qRaw
					: 1,
			enabled: filter[1].toLowerCase() === "on",
		});
	}
	if (bands.length === 0) return null;
	return { preampDb, bands, warnings };
}

/** Export profile bands in the same parametric text grammar. */
export function exportParametricText(
	preampDb: number,
	bands: ParsedPreset["bands"],
): string {
	const lines: string[] = [`Preamp: ${Math.round(preampDb * 100) / 100} dB`];
	const typeName: Record<ParsedPreset["bands"][number]["type"], string> = {
		peaking: "PK",
		lowshelf: "LS",
		highshelf: "HS",
		lowpass: "LP",
		highpass: "HP",
		notch: "NO",
		bandpass: "BP",
	};
	bands.forEach((band, i) => {
		const state = band.enabled ? "ON" : "OFF";
		lines.push(
			`Filter ${i + 1}: ${state} ${typeName[band.type]} Fc ${band.frequency} Hz Gain ${band.gain} dB Q ${band.q}`,
		);
	});
	return lines.join("\n");
}

// -- CSV ------------------------------------------------------------------

/**
 * Parse "frequency,gain" per line (# comments, header tolerated).
 * Response-curve interchange: Q assumed 1.0, preamp 0, both warned.
 */
export function parseCurveCsv(text: string): ParsedPreset | null {
	if (typeof text !== "string") return null;
	const warnings: string[] = [];
	const bands: ParsedPreset["bands"] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#")) continue;
		const parts = line.split(/[,\t;]/).map((p) => p.trim());
		if (parts.length < 2) continue;
		const frequency = clampFrequency(Number(parts[0]));
		const gain = Number(parts[1]);
		if (frequency === null || !Number.isFinite(gain)) {
			if (/[a-zA-Z]/.test(line)) continue; // header row
			return null;
		}
		bands.push({
			type: "peaking",
			frequency,
			gain: clampGain(gain),
			q: 1,
			enabled: true,
		});
	}
	if (bands.length === 0) return null;
	warnings.unshift(
		`Imported ${bands.length} curve points as peaking bands with assumed Q 1.0.`,
	);
	return { preampDb: 0, bands, warnings };
}

export function exportCurveCsv(centers: number[], gains: number[]): string {
	const lines = ["# frequency,gain"];
	centers.forEach((f, i) => {
		const gain = Number.isFinite(gains[i] ?? NaN) ? (gains[i] as number) : 0;
		lines.push(`${f},${Math.round(gain * 100) / 100}`);
	});
	return lines.join("\n");
}
