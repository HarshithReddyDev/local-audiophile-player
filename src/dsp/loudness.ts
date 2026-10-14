/**
 * Relative listening-level compensation ("equal loudness", approximate).
 *
 * Honesty contract (see docs; UI repeats it): human hearing gets bass-shy
 * (and mildly treble-shy) at low listening levels. This module applies a
 * gentle, capped low-shelf lift plus a small high-shelf lift that fades to
 * exactly zero at the reference level. It is NOT an ISO 226 contour: we
 * ship no licensed reference data, and browser volume is not calibrated
 * SPL, so no absolute claim is possible. Shape: monotonic in the level
 * deficit, neutral at/above reference, hard-capped.
 */

export interface LoudnessParams {
	enabled: boolean;
	/**
	 * Relative listening level in dB (UI slider, e.g. −40…0 where 0 is
	 * "as loud as the reference"). NOT dB SPL — the control says so.
	 */
	listeningLevelDb: number;
}

export const LOUDNESS_DEFAULTS: LoudnessParams = {
	enabled: false,
	listeningLevelDb: -20,
};

/** Reference: compensation is exactly zero here. */
export const LOUDNESS_REFERENCE_DB = 0;

export const LOUDNESS_LIMITS = {
	listeningLevelDb: { min: -40, max: 0 },
	/** Hard caps so the effect can never shout. */
	bassBoostDb: 8,
	trebleBoostDb: 3,
} as const;

export interface LoudnessCompensation {
	/** Low-shelf lift dB at 90 Hz. */
	bassDb: number;
	/** High-shelf lift dB at 10 kHz. */
	trebleDb: number;
}

export function sanitizeLoudness(raw: LoudnessParams): LoudnessParams {
	const level = Number.isFinite(raw.listeningLevelDb)
		? Math.min(
				LOUDNESS_LIMITS.listeningLevelDb.max,
				Math.max(LOUDNESS_LIMITS.listeningLevelDb.min, raw.listeningLevelDb),
			)
		: LOUDNESS_DEFAULTS.listeningLevelDb;
	return { enabled: raw.enabled === true, listeningLevelDb: level };
}

/**
 * Compensation for a listening level. deficit = reference − level (≥ 0);
 * bass grows ~0.25 dB per dB of deficit, treble ~0.08 dB per dB, both
 * capped. Zero deficit → exactly zero (verified).
 */
export function loudnessCompensation(
	params: LoudnessParams,
): LoudnessCompensation {
	const p = sanitizeLoudness(params);
	if (!p.enabled) return { bassDb: 0, trebleDb: 0 };
	const deficit = Math.max(0, LOUDNESS_REFERENCE_DB - p.listeningLevelDb);
	return {
		bassDb: Math.min(LOUDNESS_LIMITS.bassBoostDb, deficit * 0.25),
		trebleDb: Math.min(LOUDNESS_LIMITS.trebleBoostDb, deficit * 0.08),
	};
}

/** Compensation as shelf stages for the shared response engine. */
export function toLoudnessBands(params: LoudnessParams): {
	type: "lowshelf" | "highshelf";
	frequency: number;
	gain: number;
	q: number;
	enabled: boolean;
}[] {
	const comp = loudnessCompensation(params);
	const out: {
		type: "lowshelf" | "highshelf";
		frequency: number;
		gain: number;
		q: number;
		enabled: boolean;
	}[] = [];
	if (comp.bassDb > 0) {
		out.push({
			type: "lowshelf",
			frequency: 90,
			gain: comp.bassDb,
			q: 0.71,
			enabled: true,
		});
	}
	if (comp.trebleDb > 0) {
		out.push({
			type: "highshelf",
			frequency: 10000,
			gain: comp.trebleDb,
			q: 0.71,
			enabled: true,
		});
	}
	return out;
}
