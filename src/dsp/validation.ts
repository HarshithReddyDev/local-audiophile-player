/**
 * Validation harness: extended metrics, sanity flags, deterministic quality
 * classification, and machine-readable reporting. Measurement only — it never
 * tunes the optimizer (see docs/autoeq-validation.md for the workflow rule).
 */

import type { FittingOptions, HfTreatment } from "./autoeq";
import { fitPEQ, OPTIMIZER_VERSION } from "./autoeq";
import type { CorpusCase } from "./corpus";
import { CORPUS_VERSION } from "./corpus";
import { interpolateLog, resampleLog } from "./curves";
import { bandGrids, peqMagnitudeDb } from "./response";
import type { SmoothingPresetId } from "./smoothing";
import {
	resolveSmoothingWindow,
	smoothingDeviation,
	smoothResponseCurve,
} from "./smoothing";
import type { PEQProfile } from "./types";

export interface ResidualPeak {
	frequency: number;
	db: number;
}

export interface CaseMetrics {
	caseId: string;
	initialRmsDb: number;
	finalRmsDb: number;
	rmsImprovementDb: number;
	initialMaxAbsDb: number;
	finalMaxAbsDb: number;
	p95AfterDb: number;
	bands: number;
	avgAbsGainDb: number;
	maxBoostDb: number;
	maxCutDb: number;
	preampDb: number;
	maxQ: number;
	minQ: number;
	minBandwidthOct: number;
	freqSpanOct: number;
	/** Minimum |log2| distance between any two band centers (0 if <2 bands). */
	minAdjacentOct: number;
	overlappingPairs: number;
	excursionDb: number;
	/** Effective fitting range after measurement clamping (never extrapolated). */
	rangeHz: [number, number];
	/** Which Phase 8A HF model produced this fit. */
	hfTreatment: HfTreatment;
	/** Phase 8D smoothing preset used for the fitting input ("off" = raw). */
	smoothingPreset: SmoothingPresetId;
	/** RMS deviation between raw measurement and smoothed fitting input. */
	smoothingDeviationDb: number;
	residualPeakCount: number;
	largestResidualPeak: ResidualPeak | null;
	flags: string[];
	complexity: "smooth" | "moderate" | "complex" | "suspicious";
	/** Engineering heuristic, NOT perceptual truth (see docs). */
	qualityScore: number;
}

export interface CaseReport extends CaseMetrics {
	bandSummary: { type: string; frequency: number; gain: number; q: number }[];
	/** Fitting overrides for this case ({} when defaults were used). */
	options: Partial<FittingOptions>;
}

function bandwidthOctaves(q: number): number {
	return (2 * Math.asinh(1 / (2 * Math.max(0.01, q)))) / Math.LN2;
}

/** Local maxima of |residual| above threshold, with frequencies. */
export function residualPeaks(
	frequencies: number[],
	residual: ArrayLike<number>,
	thresholdDb = 1,
): ResidualPeak[] {
	const peaks: ResidualPeak[] = [];
	const n = frequencies.length;
	for (let i = 1; i < n - 1; i++) {
		const prev = Math.abs(residual[i - 1] ?? 0);
		const cur = Math.abs(residual[i] ?? 0);
		const next = Math.abs(residual[i + 1] ?? 0);
		if (cur >= thresholdDb && cur >= prev && cur >= next) {
			peaks.push({ frequency: frequencies[i] ?? 0, db: residual[i] ?? 0 });
		}
	}
	return peaks.sort((a, b) => Math.abs(b.db) - Math.abs(a.db));
}

function classifyBand(q: number): "broad" | "medium" | "narrow" | "extreme" {
	if (q < 1.2) return "broad";
	if (q <= 3) return "medium";
	if (q <= 5) return "narrow";
	return "extreme";
}

function rms(values: number[]): number {
	if (values.length === 0) return 0;
	let sum = 0;
	for (const v of values) sum += v * v;
	return Math.sqrt(sum / values.length);
}

