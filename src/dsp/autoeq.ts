/**
 * Client-side PEQ fitter: greedy residual peak placement + bounded coordinate
 * descent. Pure, deterministic (zero randomness), dependency-free.
 *
 * Method (see docs/autoeq-research.md): compensation grid from the shared
 * response engine → justified shelves → sequential peak fitting on the
 * residual → coordinate refinement → prune → preamp. Runs in a Web Worker;
 * this module never touches workers, DOM, or stores.
 */

import type { AutoEQInput } from "../iem/types";
import { createBiquad } from "./biquad";
import { interpolateLog } from "./curves";
import { biquadMagnitudeDb } from "./response";
import type { BiquadCoefficients, FilterType, SerializedPEQ } from "./types";
import { isStable } from "./types";

export const OPTIMIZER_VERSION = 2;

export const OPTIMIZER_VERSION_NOTES: Record<number, string> = {
	1: "Greedy residual peaks + global-fc coordinate descent, HF averaging above 10 kHz.",
	2: "Phase 8: explicit HF treatment (average/fit/exclude), local fc refinement window, opposition pruning. Defaults reproduce v1 unless the new options are enabled.",
};

/** Canonical coefficient rate: node params are rate-independent by design. */
const COEFF_FS = 48000;

/**
 * Phase 8A: how the fit treats frequencies above the HF knee.
 * - "average": collapse compensation above the knee to its mean (v1 behavior;
 *   guards against chasing unreliable treble energy).
 * - "fit": fit the full range as measured (for trusted rigs; can overfit).
 * - "exclude": stop the fitting grid at the knee (ignore treble entirely).
 */
export type HfTreatment = "average" | "fit" | "exclude";

export type FitRangePresetId = "full" | "treble-10k" | "standard-8k" | "custom";

export interface FitRangePreset {
	id: FitRangePresetId;
	label: string;
	minFrequency: number;
	maxFrequency: number;
	description: string;
}

/**
 * Phase 8A presets. Shapes mirror the Phase 7.5 variation studies
 * (20–10k / 20–8k refits avoided treble narrowness); Full preserves the
 * Phase 7 default. Every preset is still clamped to measured data —
 * presets never extrapolate (see §5 of the Phase 8 brief).
 */
export const FIT_RANGE_PRESETS: FitRangePreset[] = [
	{
		id: "full",
		label: "Full",
		minFrequency: 20,
		maxFrequency: 20000,
		description:
			"Fit the whole measurement up to 20 kHz. Treble above the HF knee is averaged, not chased.",
	},
	{
		id: "treble-10k",
		label: "20 Hz – 10 kHz",
		minFrequency: 20,
		maxFrequency: 10000,
		description:
			"Controlled treble: stop fitting at 10 kHz, where coupler measurements get less reliable.",
	},
	{
		id: "standard-8k",
		label: "20 Hz – 8 kHz",
		minFrequency: 20,
		maxFrequency: 8000,
		description:
			"Conservative: fit bass through presence and leave the top octaves alone.",
	},
	{
		id: "custom",
		label: "Custom",
		minFrequency: 20,
		maxFrequency: 20000,
		description:
			"Set your own limits. Still clamped to the measured data — never extrapolated.",
	},
];

/** Map a preset id to a concrete {min, max} pair (custom uses the fallback). */
export function resolvePresetRange(
	preset: FitRangePresetId,
	customMin = 20,
	customMax = 20000,
): { minFrequency: number; maxFrequency: number } {
	if (preset === "custom") {
		return { minFrequency: customMin, maxFrequency: customMax };
	}
	const found = FIT_RANGE_PRESETS.find((p) => p.id === preset);
	return found
		? { minFrequency: found.minFrequency, maxFrequency: found.maxFrequency }
		: { minFrequency: 20, maxFrequency: 20000 };
}

