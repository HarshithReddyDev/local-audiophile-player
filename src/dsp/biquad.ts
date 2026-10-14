/**
 * Pure RBJ Audio EQ Cookbook coefficient generator (W3C NOTE-audio-eq-cookbook).
 * No browser APIs, no state — deterministic in (band, sampleRate).
 *
 * Total function: invalid/degenerate inputs yield UNITY_BIQUAD (never NaN,
 * never throw). Shelves use the S = 1 convention, identical to
 * BiquadFilterNode, so the response engine predicts node behavior exactly.
 */
import type { BiquadCoefficients, EQBand } from "./types";
import { BAND_LIMITS, UNITY_BIQUAD, usesGain } from "./types";

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}

interface Raw {
	b0: number;
	b1: number;
	b2: number;
	a0: number;
	a1: number;
	a2: number;
}

export function createBiquad(
	band: EQBand,
	sampleRate: number,
): BiquadCoefficients {
	// Non-finite inputs fail safe to bypass (unity) — they must never enter
	// arithmetic that could produce NaN/Inf coefficients.
	if (
		!Number.isFinite(band.frequency) ||
		!Number.isFinite(band.gain) ||
		!Number.isFinite(band.q) ||
		!Number.isFinite(sampleRate)
	) {
		return { ...UNITY_BIQUAD };
	}
	const fs = clamp(
		sampleRate,
		BAND_LIMITS.sampleRate.min,
		BAND_LIMITS.sampleRate.max,
	);
	const nyquist = fs / 2;
	const f0 = clamp(band.frequency, 1, nyquist * 0.999);
	const q = clamp(band.q, BAND_LIMITS.q.min, BAND_LIMITS.q.max);
	const gainDb = usesGain(band.type)
		? clamp(band.gain, BAND_LIMITS.gain.min, BAND_LIMITS.gain.max)
		: 0;
	if (!Number.isFinite(f0 + q + gainDb)) return { ...UNITY_BIQUAD };

	const A = 10 ** (gainDb / 40);
	const w0 = (2 * Math.PI * f0) / fs;
	const cosW = Math.cos(w0);
	const sinW = Math.sin(w0);
	const alpha = sinW / (2 * q);
	// Web Audio spec §1.13.5: lowpass/highpass use α_QdB (Q in dB), NOT the
	// textbook RBJ α. This is a real spec-vs-cookbook divergence, caught by
	// the node-equivalence e2e suite — see docs/dsp-research.md.
	const alphaQdB = sinW / (2 * 10 ** (q / 20));
	// Shelves ignore Q (fixed S = 1 slope, identical to BiquadFilterNode).
	const shelfAlpha = (sinW / 2) * Math.SQRT2;
	let raw: Raw;

	switch (band.type) {
		case "peaking": {
			raw = {
				b0: 1 + alpha * A,
				b1: -2 * cosW,
				b2: 1 - alpha * A,
				a0: 1 + alpha / A,
				a1: -2 * cosW,
				a2: 1 - alpha / A,
			};
			break;
		}
		case "lowshelf": {
			const sqrtA = Math.sqrt(A);
			const twoSqrtAAlpha = 2 * sqrtA * shelfAlpha;
			raw = {
				b0: A * (A + 1 - (A - 1) * cosW + twoSqrtAAlpha),
				b1: 2 * A * (A - 1 - (A + 1) * cosW),
				b2: A * (A + 1 - (A - 1) * cosW - twoSqrtAAlpha),
				a0: A + 1 + (A - 1) * cosW + twoSqrtAAlpha,
				a1: -2 * (A - 1 + (A + 1) * cosW),
				a2: A + 1 + (A - 1) * cosW - twoSqrtAAlpha,
			};
			break;
		}
		case "highshelf": {
			const sqrtA = Math.sqrt(A);
			const twoSqrtAAlpha = 2 * sqrtA * shelfAlpha;
			raw = {
				b0: A * (A + 1 + (A - 1) * cosW + twoSqrtAAlpha),
				b1: -2 * A * (A - 1 + (A + 1) * cosW),
				b2: A * (A + 1 + (A - 1) * cosW - twoSqrtAAlpha),
				a0: A + 1 - (A - 1) * cosW + twoSqrtAAlpha,
				a1: 2 * (A - 1 - (A + 1) * cosW),
				a2: A + 1 - (A - 1) * cosW - twoSqrtAAlpha,
			};
			break;
		}
		case "lowpass": {
			const half = (1 - cosW) / 2;
			raw = {
				b0: half,
				b1: 1 - cosW,
				b2: half,
				a0: 1 + alphaQdB,
				a1: -2 * cosW,
				a2: 1 - alphaQdB,
			};
			break;
		}
		case "highpass": {
			const half = (1 + cosW) / 2;
			raw = {
				b0: half,
				b1: -(1 + cosW),
				b2: half,
				a0: 1 + alphaQdB,
				a1: -2 * cosW,
				a2: 1 - alphaQdB,
			};
			break;
		}
		case "notch": {
			raw = {
				b0: 1,
				b1: -2 * cosW,
				b2: 1,
				a0: 1 + alpha,
				a1: -2 * cosW,
				a2: 1 - alpha,
			};
			break;
		}
		case "bandpass": {
			// Constant 0 dB peak gain variant (the EQ-musical form).
			raw = {
				b0: alpha,
				b1: 0,
				b2: -alpha,
				a0: 1 + alpha,
				a1: -2 * cosW,
				a2: 1 - alpha,
			};
			break;
		}
	}

	if (
		!Number.isFinite(raw.b0 + raw.b1 + raw.b2 + raw.a0 + raw.a1 + raw.a2) ||
		raw.a0 === 0
	) {
		return { ...UNITY_BIQUAD };
	}
	const out: BiquadCoefficients = {
		b0: raw.b0 / raw.a0,
		b1: raw.b1 / raw.a0,
		b2: raw.b2 / raw.a0,
		a1: raw.a1 / raw.a0,
		a2: raw.a2 / raw.a0,
	};
	if (
		!Number.isFinite(out.b0 + out.b1 + out.b2 + out.a1 + out.a2) ||
		Math.abs(out.a2) >= 1 ||
		Math.abs(out.a1) >= 1 + out.a2
	) {
		// Unstable or degenerate (e.g. absurd Q at Nyquist edge): fail safe.
		return { ...UNITY_BIQUAD };
	}
	return out;
}