export function evaluateCase(
	case_: CorpusCase,
	profile: PEQProfile,
	preampDb: number,
	maxBoostDb: number,
	maxCutDb: number,
	gridPoints = 256,
	fitInfo: {
		rangeHz?: [number, number];
		hfTreatment?: HfTreatment;
		smoothingPreset?: SmoothingPresetId;
		smoothingDeviationDb?: number;
	} = {},
): CaseReport {
	const { measurement, target, id } = case_;
	const grid = resampleLog(measurement, gridPoints, 20, 20000);
	const freqs = grid.frequencies;
	// NOTE: prediction excludes preamp (the fit optimizes bands against the
	// correction curve; preamp is reported separately as a metric).
	const bandsOnly: PEQProfile = {
		preamp: 0,
		enabled: true,
		bands: profile.bands,
	};
	// True compensation on this grid (same target−measurement convention).
	const truth = freqs.map((f) => {
		const t = interpolateLog(target, f) ?? 0;
		const m = interpolateLog(measurement, f) ?? 0;
		return t - m;
	});
	const predicted = freqs.map((f) => peqMagnitudeDb(bandsOnly, f, 48000));
	const residual = predicted.map((p, i) => p - (truth[i] ?? 0));
	const absTruth = truth.map(Math.abs);
	const absResidual = residual.map(Math.abs);
	const sorted = [...absResidual].sort((a, b) => a - b);
	const p95 =
		sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ?? 0;

	const bands = profile.bands;
	const gains = bands.map((b) => b.gain);
	const avgAbsGain =
		gains.length > 0
			? gains.reduce((s, g) => s + Math.abs(g), 0) / gains.length
			: 0;
	const maxQ = bands.reduce((m, b) => Math.max(m, b.q), 0);
	const minQ = bands.length > 0 ? Math.min(...bands.map((b) => b.q)) : 0;
	const minBandwidthOct =
		bands.length > 0 ? Math.min(...bands.map((b) => bandwidthOctaves(b.q))) : 0;
	const bandFreqs = bands.map((b) => b.frequency);
	const freqSpanOct =
		bandFreqs.length > 1
			? Math.log2(Math.max(...bandFreqs) / Math.min(...bandFreqs))
			: 0;
	let overlappingPairs = 0;
	let minAdjacentOct = 0;
	for (let i = 0; i < bands.length; i++) {
		for (let j = i + 1; j < bands.length; j++) {
			const a = bands[i];
			const b = bands[j];
			if (!a || !b) continue;
			const distance = Math.abs(Math.log2(a.frequency / b.frequency));
			if (i === 0 && j === 1) minAdjacentOct = distance;
			else minAdjacentOct = Math.min(minAdjacentOct, distance);
			if (a.type === b.type && distance < 1 / 3) {
				overlappingPairs += 1;
			}
		}
	}
	const excursion =
		predicted.length > 0 ? Math.max(...predicted) - Math.min(...predicted) : 0;
	const peaks = residualPeaks(freqs, residual, 1);

	const flags: string[] = [];
	if (bands.some((b) => b.q >= 5)) flags.push("high-q");
	if (bands.some((b) => b.q >= 5 && Math.abs(b.gain) >= 4))
		flags.push("narrow-hot");
	if (overlappingPairs > 0) flags.push("overlapping");
	if (bands.some((b) => Math.abs(b.gain) >= 11.9)) flags.push("gain-bound-hit");
	if (bands.length >= 8) flags.push("many-bands");
	if (Math.max(...absResidual, 0) > 3) flags.push("large-residual");
	if (peaks.length >= 4) flags.push("rippled-residual");

	const kinds = bands.map((b) => classifyBand(b.q));
	const extreme = kinds.filter((k) => k === "extreme").length;
	let complexity: CaseMetrics["complexity"] = "smooth";
	if (bands.length > 6 || extreme > 0 || flags.includes("large-residual"))
		complexity = "suspicious";
	else if (bands.length > 4 || kinds.includes("narrow") || peaks.length >= 2)
		complexity = "complex";
	else if (bands.length > 2 || kinds.includes("medium"))
		complexity = "moderate";

	// Engineering heuristic ONLY: comparable across runs, not perception.
	const finalRms = rms(residual);
	let qualityScore = finalRms + 0.1 * bands.length + 0.05 * avgAbsGain;
	if (Math.max(...absResidual, 0) > 3) qualityScore += 2;
	qualityScore += extreme * 1;
	if (flags.includes("gain-bound-hit")) qualityScore += 0.5;

	const initialRms = rms(truth);
	return {
		caseId: id,
		initialRmsDb: initialRms,
		finalRmsDb: finalRms,
		rmsImprovementDb: initialRms - finalRms,
		initialMaxAbsDb: Math.max(...absTruth, 0),
		finalMaxAbsDb: Math.max(...absResidual, 0),
		p95AfterDb: p95,
		bands: bands.length,
		avgAbsGainDb: avgAbsGain,
		maxBoostDb,
		maxCutDb,
		preampDb,
		maxQ,
		minQ,
		minBandwidthOct,
		freqSpanOct,
		minAdjacentOct,
		overlappingPairs,
		excursionDb: excursion,
		rangeHz: fitInfo.rangeHz ?? [20, 20000],
		hfTreatment: fitInfo.hfTreatment ?? "average",
		smoothingPreset: fitInfo.smoothingPreset ?? "off",
		smoothingDeviationDb: fitInfo.smoothingDeviationDb ?? 0,
		residualPeakCount: peaks.length,
		largestResidualPeak: peaks[0] ?? null,
		flags,
		complexity,
		qualityScore,
		bandSummary: bands.map((b) => ({
			type: b.type,
			frequency: b.frequency,
			gain: b.gain,
			q: b.q,
		})),
		options: case_.options ?? {},
	};
}

