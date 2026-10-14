/**
 * Shared response-curve foundation for measurements and targets.
 * Plain arrays, Hz + dB, sorted ascending. No browser APIs.
 */

export type CurveChannel = "left" | "right" | "average" | "unknown";

export interface ResponseCurve {
	frequencies: number[];
	gains: number[];
}

export interface CurveStats {
	points: number;
	minFrequency: number;
	maxFrequency: number;
	minGain: number;
	maxGain: number;
}

export const CURVE_LIMITS = {
	minFrequency: 1,
	maxFrequency: 100000,
	minGainDb: -120,
	maxGainDb: 120,
	minPoints: 3,
	maxPoints: 100000,
} as const;

/** Descriptive statistics; null when the curve has no usable range. */
export function curveStats(curve: ResponseCurve): CurveStats | null {
	const { frequencies, gains } = curve;
	if (frequencies.length === 0 || frequencies.length !== gains.length)
		return null;
	let minF = Infinity;
	let maxF = -Infinity;
	let minG = Infinity;
	let maxG = -Infinity;
	for (let i = 0; i < frequencies.length; i++) {
		const f = frequencies[i] ?? NaN;
		const g = gains[i] ?? NaN;
		if (!Number.isFinite(f) || !Number.isFinite(g)) return null;
		if (f < minF) minF = f;
		if (f > maxF) maxF = f;
		if (g < minG) minG = g;
		if (g > maxG) maxG = g;
	}
	return {
		points: frequencies.length,
		minFrequency: minF,
		maxFrequency: maxF,
		minGain: minG,
		maxGain: maxG,
	};
}

/**
 * Normalize raw parsed points: drop non-finite/non-positive rows, sort by
 * frequency, average exact duplicates. Returns reasons when rejecting.
 * Never smooths — raw data is preserved bit-for-bit otherwise.
 */
export function normalizeCurve(
	frequencies: number[],
	gains: number[],
): { curve: ResponseCurve } | { error: string } {
	if (frequencies.length !== gains.length) {
		return {
			error: `mismatched columns: ${frequencies.length} frequencies vs ${gains.length} gains`,
		};
	}
	const buckets = new Map<number, { sum: number; count: number }>();
	for (let i = 0; i < frequencies.length; i++) {
		const f = frequencies[i] ?? NaN;
		const g = gains[i] ?? NaN;
		if (!Number.isFinite(f) || !Number.isFinite(g)) continue;
		if (f <= 0) continue;
		const slot = buckets.get(f);
		if (slot) {
			slot.sum += g;
			slot.count += 1;
		} else {
			buckets.set(f, { sum: g, count: 1 });
		}
	}
	const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
	if (sorted.length < CURVE_LIMITS.minPoints) {
		return {
			error: `only ${sorted.length} usable points (minimum ${CURVE_LIMITS.minPoints})`,
		};
	}
	if (sorted.length > CURVE_LIMITS.maxPoints) {
		return {
			error: `too many points (${sorted.length}, maximum ${CURVE_LIMITS.maxPoints})`,
		};
	}
	const out: ResponseCurve = { frequencies: [], gains: [] };
	for (const [f, slot] of sorted) {
		out.frequencies.push(f);
		out.gains.push(slot.sum / slot.count);
	}
	return { curve: out };
}

/**
 * Validate a normalized curve against physical sanity bounds. Narrow
 * resonances and sparse data are legitimate — only impossible values fail.
 */
export function validateCurve(curve: ResponseCurve): string[] {
	const problems: string[] = [];
	const stats = curveStats(curve);
	if (!stats) {
		return ["curve is empty or contains non-finite values"];
	}
	if (stats.minFrequency < CURVE_LIMITS.minFrequency) {
		problems.push(
			`frequency ${stats.minFrequency} Hz below ${CURVE_LIMITS.minFrequency} Hz`,
		);
	}
	if (stats.maxFrequency > CURVE_LIMITS.maxFrequency) {
		problems.push(
			`frequency ${stats.maxFrequency} Hz above ${CURVE_LIMITS.maxFrequency} Hz`,
		);
	}
	if (
		stats.minGain < CURVE_LIMITS.minGainDb ||
		stats.maxGain > CURVE_LIMITS.maxGainDb
	) {
		problems.push(
			`gain outside ${CURVE_LIMITS.minGainDb}…${CURVE_LIMITS.maxGainDb} dB`,
		);
	}
	for (let i = 1; i < curve.frequencies.length; i++) {
		if ((curve.frequencies[i] ?? 0) <= (curve.frequencies[i - 1] ?? 0)) {
			problems.push(
				"frequencies are not strictly increasing after normalization",
			);
			break;
		}
	}
	return problems;
}