export interface FittingOptions {
	minFrequency: number;
	maxFrequency: number;
	maxBands: number;
	maxBoostDb: number;
	maxCutDb: number;
	minQ: number;
	maxQ: number;
	allowLowShelf: boolean;
	allowHighShelf: boolean;
	gridPoints: number;
	refinementSweeps: number;
	toleranceDb: number;
	timeBudgetMs: number;
	/**
	 * Deprecated v1 alias for the HF knee; honored only when hfKneeHz is not
	 * explicitly provided. hfFlattenFreq: 0 disables flattening (= "fit").
	 * Prefer hfTreatment + hfKneeHz (Phase 8A).
	 */
	hfFlattenFreq?: number;
	/** Phase 8A: treatment of frequencies above hfKneeHz. */
	hfTreatment: HfTreatment;
	/** Phase 8A: knee frequency (Hz) for hfTreatment. */
	hfKneeHz: number;
	/**
	 * Phase 8B: replace the global fc line search with a bounded local
	 * log-frequency window (discrete candidates + line refine, peaking
	 * bands only). Off by default until benchmarked (opt-in per §25).
	 */
	localFcSearch: boolean;
	/** Phase 8B: total local window width in octaves. */
	localFcWindowOct: number;
	/** Phase 8B: discrete candidates evaluated across the window (≥3). */
	localFcCandidates: number;
	/**
	 * Phase 8C: drop the weaker of two strongly-overlapping opposing peaking
	 * bands when total RMSE stays within pruneToleranceDb. Off by default
	 * until benchmarked (opt-in per §25).
	 */
	oppositionPrune: boolean;
	/**
	 * Phase 8C: absolute RMS budget for opposition removals. The acceptance
	 * test ALSO applies the validation regression policy relatively
	 * (trial ≤ baseline·1.05 + 0.03): an absolute-only budget would let a
	 * removal triple an already-excellent fit (e.g. 0.012 → 0.058 dB on a
	 * narrow-notch case), while the relative term scales protection with
	 * fit quality. Both must hold; the budget is total, not per-removal.
	 */
	pruneToleranceDb: number;
}

export const DEFAULT_FITTING_OPTIONS: FittingOptions = {
	minFrequency: 20,
	maxFrequency: 20000,
	maxBands: 8,
	maxBoostDb: 12,
	maxCutDb: 12,
	minQ: 0.5,
	maxQ: 6,
	allowLowShelf: true,
	allowHighShelf: true,
	gridPoints: 160,
	refinementSweeps: 6,
	toleranceDb: 0.0001,
	timeBudgetMs: 15000,
	hfTreatment: "average",
	hfKneeHz: 10000,
	localFcSearch: false,
	localFcWindowOct: 0.5,
	localFcCandidates: 5,
	oppositionPrune: false,
	pruneToleranceDb: 0.05,
};

export interface FitMetrics {
	rmsBeforeDb: number;
	rmsAfterDb: number;
	maxAbsAfterDb: number;
	p95AfterDb: number;
	bands: number;
	maxBoostDb: number;
	maxCutDb: number;
	preampDb: number;
	gridPoints: number;
	rangeHz: [number, number];
	/** Effective fitting range after measurement clamping (and HF exclude). */
	sweeps: number;
	optimizerVersion: number;
	elapsedMs: number;
	cancelled: boolean;
	/** Which Phase 8A HF model produced this fit. */
	hfTreatment: HfTreatment;
}

export interface FitResult {
	profile: SerializedPEQ;
	metrics: FitMetrics;
}

export interface FitHooks {
	shouldCancel?: () => boolean;
	onProgress?: (stage: string, done: number, total: number) => void;
}

export class AutoEQError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AutoEQError";
	}
}

interface WorkBand {
	type: FilterType;
	frequency: number;
	gain: number;
	q: number;
}

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	let sum = 0;
	for (const v of values) sum += v;
	return sum / values.length;
}

function bandMean(
	gains: number[],
	freqs: number[],
	lo: number,
	hi: number,
): number {
	let sum = 0;
	let count = 0;
	for (let i = 0; i < freqs.length; i++) {
		const f = freqs[i] ?? 0;
		if (f >= lo && f <= hi) {
			sum += gains[i] ?? 0;
			count += 1;
		}
	}
	return count > 0 ? sum / count : 0;
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}

