/**
 * Frequency-response engine. Pure theory from normalized coefficients —
 * the same math powers tests, the UI graph, and (later) AutoEQ prediction.
 * No AudioContext anywhere in this module.
 */

import { createBiquad } from "./biquad";
import type { BiquadCoefficients, PEQProfile } from "./types";

/** Complex magnitude of H(e^{jω}) in dB for one biquad. */
export function biquadMagnitudeDb(
	coefficients: BiquadCoefficients,
	frequency: number,
	sampleRate: number,
): number {
	if (
		!(frequency > 0) ||
		!(sampleRate > 0) ||
		!Number.isFinite(frequency + sampleRate)
	) {
		return 0;
	}
	const w = (2 * Math.PI * frequency) / sampleRate;
	const cosW = Math.cos(w);
	const sinW = Math.sin(w);
	const cos2W = Math.cos(2 * w);
	const sin2W = Math.sin(2 * w);
	const { b0, b1, b2, a1, a2 } = coefficients;
	const numRe = b0 + b1 * cosW + b2 * cos2W;
	const numIm = -(b1 * sinW + b2 * sin2W);
	const denRe = 1 + a1 * cosW + a2 * cos2W;
	const denIm = -(a1 * sinW + a2 * sin2W);
	const numSq = numRe * numRe + numIm * numIm;
	const denSq = denRe * denRe + denIm * denIm;
	if (!(numSq > 0) || !(denSq > 0)) return 0;
	return 10 * Math.log10(numSq / denSq);
}

/** Total profile response in dB: preamp + sum of enabled bands (dB adds). */
export function peqMagnitudeDb(
	profile: PEQProfile,
	frequency: number,
	sampleRate: number,
): number {
	if (!profile.enabled) return 0;
	let total = profile.preamp;
	for (const band of profile.bands) {
		if (!band.enabled) continue;
		total += biquadMagnitudeDb(
			createBiquad(band, sampleRate),
			frequency,
			sampleRate,
		);
	}
	return total;
}

export interface ResponsePoint {
	frequency: number;
	db: number;
}

/** Log-spaced response grid, default the audible 20 Hz → 20 kHz band. */
export function responseGrid(
	profile: PEQProfile,
	sampleRate: number,
	points = 128,
	fMin = 20,
	fMax = 20000,
): ResponsePoint[] {
	const out: ResponsePoint[] = [];
	const count = Math.max(2, Math.floor(points));
	const lo = Math.log10(Math.max(1, fMin));
	const hi = Math.log10(Math.max(lo + 1e-9, fMax));
	for (let i = 0; i < count; i++) {
		const frequency = 10 ** (lo + ((hi - lo) * i) / (count - 1));
		out.push({ frequency, db: peqMagnitudeDb(profile, frequency, sampleRate) });
	}
	return out;
}

/** Per-band grids for the UI (each band soloed against a flat profile). */
export function bandGrids(
	profile: PEQProfile,
	sampleRate: number,
	points = 128,
): { id: string; points: ResponsePoint[] }[] {
	return profile.bands
		.filter((band) => band.enabled)
		.map((band) => ({
			id: band.id,
			points: responseGrid(
				{ preamp: 0, bands: [{ ...band }], enabled: true },
				sampleRate,
				points,
			),
		}));
}

// -- full-chain response (PEQ + tone + tuner + loudness + graphic) --------

/**
 * One flat band-like stage from any module. Non-LTI modules
 * (compressor, limiter, spatial, reverb) have no magnitude response and
 * are excluded by construction — callers pass only filter stages.
 */
export interface ChainStage {
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
}

export interface ChainResponseInput {
	/** Total static gain before filters (PEQ preamp + ReplayGain). */
	preampDb: number;
	stages: ChainStage[];
	enabled: boolean;
}

/** Full static-chain magnitude in dB (preamp + every enabled stage). */
export function chainMagnitudeDb(
	chain: ChainResponseInput,
	frequency: number,
	sampleRate: number,
): number {
	if (!chain.enabled) return 0;
	let total = chain.preampDb;
	for (const stage of chain.stages) {
		if (!stage.enabled) continue;
		total += biquadMagnitudeDb(
			createBiquad(
				{
					id: "",
					type: stage.type,
					frequency: stage.frequency,
					gain: stage.gain,
					q: stage.q,
					enabled: true,
				},
				sampleRate,
			),
			frequency,
			sampleRate,
		);
	}
	return total;
}

/** Full-chain log grid for the UI graph. */
export function chainResponseGrid(
	chain: ChainResponseInput,
	sampleRate: number,
	points = 128,
	fMin = 20,
	fMax = 20000,
): ResponsePoint[] {
	const out: ResponsePoint[] = [];
	const count = Math.max(2, Math.floor(points));
	const lo = Math.log10(Math.max(1, fMin));
	const hi = Math.log10(Math.max(lo + 1e-9, fMax));
	for (let i = 0; i < count; i++) {
		const frequency = 10 ** (lo + ((hi - lo) * i) / (count - 1));
		out.push({
			frequency,
			db: chainMagnitudeDb(chain, frequency, sampleRate),
		});
	}
	return out;
}

/**
 * Worst-case positive boost over the grid (dB, ≥ 0). Drives the headroom
 * readout and the preamp-compensation suggestion: setting preamp to
 * −peakBoostDb restores unity headroom.
 */
export function chainPeakBoostDb(
	chain: ChainResponseInput,
	sampleRate: number,
	points = 96,
): number {
	if (!chain.enabled) return 0;
	let peak = 0;
	for (const point of chainResponseGrid(chain, sampleRate, points)) {
		if (point.db > peak) peak = point.db;
	}
	return peak;
}