export function validateResult(
	bands: { type: string; frequency: number; gain: number; q: number }[],
	maxBands: number,
	maxBoostDb: number,
	maxCutDb: number,
	minQ: number,
	maxQ: number,
): string[] {
	const problems: string[] = [];
	for (const band of bands) {
		if (!Number.isFinite(band.frequency + band.gain + band.q))
			problems.push("non-finite band param");
		if (band.frequency <= 0) problems.push("non-positive frequency");
		if (band.q < minQ - 1e-9 || band.q > maxQ + 1e-9)
			problems.push("Q out of bounds");
		if (band.gain < -maxCutDb - 1e-9 || band.gain > maxBoostDb + 1e-9)
			problems.push("gain out of bounds");
	}
	if (bands.length > maxBands) problems.push("too many bands");
	return problems;
}

export interface ValidationReport {
	corpusVersion: number;
	optimizerVersion: number;
	gridPoints: number;
	cases: CaseReport[];
}

export function runValidation(
	cases: CorpusCase[],
	gridPoints = 256,
	hooks: { shouldCancel?: () => boolean } = {},
	// Phase 8D: optional preprocessing of the fitting input. "off" passes
	// the raw measurement through untouched (bit-identical to Phase 8C).
	smoothing: SmoothingPresetId = "off",
): ValidationReport {
	return {
		corpusVersion: CORPUS_VERSION,
		optimizerVersion: OPTIMIZER_VERSION,
		gridPoints,
		cases: cases.map((case_) => {
			const window = resolveSmoothingWindow(smoothing);
			// Derived fitting input only — case_.measurement (raw) is never
			// modified; evaluation below always scores against the raw data.
			const fittingInput =
				window > 0
					? smoothResponseCurve(case_.measurement, window)
					: case_.measurement;
			let deviation = 0;
			if (window > 0) {
				const d = smoothingDeviation(case_.measurement, fittingInput);
				deviation = d.rmsDb;
			}
			const result = fitPEQ(
				{
					measurement: fittingInput,
					target: case_.target,
					frequencyRange: { min: 20, max: 20000 },
					fittingOptions: {
						maxBands: 8,
						maxGainDb: 12,
						preferParametric: true,
					},
				},
				case_.options ?? {},
				hooks.shouldCancel ? { shouldCancel: hooks.shouldCancel } : {},
			);
			const profile: PEQProfile = {
				preamp: result.profile.preamp,
				enabled: true,
				bands: result.profile.bands.map((b, i) => ({ ...b, id: `eval-${i}` })),
			};
			return evaluateCase(
				case_,
				profile,
				result.profile.preamp,
				result.metrics.maxBoostDb,
				result.metrics.maxCutDb,
				gridPoints,
				{
					rangeHz: result.metrics.rangeHz,
					hfTreatment: result.metrics.hfTreatment,
					smoothingPreset: smoothing,
					smoothingDeviationDb: deviation,
				},
			);
		}),
	};
}

export type { FittingOptions };

const FIGURE_W = 640;
const FIGURE_H = 300;
const FIGURE_PAD = { left: 46, right: 12, top: 12, bottom: 24 };

function figureX(f: number): number {
	const lo = Math.log10(20);
	const hi = Math.log10(20000);
	const t = (Math.log10(Math.min(20000, Math.max(20, f))) - lo) / (hi - lo);
	return FIGURE_PAD.left + t * (FIGURE_W - FIGURE_PAD.left - FIGURE_PAD.right);
}

function figureY(db: number, maxDb: number): number {
	const t = (db + maxDb) / (2 * maxDb);
	return (
		FIGURE_PAD.top + (1 - t) * (FIGURE_H - FIGURE_PAD.top - FIGURE_PAD.bottom)
	);
}