/** Q from −3 dB-ish peak width in octaves (upstream AutoEq relation). */
function qFromWidthOctaves(bw: number): number {
	const safe = Math.max(0.05, bw);
	const pow = 2 ** safe;
	return Math.sqrt(pow) / (pow - 1);
}

/** Sum of band responses on the grid (dB adds for cascades). */
function predictDb(bands: WorkBand[], gridFreqs: number[]): Float64Array {
	const out = new Float64Array(gridFreqs.length);
	for (const band of bands) {
		const coeffs = createBiquad(
			{
				id: "fit",
				type: band.type,
				frequency: band.frequency,
				gain:
					band.type === "peaking" ||
					band.type === "lowshelf" ||
					band.type === "highshelf"
						? band.gain
						: 0,
				q: band.q,
				enabled: true,
			},
			COEFF_FS,
		);
		for (let i = 0; i < gridFreqs.length; i++) {
			out[i] =
				(out[i] ?? 0) + biquadMagnitudeDb(coeffs, gridFreqs[i] ?? 20, COEFF_FS);
		}
	}
	return out;
}

function rmse(predicted: ArrayLike<number>, target: ArrayLike<number>): number {
	const n = Math.min(predicted.length, target.length);
	if (n === 0) return Number.POSITIVE_INFINITY;
	let sum = 0;
	for (let i = 0; i < n; i++) {
		const d = (predicted[i] ?? 0) - (target[i] ?? 0);
		sum += d * d;
	}
	return Math.sqrt(sum / n);
}

function percentileAbs(errors: number[], p: number): number {
	if (errors.length === 0) return 0;
	const sorted = [...errors].map(Math.abs).sort((a, b) => a - b);
	return (
		sorted[
			Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
		] ?? 0
	);
}

/** Subtract one band's response from the residual (greedy fitting). */
function subtractResponse(
	residual: Float64Array,
	band: WorkBand,
	gridFreqs: number[],
): void {
	const resp = predictDb([band], gridFreqs);
	for (let i = 0; i < residual.length; i++) {
		residual[i] = (residual[i] ?? 0) - (resp[i] ?? 0);
	}
}

/** Golden-section line search on one scalar parameter. Deterministic. */
function lineSearch(
	evaluate: (value: number) => number,
	lo: number,
	hi: number,
	iterations = 10,
): number {
	let a = lo;
	let b = hi;
	const ratio = (Math.sqrt(5) - 1) / 2;
	let c = b - ratio * (b - a);
	let d = a + ratio * (b - a);
	let fc = evaluate(c);
	let fd = evaluate(d);
	for (let i = 0; i < iterations; i++) {
		if (fc < fd) {
			b = d;
			d = c;
			fd = fc;
			c = b - ratio * (b - a);
			fc = evaluate(c);
		} else {
			a = c;
			c = d;
			fc = fd;
			d = a + ratio * (b - a);
			fd = evaluate(d);
		}
	}
	return (a + b) / 2;
}

/**
 * Phase 8C: opposition-pair criterion (strategy A — remove the weaker
 * filter; merge/refit variants rejected: equivalent-parameter solving
 * adds machinery without evidence, see docs/autoeq-phase8.md). A pair
 * qualifies only when both bands are peaking, strongly overlapping
 * (|log2| center distance < 1/3 octave — the same definition the
 * validation harness counts as overlap), AND their gains oppose.
 * Response contribution decides removal (see prune step in fitPEQ),
 * never gain signs alone. Shelves are excluded (broad, deliberate
 * corrections); same-sign overlap stays with the near-duplicate pass.
 * Returns the first qualifying index pair in band order
 * (deterministic), else null.
 */
export function findOppositionPair(
	bands: { type: FilterType; frequency: number; gain: number }[],
): [number, number] | null {
	for (let i = 0; i < bands.length; i++) {
		for (let j = i + 1; j < bands.length; j++) {
			const a = bands[i];
			const b = bands[j];
			if (!a || !b || a.type !== "peaking" || b.type !== "peaking") {
				continue;
			}
			if (Math.abs(Math.log2(a.frequency / b.frequency)) >= 1 / 3) {
				continue;
			}
			if (a.gain * b.gain >= 0) continue;
			return [i, j];
		}
	}
	return null;
}

