/**
 * DSP domain model. Pure data + validation — no browser APIs, no React,
 * no store. This exact shape is the future AutoEQ contract: an optimizer
 * will return PEQProfile, and the engine consumes it unchanged.
 */

export type FilterType =
	| "peaking"
	| "lowshelf"
	| "highshelf"
	| "lowpass"
	| "highpass"
	| "notch"
	| "bandpass";

export const FILTER_TYPES: FilterType[] = [
	"peaking",
	"lowshelf",
	"highshelf",
	"lowpass",
	"highpass",
	"notch",
	"bandpass",
];

/** Gain-bearing types (Web Audio semantics: gain ignored otherwise). */
export function usesGain(type: FilterType): boolean {
	return type === "peaking" || type === "lowshelf" || type === "highshelf";
}

export interface EQBand {
	/** Stable client id (not persisted as identity — position matters). */
	id: string;
	type: FilterType;
	/** Hz, (0, Nyquist). */
	frequency: number;
	/** dB, meaningful only when usesGain(type). */
	gain: number;
	/** Q factor. Shelves use fixed slope (Q ignored, like the node). */
	q: number;
	enabled: boolean;
}

export interface PEQProfile {
	/** dB, applied before the bands. Distinct from master volume. */
	preamp: number;
	bands: EQBand[];
	enabled: boolean;
}

/**
 * Normalized biquad coefficients (a0 = 1 implied):
 * y[n] = b0·x[n] + b1·x[n-1] + b2·x[n-2] − a1·y[n-1] − a2·y[n-2]
 */
export interface BiquadCoefficients {
	b0: number;
	b1: number;
	b2: number;
	a1: number;
	a2: number;
}

export const UNITY_BIQUAD: BiquadCoefficients = {
	b0: 1,
	b1: 0,
	b2: 0,
	a1: 0,
	a2: 0,
};

export const BAND_LIMITS = {
	frequency: { min: 10, max: 24000 },
	gain: { min: -24, max: 24 },
	q: { min: 0.025, max: 40 },
	preamp: { min: -24, max: 24 },
	sampleRate: { min: 8000, max: 768000 },
} as const;

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/** Human-readable validation problems; empty means usable. */
export function validateBand(band: EQBand, sampleRate: number): string[] {
	const problems: string[] = [];
	if (!FILTER_TYPES.includes(band.type))
		problems.push(`unknown type ${String(band.type)}`);
	if (!isFiniteNumber(band.frequency))
		problems.push("frequency must be finite");
	else {
		if (band.frequency < BAND_LIMITS.frequency.min)
			problems.push(`frequency below ${BAND_LIMITS.frequency.min} Hz`);
		if (band.frequency > BAND_LIMITS.frequency.max)
			problems.push(`frequency above ${BAND_LIMITS.frequency.max} Hz`);
		if (isFiniteNumber(sampleRate) && band.frequency >= sampleRate / 2)
			problems.push("frequency must be below Nyquist");
	}
	if (usesGain(band.type)) {
		if (!isFiniteNumber(band.gain)) problems.push("gain must be finite");
		else if (
			band.gain < BAND_LIMITS.gain.min ||
			band.gain > BAND_LIMITS.gain.max
		)
			problems.push(
				`gain outside ${BAND_LIMITS.gain.min}…${BAND_LIMITS.gain.max} dB`,
			);
	}
	if (!isFiniteNumber(band.q)) problems.push("Q must be finite");
	else if (band.q < BAND_LIMITS.q.min || band.q > BAND_LIMITS.q.max)
		problems.push(`Q outside ${BAND_LIMITS.q.min}…${BAND_LIMITS.q.max}`);
	if (!isFiniteNumber(sampleRate)) problems.push("sample rate must be finite");
	else if (
		sampleRate < BAND_LIMITS.sampleRate.min ||
		sampleRate > BAND_LIMITS.sampleRate.max
	)
		problems.push("sample rate outside 8 kHz…768 kHz");
	return problems;
}

/** Poles inside the unit circle (normalized triangle stability test). */
export function isStable(c: BiquadCoefficients): boolean {
	if (
		!isFiniteNumber(c.b0) ||
		!isFiniteNumber(c.b1) ||
		!isFiniteNumber(c.b2) ||
		!isFiniteNumber(c.a1) ||
		!isFiniteNumber(c.a2)
	)
		return false;
	return Math.abs(c.a2) < 1 && Math.abs(c.a1) < 1 + c.a2;
}

let bandCounter = 0;

/** Client-side band id (array position is the source of truth, not this). */
export function newBandId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `band-${crypto.randomUUID().slice(0, 8)}`;
	}
	bandCounter += 1;
	return `band-${Date.now().toString(36)}-${bandCounter}`;
}

export function defaultBand(type: FilterType = "peaking"): EQBand {
	return {
		id: newBandId(),
		type,
		frequency: 1000,
		gain: 0,
		q: 1,
		enabled: true,
	};
}

export function defaultProfile(): PEQProfile {
	return { preamp: 0, bands: [], enabled: false };
}

// -- serialization (persisted format; coefficients never persisted) --------

export interface SerializedPEQ {
	version: 1;
	preamp: number;
	enabled: boolean;
	bands: {
		type: FilterType;
		frequency: number;
		gain: number;
		q: number;
		enabled: boolean;
	}[];
}

export function serializeProfile(profile: PEQProfile): SerializedPEQ {
	return {
		version: 1,
		preamp: profile.preamp,
		enabled: profile.enabled,
		bands: profile.bands.map((b) => ({
			type: b.type,
			frequency: b.frequency,
			gain: b.gain,
			q: b.q,
			enabled: b.enabled,
		})),
	};
}

export function parseProfile(raw: unknown): PEQProfile | null {
	if (typeof raw !== "object" || raw === null) return null;
	const v = raw as Record<string, unknown>;
	if (v["version"] !== 1) return null;
	if (!isFiniteNumber(v["preamp"])) return null;
	if (typeof v["enabled"] !== "boolean") return null;
	if (!Array.isArray(v["bands"])) return null;
	const bands: EQBand[] = [];
	for (const item of v["bands"]) {
		if (typeof item !== "object" || item === null) return null;
		const b = item as Record<string, unknown>;
		if (!FILTER_TYPES.includes(b["type"] as FilterType)) return null;
		if (
			!isFiniteNumber(b["frequency"]) ||
			!isFiniteNumber(b["gain"]) ||
			!isFiniteNumber(b["q"]) ||
			typeof b["enabled"] !== "boolean"
		)
			return null;
		bands.push({
			id: newBandId(),
			type: b["type"] as FilterType,
			frequency: b["frequency"] as number,
			gain: b["gain"] as number,
			q: b["q"] as number,
			enabled: b["enabled"] as boolean,
		});
	}
	return {
		preamp: v["preamp"] as number,
		enabled: v["enabled"] as boolean,
		bands,
	};
}
