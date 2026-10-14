/**
 * Dynamics parameters: validated plain data for the native
 * DynamicsCompressorNode. The compression curve itself is implemented by
 * the browser node (documented Web Audio behavior), so this module owns
 * validation, defaults, and the gain-staging math around it — plus a
 * software envelope model used only for offline prediction/plots, never
 * presented as the node's exact curve.
 */

export interface CompressorParams {
	enabled: boolean;
	/** dBFS knee start, −60…0. */
	thresholdDb: number;
	/** Static slope above threshold, 1…20. */
	ratio: number;
	/** Knee width dB, 0…40. */
	kneeDb: number;
	/** Seconds, 0.001…1. */
	attackSec: number;
	/** Seconds, 0.01…2. */
	releaseSec: number;
	/** Manual output trim dB, 0…24. */
	makeupDb: number;
}

export const COMPRESSOR_DEFAULTS: CompressorParams = {
	enabled: false,
	thresholdDb: -18,
	ratio: 3,
	kneeDb: 6,
	attackSec: 0.01,
	releaseSec: 0.2,
	makeupDb: 0,
};

export const COMPRESSOR_LIMITS = {
	thresholdDb: { min: -60, max: 0 },
	ratio: { min: 1, max: 20 },
	kneeDb: { min: 0, max: 40 },
	attackSec: { min: 0.001, max: 1 },
	releaseSec: { min: 0.01, max: 2 },
	makeupDb: { min: 0, max: 24 },
} as const;

function clamp(
	value: number,
	min: number,
	max: number,
	fallback: number,
): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

export function sanitizeCompressor(raw: CompressorParams): CompressorParams {
	return {
		enabled: raw.enabled === true,
		thresholdDb: clamp(
			raw.thresholdDb,
			COMPRESSOR_LIMITS.thresholdDb.min,
			COMPRESSOR_LIMITS.thresholdDb.max,
			COMPRESSOR_DEFAULTS.thresholdDb,
		),
		ratio: clamp(
			raw.ratio,
			COMPRESSOR_LIMITS.ratio.min,
			COMPRESSOR_LIMITS.ratio.max,
			COMPRESSOR_DEFAULTS.ratio,
		),
		kneeDb: clamp(
			raw.kneeDb,
			COMPRESSOR_LIMITS.kneeDb.min,
			COMPRESSOR_LIMITS.kneeDb.max,
			COMPRESSOR_DEFAULTS.kneeDb,
		),
		attackSec: clamp(
			raw.attackSec,
			COMPRESSOR_LIMITS.attackSec.min,
			COMPRESSOR_LIMITS.attackSec.max,
			COMPRESSOR_DEFAULTS.attackSec,
		),
		releaseSec: clamp(
			raw.releaseSec,
			COMPRESSOR_LIMITS.releaseSec.min,
			COMPRESSOR_LIMITS.releaseSec.max,
			COMPRESSOR_DEFAULTS.releaseSec,
		),
		makeupDb: clamp(
			raw.makeupDb,
			COMPRESSOR_LIMITS.makeupDb.min,
			COMPRESSOR_LIMITS.makeupDb.max,
			COMPRESSOR_DEFAULTS.makeupDb,
		),
	};
}

/**
 * Static compression curve (hard-knee core with linear knee blend):
 * output dB for a steady-state input level. This predicts the browser
 * node's ballistics-free behavior for plots and warnings — the node adds
 * attack/release smoothing on top. Unity at/below threshold − knee/2.
 */
export function staticCurveDb(
	params: CompressorParams,
	inputDb: number,
): number {
	const p = sanitizeCompressor(params);
	const t = p.thresholdDb;
	const r = Math.max(1, p.ratio);
	const knee = Math.max(0, p.kneeDb);
	if (!(inputDb > t - knee / 2)) return inputDb;
	if (knee === 0 || inputDb >= t + knee / 2) return t + (inputDb - t) / r;
	// Inside the knee: blend between slope 1 and slope 1/r.
	const x = (inputDb - (t - knee / 2)) / knee;
	const slope = 1 + (1 / r - 1) * x;
	return t - knee / 2 + (inputDb - (t - knee / 2)) * slope;
}

/** Steady-state gain reduction in dB (≥ 0) for a constant input level. */
export function gainReductionDb(
	params: CompressorParams,
	inputDb: number,
): number {
	const p = sanitizeCompressor(params);
	if (!p.enabled) return 0;
	return Math.max(0, inputDb - staticCurveDb(p, inputDb));
}

/**
 * Suggested makeup to restore the level of a sustained input back toward
 * unity (capped at the makeup range). Advisory only — the control stays
 * manual so the user owns the final gain staging.
 */
export function suggestedMakeupDb(
	params: CompressorParams,
	inputDb: number,
): number {
	const gr = gainReductionDb(params, inputDb);
	return Math.min(COMPRESSOR_LIMITS.makeupDb.max, Math.max(0, gr));
}