export function fitPEQ(
	input: AutoEQInput,
	overrides: Partial<FittingOptions> = {},
	hooks: FitHooks = {},
): FitResult {
	const started = Date.now();
	const options: FittingOptions = { ...DEFAULT_FITTING_OPTIONS, ...overrides };
	const cancelled = () => hooks.shouldCancel?.() === true;
	const progress = (stage: string, done: number, total: number) =>
		hooks.onProgress?.(stage, done, total);

	const meas = input.measurement;
	const target = input.target;
	if (meas.frequencies.length < 2 || target.frequencies.length < 2) {
		throw new AutoEQError(
			"Not enough measurement points: need at least 2 frequency/gain pairs in both measurement and target.",
		);
	}
	if (options.maxBands < 1) {
		throw new AutoEQError("Maximum band count must be at least 1.");
	}
	// Resolve the Phase 8A HF model. The deprecated v1 hfFlattenFreq alias
	// only applies when hfKneeHz/hfTreatment were not explicitly provided;
	// hfFlattenFreq: 0 keeps its documented v1 meaning (no flattening).
	const hfKneeHz =
		overrides.hfKneeHz ??
		options.hfFlattenFreq ??
		DEFAULT_FITTING_OPTIONS.hfKneeHz;
	const hfTreatment: HfTreatment =
		overrides.hfTreatment ??
		(options.hfFlattenFreq === 0 ? "fit" : DEFAULT_FITTING_OPTIONS.hfTreatment);
	// Clamp the fit range to measured data — never extrapolate silently.
	// Requested range ∩ measurement valid range; "exclude" additionally
	// caps the range at the HF knee.
	const dataMin = Math.min(...meas.frequencies);
	const dataMax = Math.max(...meas.frequencies);
	const fitMin = clamp(Math.max(options.minFrequency, dataMin, 10), 10, 40000);
	let fitMax = clamp(Math.min(options.maxFrequency, dataMax), 20, 40000);
	if (hfTreatment === "exclude") {
		fitMax = clamp(Math.min(fitMax, Math.max(20, hfKneeHz)), 20, 40000);
	}
	if (!(fitMax / fitMin >= 2)) {
		throw new AutoEQError(
			`Fitting range ${fitMin.toFixed(0)}–${fitMax.toFixed(0)} Hz is too narrow (need ≥1 octave of measured data).`,
		);
	}

	// Canonical log grid + compensation target (shared Phase 6 math).
	const count = Math.max(32, Math.floor(options.gridPoints));
	const frequencies: number[] = [];
	const compensation: number[] = [];
	const lo = Math.log10(fitMin);
	const hi = Math.log10(fitMax);
	for (let i = 0; i < count; i++) {
		frequencies.push(10 ** (lo + ((hi - lo) * i) / (count - 1)));
		compensation.push(0);
	}
	progress("gridding", 0, 1);
	for (let i = 0; i < count; i++) {
		const f = frequencies[i] ?? fitMin;
		const m = interpolateLog(meas, f) ?? 0;
		const t = interpolateLog(target, f) ?? 0;
		compensation[i] = t - m;
	}
	// HF treatment (upstream-proven): "average" collapses compensation above
	// the knee to its mean so the fit cannot chase unreliable treble energy;
	// "fit" fits the grid as measured; "exclude" never built grid above the
	// knee in the first place (see range clamping above).
	if (hfTreatment === "average" && hfKneeHz > 0) {
		const hf = compensation.filter((_, i) => (frequencies[i] ?? 0) >= hfKneeHz);
		const avg = mean(hf);
		for (let i = 0; i < count; i++) {
			if ((frequencies[i] ?? 0) >= hfKneeHz) compensation[i] = avg;
		}
	}
	progress("gridding", 1, 1);

	const residual = Float64Array.from(compensation);
	const bands: WorkBand[] = [];
	const fcMin = 20;
	const fcMax = 10000;

	const evalWith = (
		candidate: WorkBand[],
		index: number,
		patch: Partial<WorkBand>,
	): number => {
		const trial = candidate.map((b, i) =>
			i === index ? { ...b, ...patch } : b,
		);
		return rmse(predictDb(trial, frequencies), compensation);
	};

	/**
	 * Phase 8B: bounded local fc search for one peaking band. Discrete
	 * log-spaced candidates across ±windowOct/2 around the current fc —
	 * each scored with the EXISTING total-RMSE objective (never local peak
	 * height, so no single filter can win while worsening the cascade) —
	 * then golden-section refine within one discrete step of the winner.
	 * Deterministic: fixed candidate order, earliest wins ties. Frequency
	 * only: gain and Q keep their coordinate-descent steps (§10).
	 */
	const refineFcLocal = (bandIndex: number, centerFc: number): number => {
		const evalAt = (logFc: number) =>
			evalWith(bands, bandIndex, { frequency: 10 ** logFc });
		const candidates = Math.max(3, Math.floor(options.localFcCandidates));
		const halfLog =
			((Math.max(0.05, options.localFcWindowOct) / 2) * Math.LN2) / Math.LN10;
		const globalLo = Math.log10(fcMin);
		const globalHi = Math.log10(fcMax);
		const center = clamp(Math.log10(centerFc), globalLo, globalHi);
		const lo = Math.max(globalLo, center - halfLog);
		const hi = Math.min(globalHi, center + halfLog);
		let best = center;
		let bestValue = Number.POSITIVE_INFINITY;
		for (let k = 0; k < candidates; k++) {
			if (cancelled()) break;
			const candidate = lo + ((hi - lo) * k) / (candidates - 1);
			const value = evalAt(candidate);
			if (value < bestValue) {
				bestValue = value;
				best = candidate;
			}
		}
		const step = (hi - lo) / (candidates - 1);
		const refineLo = Math.max(globalLo, best - step);
		const refineHi = Math.min(globalHi, best + step);
		if (!(refineHi > refineLo)) return clamp(10 ** best, fcMin, fcMax);
		return clamp(10 ** lineSearch(evalAt, refineLo, refineHi), fcMin, fcMax);
	};

	// -- justified shelves (before peaking, like upstream configs) ---------
	progress("placing", 0, options.maxBands);
	if (options.allowLowShelf && bands.length < options.maxBands) {
		const lowAvg = bandMean(compensation, frequencies, fitMin, 200);
		const midAvg = bandMean(compensation, frequencies, 500, 2000);
		if (Math.abs(lowAvg - midAvg) > 3) {
			// Split point maximizing below/above contrast in 40–500 Hz.
			let bestFc = 105;
			let bestContrast = -1;
			for (const fc of [40, 60, 80, 105, 150, 220, 320, 500]) {
				const below = bandMean(compensation, frequencies, fitMin, fc);
				const above = bandMean(compensation, frequencies, fc, 2000);
				const contrast = Math.abs(below - above);
				if (contrast > bestContrast) {
					bestContrast = contrast;
					bestFc = fc;
				}
			}
			const gain = clamp(
				lowAvg - midAvg,
				-options.maxCutDb,
				options.maxBoostDb,
			);
			if (Math.abs(gain) >= 0.5) {
				const shelf: WorkBand = {
					type: "lowshelf",
					frequency: bestFc,
					gain,
					q: 0.7,
				};
				bands.push(shelf);
				subtractResponse(residual, shelf, frequencies);
			}
		}
	}
	if (options.allowHighShelf && bands.length < options.maxBands) {
		const highAvg = bandMean(
			compensation,
			frequencies,
			5000,
			Math.min(10000, fitMax),
		);
		const midAvg = bandMean(compensation, frequencies, 500, 2000);
		if (Math.abs(highAvg - midAvg) > 3 && fitMax >= 5000) {
			const gain = clamp(
				highAvg - midAvg,
				-options.maxCutDb,
				options.maxBoostDb,
			);
			if (Math.abs(gain) >= 0.5) {
				const shelf: WorkBand = {
					type: "highshelf",
					frequency: 10000,
					gain,
					q: 0.7,
				};
				bands.push(shelf);
				subtractResponse(residual, shelf, frequencies);
			}
		}
	}

	// -- greedy residual peak placement --------------------------------------
	while (bands.length < options.maxBands) {
		if (cancelled()) break;
		if (Date.now() - started > options.timeBudgetMs) break;
		// Largest remaining deviation inside the fc window.
		let peak = -1;
		let peakVal = 0;
		for (let i = 0; i < count; i++) {
			const f = frequencies[i] ?? 0;
			if (f < fcMin || f > fcMax) continue;
			const v = Math.abs(residual[i] ?? 0);
			if (v > peakVal) {
				peakVal = v;
				peak = i;
			}
		}
		if (peak === -1 || peakVal < 0.5) break;
		const peakFreq = frequencies[peak] ?? 1000;
		const peakGain = residual[peak] ?? 0;
		// Half-height width in octaves → Q (upstream relation).
		const half = Math.abs(peakGain) / 2;
		let loIx = peak;
		while (loIx > 0 && Math.abs(residual[loIx - 1] ?? 0) >= half) loIx -= 1;
		let hiIx = peak;
		while (hiIx < count - 1 && Math.abs(residual[hiIx + 1] ?? 0) >= half)
			hiIx += 1;
		const widthOct = Math.max(
			0.1,
			Math.log2(
				(frequencies[hiIx] ?? peakFreq) /
					Math.max(1, frequencies[loIx] ?? peakFreq),
			),
		);
		const q = clamp(qFromWidthOctaves(widthOct), options.minQ, options.maxQ);
		const gain = clamp(peakGain, -options.maxCutDb, options.maxBoostDb);
		bands.push({
			type: "peaking",
			frequency: clamp(peakFreq, fcMin, fcMax),
			gain,
			q,
		});
		const placed = bands[bands.length - 1];
		if (placed) subtractResponse(residual, placed, frequencies);
		progress("placing", bands.length, options.maxBands);
	}

	// -- coordinate-descent refinement ----------------------------------------
	let sweeps = 0;
	let previous = rmse(predictDb(bands, frequencies), compensation);
	const maxSweeps = Math.max(0, Math.floor(options.refinementSweeps));
	for (let sweep = 0; sweep < maxSweeps; sweep++) {
		if (cancelled()) break;
		if (Date.now() - started > options.timeBudgetMs) break;
		progress("refining", sweep, maxSweeps);
		for (let b = 0; b < bands.length; b++) {
			if (cancelled()) break;
			const band = bands[b];
			if (!band) continue;
			const evalBand = (patch: Partial<WorkBand>) => evalWith(bands, b, patch);
			if (band.type === "peaking") {
				if (options.localFcSearch) {
					band.frequency = refineFcLocal(b, band.frequency);
				} else {
					const logLo = Math.log10(fcMin);
					const logHi = Math.log10(fcMax);
					const logFc = lineSearch(
						(v) => evalBand({ frequency: 10 ** v }),
						logLo,
						logHi,
					);
					band.frequency = clamp(10 ** logFc, fcMin, fcMax);
				}
				band.q = lineSearch(
					(v) => evalBand({ q: v }),
					options.minQ,
					options.maxQ,
				);
			} else {
				band.frequency = lineSearch(
					(v) => evalBand({ frequency: v }),
					band.type === "lowshelf" ? 40 : 3000,
					band.type === "lowshelf" ? 500 : 12000,
				);
			}
			band.gain = lineSearch(
				(v) => evalBand({ gain: v }),
				-options.maxCutDb,
				options.maxBoostDb,
			);
		}
		sweeps += 1;
		const current = rmse(predictDb(bands, frequencies), compensation);
		progress("refining", sweep + 1, maxSweeps);
		if (previous - current < options.toleranceDb) break;
		previous = current;
	}

	// -- prune negligible and duplicate bands ----------------------------------
	const kept = bands.filter((b) => Math.abs(b.gain) >= 0.3);
	const deduped: WorkBand[] = [];
	for (const band of kept) {
		const twin = deduped.find(
			(d) =>
				d.type === band.type &&
				Math.abs(Math.log2(d.frequency / band.frequency)) < 1 / 6 &&
				Math.abs(d.gain - band.gain) < 1,
		);
		if (twin) {
			if (Math.abs(band.gain) > Math.abs(twin.gain)) {
				deduped.splice(deduped.indexOf(twin), 1, band);
			}
		} else {
			deduped.push(band);
		}
	}

	// Phase 8C opposition pruning: repeatedly drop the weaker band of the
	// first qualifying opposing pair while TOTAL cost stays within BOTH the
	// absolute pruneToleranceDb budget AND the relative validation policy
	// (≤ baseline·1.05 + 0.03 dB). The relative term protects excellent fits
	// where +0.05 absolute would be a several-fold residual regression
	// (found on the narrow-3 kHz case: a 0.4 dB sidelobe helper is
	// load-bearing despite its size). Deterministic fixpoint; partial
	// pruning on cancel/timeout is still a valid (flagged) result.
	let pruned = deduped;
	if (options.oppositionPrune) {
		let current = [...deduped];
		const baselineRms = rmse(predictDb(current, frequencies), compensation);
		const budget =
			baselineRms +
			Math.min(options.pruneToleranceDb, baselineRms * 0.05 + 0.03);
		for (;;) {
			if (cancelled() || Date.now() - started > options.timeBudgetMs) break;
			const pair = findOppositionPair(current);
			if (!pair) break;
			const [i, j] = pair;
			const a = current[i];
			const b = current[j];
			if (!a || !b) break;
			const weaker = Math.abs(a.gain) <= Math.abs(b.gain) ? i : j;
			const trial = current.filter((_, k) => k !== weaker);
			const trialRms = rmse(predictDb(trial, frequencies), compensation);
			if (trialRms > budget) break;
			current = trial;
		}
		pruned = current;
	}

	// -- metrics, preamp, output -----------------------------------------------
	const finalResp = predictDb(pruned, frequencies);
	const errors = finalResp.map((v, i) => v - (compensation[i] ?? 0));
	const rmsAfter = Math.sqrt(mean([...errors].map((e) => e * e)));
	const rmsBefore = Math.sqrt(mean(compensation.map((c) => c * c)));
	const predicted = predictDb(pruned, frequencies);
	let maxBoost = 0;
	let maxCut = 0;
	for (const v of predicted) {
		if (v > maxBoost) maxBoost = v;
		if (v < maxCut) maxCut = v;
	}
	const preamp = maxBoost > 0 ? -Math.min(24, Math.max(0, maxBoost)) : 0;

	const profileBands = pruned.map((b) => ({
		type: b.type,
		frequency: Math.round(b.frequency * 10) / 10,
		gain: Math.round(b.gain * 10) / 10,
		q: Math.round(b.q * 100) / 100,
		enabled: true,
	}));
	// Belt and braces: every emitted band must validate and be stable.
	const validBands = profileBands.filter((b) => {
		const coeffs: BiquadCoefficients = createBiquad(
			{ ...b, id: "fit" },
			COEFF_FS,
		);
		return isStable(coeffs);
	});

	const profile: SerializedPEQ = {
		version: 1,
		preamp: Math.round(preamp * 10) / 10,
		enabled: true,
		bands: validBands,
	};

	return {
		profile,
		metrics: {
			rmsBeforeDb: rmsBefore,
			rmsAfterDb: rmsAfter,
			maxAbsAfterDb: Math.max(...[...errors].map(Math.abs), 0),
			p95AfterDb: percentileAbs([...errors], 95),
			bands: validBands.length,
			maxBoostDb: maxBoost,
			maxCutDb: maxCut,
			preampDb: profile.preamp,
			gridPoints: count,
			rangeHz: [fitMin, fitMax],
			sweeps,
			optimizerVersion: OPTIMIZER_VERSION,
			elapsedMs: Date.now() - started,
			cancelled: cancelled(),
			hfTreatment,
		},
	};
}