/**
 * Deterministic before/after SVG for one corpus case, using the same log
 * axis and 0 dB conventions as the app graphs. Series: measurement (light
 * solid), target (light dashed), predicted corrected (blue), combined
 * correction (amber solid), residual = predicted − target (red dashed),
 * individual bands (thin gray), optional smoothed fitting input (teal
 * solid, Phase 8D). Preamp excluded — same convention as
 * evaluateCase (the fit optimizes bands; preamp is level staging reported
 * separately). Numbers rounded to 1 decimal so committed figures are
 * byte-stable.
 */
export function figureSvg(
	case_: CorpusCase,
	profile: PEQProfile,
	gridPoints = 128,
	smoothed: { frequencies: number[]; gains: number[] } | null = null,
): string {
	const grid = resampleLog(case_.measurement, gridPoints, 20, 20000);
	const bandsOnly: PEQProfile = {
		preamp: 0,
		enabled: true,
		bands: profile.bands,
	};
	const correction = grid.frequencies.map((f) =>
		peqMagnitudeDb(bandsOnly, f, 48000),
	);
	const predicted = grid.frequencies.map(
		(_, i) => (grid.gains[i] ?? 0) + (correction[i] ?? 0),
	);
	const target = grid.frequencies.map(
		(f) => interpolateLog(case_.target, f) ?? 0,
	);
	const residual = predicted.map((p, i) => p - (target[i] ?? 0));
	let peak = 6;
	for (const v of [...grid.gains, ...target, ...predicted, ...correction])
		peak = Math.max(peak, Math.abs(v));
	const maxDb = Math.ceil(Math.min(30, peak));
	const path = (xs: number[], ys: number[]) =>
		xs
			.map(
				(f, i) =>
					`${i === 0 ? "M" : "L"}${figureX(f).toFixed(1)},${figureY(ys[i] ?? 0, maxDb).toFixed(1)}`,
			)
			.join(" ");
	const bandPaths = bandGrids(profile, 48000, 64).map(
		(b) =>
			`<path d="${path(
				b.points.map((p) => p.frequency),
				b.points.map((p) => p.db),
			)}" fill="none" stroke="#5b6b82" stroke-width="1"/>`,
	);
	const ticks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
		.map(
			(f) =>
				`<line x1="${figureX(f)}" y1="${FIGURE_PAD.top}" x2="${figureX(f)}" y2="${FIGURE_H - FIGURE_PAD.bottom}" stroke="#888" stroke-opacity="0.2"/>` +
				`<text x="${figureX(f)}" y="${FIGURE_H - 8}" text-anchor="middle" font-size="10" fill="#888">${f >= 1000 ? `${f / 1000}k` : f}</text>`,
		)
		.join("");
	const zero = figureY(0, maxDb);
	const smoothedPath =
		smoothed !== null
			? `<path d="${path(smoothed.frequencies, smoothed.gains)}" fill="none" stroke="#4fd1a5" stroke-width="1.5"/>`
			: "";
	const desc =
		"light-solid=measurement light-dashed=target blue=predicted-corrected amber=combined-correction red-dashed=residual gray=individual-bands" +
		(smoothed !== null ? " teal=smoothed-fitting-input" : "") +
		"; preamp excluded";
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FIGURE_W} ${FIGURE_H}" role="img">` +
		`<title>${case_.id} ${case_.title}</title>` +
		`<desc>${desc}</desc>` +
		`<rect width="${FIGURE_W}" height="${FIGURE_H}" fill="#0b0e14"/>` +
		ticks +
		`<line x1="${FIGURE_PAD.left}" y1="${zero}" x2="${FIGURE_W - FIGURE_PAD.right}" y2="${zero}" stroke="#888" stroke-opacity="0.6"/>` +
		bandPaths.join("") +
		`<path d="${path(grid.frequencies, correction)}" fill="none" stroke="#e0a63c" stroke-width="1.5"/>` +
		`<path d="${path(grid.frequencies, residual)}" fill="none" stroke="#d97b7b" stroke-width="1" stroke-dasharray="2 2"/>` +
		`<path d="${path(grid.frequencies, grid.gains)}" fill="none" stroke="#9fb3c8" stroke-width="1.5"/>` +
		smoothedPath +
		`<path d="${path(grid.frequencies, target)}" fill="none" stroke="#9fb3c8" stroke-width="1" stroke-dasharray="4 3"/>` +
		`<path d="${path(grid.frequencies, predicted)}" fill="none" stroke="#86c5ff" stroke-width="2.5"/>` +
		`</svg>`
	);
}
