/**
 * Optional measurement smoothing (Phase 8D): fractional-octave moving
 * average in log-frequency space. Pure, deterministic, dependency-free.
 *
 * Pipeline position: raw measurement → smooth (here) → fitMeasurement →
 * target → compensation → AutoEQ. The RAW curve is never modified: this
 * module only derives new curves. The target is never smoothed (it is an
 * intentional reference). Nothing here runs inside the optimizer loop.
 *
 * Method (see docs/autoeq-smoothing.md §research): for each output point,
 * average the log-interpolated measurement over ±window/2 octaves
 * (boxcar in log space — REW-style fractional-octave smoothing, same
 * family as upstream AutoEq's octave-window `smoothen`). A convex
 * combination cannot overshoot: output stays within the input's local
 * range by construction. Edges renormalize over available data (clipped
 * window, never extrapolated, range never extended).
 */

import { interpolateLog, type ResponseCurve } from "./curves";

export type SmoothingPresetId = "off" | "light" | "moderate";

export interface SmoothingPreset {
	id: SmoothingPresetId;
	label: string;
	description: string;
	/** Total averaging window in octaves (0 = off). */
	windowOctaves: number;
}

/**
 * Preset parameters. Widths chosen by benchmark on the validation corpus
 * (see docs/autoeq-smoothing.md §presets): Light tames point-to-point
 * noise while leaving a Q4 resonance nearly intact; Moderate trades more
 * narrow-feature attenuation for stronger noise suppression. Both are
 * far below one octave, so broad musical features pass through.
 */
export const SMOOTHING_PRESETS: SmoothingPreset[] = [
	{
		id: "off",
		label: "Off",
		description: "Fit the measurement as imported. Reference behavior.",
		windowOctaves: 0,
	},
	{
		id: "light",
		label: "Light",
		description:
			"Gentle averaging over a twelfth of an octave. Tames small fluctuations; keeps narrow features.",
		windowOctaves: 1 / 12,
	},
	{
		id: "moderate",
		label: "Moderate",
		description:
			"Averaging over a sixth of an octave. Stronger noise suppression; can soften legitimate narrow features.",
		windowOctaves: 1 / 6,
	},
];

/** Map a preset id to its window width (unknown ids → off). */
export function resolveSmoothingWindow(preset: SmoothingPresetId): number {
	return SMOOTHING_PRESETS.find((p) => p.id === preset)?.windowOctaves ?? 0;
}

export class SmoothingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SmoothingError";
	}
}

/** Sub-samples per averaging window (fixed → deterministic). */
const WINDOW_SAMPLES = 32;

/** Default output grid density (uniform log spacing over valid range). */
const DEFAULT_GRID_POINTS = 256;

function isUsablePoint(frequency: number, gain: number): boolean {
	return Number.isFinite(frequency) && Number.isFinite(gain) && frequency > 0;
}

/**
 * Derive a smoothed curve from a raw measurement. Never mutates input.
 * Output is a uniform log grid over the input's valid range (interpolate-
 * then-smooth: resampling first makes behavior density-independent, so
 * sparse and dense rigs get the same treatment — benchmarked §17).
 *
 * windowOctaves <= 0 returns an exact copy (the Off path stays
 * mathematically identical to unsmoothed fitting).
 */
export function smoothResponseCurve(
	curve: ResponseCurve,
	windowOctaves: number,
	gridPoints = DEFAULT_GRID_POINTS,
): ResponseCurve {
	const frequencies: number[] = [];
	const gains: number[] = [];
	for (let i = 0; i < curve.frequencies.length; i++) {
		const f = curve.frequencies[i] ?? NaN;
		const g = curve.gains[i] ?? NaN;
		if (isUsablePoint(f, g)) {
			frequencies.push(f);
			gains.push(g);
		}
	}
	if (frequencies.length < 2) {
		throw new SmoothingError(
			"Not enough measurement points: need at least 2 finite frequency/gain pairs.",
		);
	}
	const clean: ResponseCurve = { frequencies, gains };
	const fMin = frequencies[0] ?? 20;
	const fMax = frequencies[frequencies.length - 1] ?? 20000;

	if (!(windowOctaves > 0)) {
		return { frequencies: [...frequencies], gains: [...gains] };
	}

	const count = Math.max(8, Math.floor(gridPoints));
	const halfWindow = windowOctaves / 2;
	const lo = Math.log10(fMin);
	const hi = Math.log10(fMax);
	const outFreqs: number[] = [];
	const outGains: number[] = [];
	for (let i = 0; i < count; i++) {
		const f = 10 ** (lo + ((hi - lo) * i) / (count - 1));
		// Window clipped to measured data (renormalize, never extrapolate).
		const wLo = Math.max(fMin, f * 2 ** -halfWindow);
		const wHi = Math.min(fMax, f * 2 ** halfWindow);
		const wLogLo = Math.log10(wLo);
		const wLogHi = Math.log10(wHi);
		let sum = 0;
		for (let k = 0; k < WINDOW_SAMPLES; k++) {
			const x = 10 ** (wLogLo + ((wLogHi - wLogLo) * k) / (WINDOW_SAMPLES - 1));
			sum += interpolateLog(clean, x) ?? 0;
		}
		outFreqs.push(f);
		outGains.push(sum / WINDOW_SAMPLES);
	}
	return { frequencies: outFreqs, gains: outGains };
}

/** Convenience: smooth by preset id (off → exact copy). */
export function smoothByPreset(
	curve: ResponseCurve,
	preset: SmoothingPresetId,
	gridPoints = DEFAULT_GRID_POINTS,
): ResponseCurve {
	return smoothResponseCurve(curve, resolveSmoothingWindow(preset), gridPoints);
}

export interface SmoothingDeviation {
	/** RMS difference between raw-interpolated and smoothed gains. */
	rmsDb: number;
	/** Maximum absolute raw-vs-smoothed difference. */
	maxAbsDb: number;
}

/**
 * Engineering deviation between a raw curve and its smoothed derivative,
 * evaluated on the smoothed grid (same support → apples-to-apples).
 * Descriptive only — never presented as perceptual truth.
 */
export function smoothingDeviation(
	raw: ResponseCurve,
	smoothed: ResponseCurve,
): SmoothingDeviation {
	const n = smoothed.frequencies.length;
	let sum = 0;
	let maxAbs = 0;
	let count = 0;
	for (let i = 0; i < n; i++) {
		const f = smoothed.frequencies[i] ?? NaN;
		if (!Number.isFinite(f) || f <= 0) continue;
		const r = interpolateLog(raw, f);
		const s = smoothed.gains[i] ?? NaN;
		if (r === null || !Number.isFinite(s)) continue;
		const d = s - r;
		sum += d * d;
		if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
		count += 1;
	}
	return {
		rmsDb: count > 0 ? Math.sqrt(sum / count) : 0,
		maxAbsDb: maxAbs,
	};
}

/** Count local extrema (both peaks and dips) above a noise floor. */
export function countExtrema(gains: ArrayLike<number>, floorDb = 0.05): number {
	const n = gains.length;
	let count = 0;
	for (let i = 1; i < n - 1; i++) {
		const prev = (gains[i - 1] ?? 0) - (gains[i] ?? 0);
		const next = (gains[i + 1] ?? 0) - (gains[i] ?? 0);
		if (
			prev * next > 0 &&
			Math.max(Math.abs(prev), Math.abs(next)) >= floorDb
		) {
			count += 1;
		}
	}
	return count;
}
