/**
 * Deterministic synthetic measurement generator for validation.
 * Curves are built ANALYTICALLY from our own biquad mathematics (known-answer
 * infrastructure): a measurement is the response of known filters, so fits
 * can be judged on residual quality against ground truth. Seeded PRNG
 * throughout — same seed, same curve, every run, every machine.
 */
import { createBiquad } from "./biquad";
import type { ResponseCurve } from "./curves";
import { biquadMagnitudeDb } from "./response";
import type { EQBand, FilterType } from "./types";

/** Mulberry32: small, fast, fully deterministic seeded PRNG. */
export function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state |= 0;
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface SynthFilter {
	type: FilterType;
	frequency: number;
	gain: number;
	q: number;
}

function toBand(filter: SynthFilter, index: number): EQBand {
	return {
		id: `synth-${index}`,
		type: filter.type,
		frequency: filter.frequency,
		gain: filter.gain,
		q: filter.q,
		enabled: true,
	};
}

/** Log-spaced grid helper shared by every generator. */
export function logGrid(points: number, fMin = 20, fMax = 20000): number[] {
	const out: number[] = [];
	const lo = Math.log10(fMin);
	const hi = Math.log10(fMax);
	for (let i = 0; i < points; i++) {
		out.push(10 ** (lo + ((hi - lo) * i) / Math.max(1, points - 1)));
	}
	return out;
}

/**
 * Render known filters + tilt + noise into a measurement curve.
 * fs is fixed at 48000: node params are rate-independent by design.
 */
export function synthMeasurement(
	filters: SynthFilter[],
	options: {
		points?: number;
		fMin?: number;
		fMax?: number;
		tiltDbPerOctave?: number;
		tiltPivotHz?: number;
		noiseDb?: number;
		seed?: number;
	} = {},
): ResponseCurve {
	const points = options.points ?? 200;
	const frequencies = logGrid(points, options.fMin, options.fMax);
	const bands = filters.map(toBand);
	const tilt = options.tiltDbPerOctave ?? 0;
	const pivot = options.tiltPivotHz ?? 1000;
	const noiseDb = options.noiseDb ?? 0;
	const rand = mulberry32(options.seed ?? 1);
	const gains = frequencies.map((f) => {
		let g = 0;
		for (const band of bands) {
			g += biquadMagnitudeDb(createBiquad(band, 48000), f, 48000);
		}
		g += tilt * Math.log2(f / pivot);
		if (noiseDb > 0) g += (rand() * 2 - 1) * noiseDb;
		return g;
	});
	return { frequencies, gains };
}

/** Subsample to sparse points (deterministic stride). */
export function sparseSample(
	curve: ResponseCurve,
	every: number,
): ResponseCurve {
	const frequencies: number[] = [];
	const gains: number[] = [];
	for (let i = 0; i < curve.frequencies.length; i += every) {
		frequencies.push(curve.frequencies[i] ?? 20);
		gains.push(curve.gains[i] ?? 0);
	}
	if (frequencies.length > 0) {
		frequencies.push(curve.frequencies[curve.frequencies.length - 1] ?? 20000);
		gains.push(curve.gains[curve.gains.length - 1] ?? 0);
	}
	return { frequencies, gains };
}

/** Truncate to a sub-range (tests range handling without extrapolation). */
export function truncateRange(
	curve: ResponseCurve,
	fMin: number,
	fMax: number,
): ResponseCurve {
	const frequencies: number[] = [];
	const gains: number[] = [];
	for (let i = 0; i < curve.frequencies.length; i++) {
		const f = curve.frequencies[i] ?? 0;
		if (f >= fMin && f <= fMax) {
			frequencies.push(f);
			gains.push(curve.gains[i] ?? 0);
		}
	}
	return { frequencies, gains };
}