/**
 * Interpolate gain at an arbitrary frequency: linear on log-frequency.
 * Log-f respects auditory scaling; linear (high-order-spline-free) avoids
 * overshoot artifacts that would invent resonances. Clamps outside range.
 */
export function interpolateLog(
	curve: ResponseCurve,
	frequency: number,
): number | null {
	const { frequencies, gains } = curve;
	const n = frequencies.length;
	if (n === 0 || !Number.isFinite(frequency) || frequency <= 0) return null;
	const first = frequencies[0] ?? 0;
	const last = frequencies[n - 1] ?? 0;
	if (frequency <= first) return gains[0] ?? null;
	if (frequency >= last) return gains[n - 1] ?? null;
	const target = Math.log(frequency);
	// Binary search for the bracketing segment.
	let lo = 0;
	let hi = n - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (Math.log(frequencies[mid] ?? 1) <= target) lo = mid;
		else hi = mid;
	}
	const f0 = frequencies[lo] ?? 1;
	const f1 = frequencies[hi] ?? 1;
	const g0 = gains[lo] ?? 0;
	const g1 = gains[hi] ?? 0;
	const t = (target - Math.log(f0)) / (Math.log(f1) - Math.log(f0));
	if (!Number.isFinite(t)) return g0;
	return g0 + (g1 - g0) * t;
}

/** Resample onto a log-spaced grid (shared rendering/fitting convention). */
export function resampleLog(
	curve: ResponseCurve,
	points: number,
	fMin: number,
	fMax: number,
): ResponseCurve {
	const count = Math.max(2, Math.floor(points));
	const lo = Math.log10(Math.max(0.001, fMin));
	const hi = Math.log10(Math.max(lo + 1e-9, fMax));
	const frequencies: number[] = [];
	const gains: number[] = [];
	for (let i = 0; i < count; i++) {
		const f = 10 ** (lo + ((hi - lo) * i) / (count - 1));
		const g = interpolateLog(curve, f);
		frequencies.push(f);
		gains.push(g ?? 0);
	}
	return { frequencies, gains };
}

/**
 * Compensation (correction) curve: target − measurement, resampled onto the
 * grid. Sign convention: positive correction means BOOST there
 * (measurement below target); the AutoEQ optimizer fits PEQ to this curve.
 */
export function compensationCurve(
	measurement: ResponseCurve,
	target: ResponseCurve,
	points: number,
	fMin: number,
	fMax: number,
): ResponseCurve {
	const mGrid = resampleLog(measurement, points, fMin, fMax);
	const tGrid = resampleLog(target, points, fMin, fMax);
	return {
		frequencies: mGrid.frequencies,
		gains: mGrid.gains.map((g, i) => (tGrid.gains[i] ?? 0) - g),
	};
}

/**
 * Parametric target builder (pure math, no data): bass shelf + treble tilt
 * + global offset over a flat base. This is how users get useful targets
 * without any third-party data.
 */
export interface TargetBuilderParams {
	/** Low-shelf gain in dB at bassFreq (smooth shelf shape). */
	bassGainDb: number;
	/** Shelf midpoint frequency in Hz. */
	bassFreq: number;
	/** Linear tilt in dB per octave, pivoting at tiltPivotFreq. */
	tiltDbPerOctave: number;
	tiltPivotFreq: number;
	/** Global offset in dB. */
	offsetDb: number;
}

export const DEFAULT_BUILDER_PARAMS: TargetBuilderParams = {
	bassGainDb: 0,
	bassFreq: 105,
	tiltDbPerOctave: 0,
	tiltPivotFreq: 1000,
	offsetDb: 0,
};

export function buildParametricTarget(
	params: TargetBuilderParams,
	points = 256,
	fMin = 20,
	fMax = 20000,
): ResponseCurve {
	const count = Math.max(2, Math.floor(points));
	const lo = Math.log10(Math.max(0.001, fMin));
	const hi = Math.log10(Math.max(lo + 1e-9, fMax));
	const frequencies: number[] = [];
	const gains: number[] = [];
	// Smooth shelf in log-f: half the bass gain at the midpoint frequency.
	const bassQ = 0.9;
	for (let i = 0; i < count; i++) {
		const f = 10 ** (lo + ((hi - lo) * i) / (count - 1));
		const x = Math.log2(f / Math.max(1, params.bassFreq));
		const shelf = params.bassGainDb / (1 + 2 ** (x / bassQ));
		const tilt =
			params.tiltDbPerOctave * Math.log2(f / Math.max(1, params.tiltPivotFreq));
		frequencies.push(f);
		gains.push(params.offsetDb + shelf + tilt);
	}
	return { frequencies, gains };
}
