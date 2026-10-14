/**
 * Validation corpus: 21 response shapes (§4), ALL user-created synthetic
 * (provenance: generated in-repo, MIT, no third-party data — see
 * docs/autoeq-validation-corpus.md). Targets are flat or parametric-built.
 */

import type { FittingOptions } from "./autoeq";
import type { ResponseCurve } from "./curves";
import { buildParametricTarget } from "./curves";
import { sparseSample, synthMeasurement, truncateRange } from "./synth";

export interface CorpusCase {
	id: string;
	title: string;
	measurement: ResponseCurve;
	target: ResponseCurve;
	options?: Partial<FittingOptions> | undefined;
	/** Whether aggressive correction is even appropriate here. */
	appropriateness: string;
}

function flatTarget(): ResponseCurve {
	return { frequencies: [20, 1000, 20000], gains: [0, 0, 0] };
}

function tiltTarget(): ResponseCurve {
	return buildParametricTarget(
		{
			bassGainDb: 4,
			bassFreq: 105,
			tiltDbPerOctave: -0.5,
			tiltPivotFreq: 1000,
			offsetDb: 0,
		},
		128,
	);
}

export const CORPUS_VERSION = 1;

export function buildCorpus(): CorpusCase[] {
	const cases: CorpusCase[] = [];
	const add = (
		id: string,
		title: string,
		measurement: ResponseCurve,
		appropriateness: string,
		target: ResponseCurve = flatTarget(),
		options?: Partial<FittingOptions>,
	) => {
		cases.push({ id, title, measurement, target, options, appropriateness });
	};

	add(
		"01-flat",
		"Flat response",
		synthMeasurement([]),
		"Trivial: expect ~zero EQ.",
	);
	add(
		"02-bass-deficient",
		"Bass deficient (−6 dB shelf below 150 Hz)",
		synthMeasurement([{ type: "lowshelf", frequency: 150, gain: -6, q: 1 }]),
		"Appropriate: shelf recoverable.",
	);
	add(
		"03-bass-boosted",
		"Bass boosted (+9 dB shelf below 120 Hz)",
		synthMeasurement([{ type: "lowshelf", frequency: 120, gain: 9, q: 1 }]),
		"Appropriate with preamp compensation.",
	);
	add(
		"04-broad-bass-shelf",
		"Broad bass shelf (+5 dB, 200 Hz)",
		synthMeasurement([{ type: "lowshelf", frequency: 200, gain: 5, q: 1 }]),
		"Appropriate.",
	);
	add(
		"05-mid-dip",
		"Broad midrange dip (−4 dB peaking, 800 Hz, Q 0.8)",
		synthMeasurement([{ type: "peaking", frequency: 800, gain: -4, q: 0.8 }]),
		"Appropriate.",
	);
	add(
		"06-mid-elevation",
		"Broad midrange elevation (+4 dB peaking, 1.2 kHz, Q 0.9)",
		synthMeasurement([{ type: "peaking", frequency: 1200, gain: 4, q: 0.9 }]),
		"Appropriate.",
	);
	add(
		"07-narrow-3k-peak",
		"Narrow 3 kHz peak (+7 dB, Q 4)",
		synthMeasurement([{ type: "peaking", frequency: 3000, gain: 7, q: 4 }]),
		"Appropriate if real; risky if coupler artifact.",
	);
	add(
		"08-narrow-3k-dip",
		"Narrow 2.5 kHz dip (−8 dB, Q 5)",
		synthMeasurement([{ type: "peaking", frequency: 2500, gain: -8, q: 5 }]),
		"Caution: deep narrow dips often need no boost (phase/cancellation).",
	);
	add(
		"09-peak-6k",
		"5–8 kHz peak (+6 dB, 6.5 kHz, Q 3)",
		synthMeasurement([{ type: "peaking", frequency: 6500, gain: 6, q: 3 }]),
		"Appropriate with care near coupler limits.",
	);
	add(
		"10-treble-irregular",
		">8 kHz treble irregularity (peaks at 9/12/15 kHz)",
		synthMeasurement([
			{ type: "peaking", frequency: 9000, gain: 5, q: 4 },
			{ type: "peaking", frequency: 12000, gain: -4, q: 5 },
			{ type: "peaking", frequency: 15000, gain: 4, q: 6 },
		]),
		"Questionable: HF wiggles are often rig artifacts; averaging expected.",
	);
	add(
		"11-multi-treble",
		"Multiple treble peaks (7/9.5/13 kHz)",
		synthMeasurement([
			{ type: "peaking", frequency: 7000, gain: 4, q: 3 },
			{ type: "peaking", frequency: 9500, gain: 5, q: 3.5 },
			{ type: "peaking", frequency: 13000, gain: 3, q: 4 },
		]),
		"Partially appropriate; HF averaging limits aggressive fixes.",
	);
	add(
		"12-downward-slope",
		"Smooth downward slope (−1 dB/oct from 1 kHz)",
		synthMeasurement([], { tiltDbPerOctave: -1, tiltPivotHz: 1000 }),
		"Appropriate: tilt-like correction expected.",
	);
	add(
		"13-highly-uneven",
		"Highly uneven (6 alternating peaks/dips)",
		synthMeasurement([
			{ type: "peaking", frequency: 150, gain: 5, q: 1.2 },
			{ type: "peaking", frequency: 500, gain: -4, q: 2 },
			{ type: "peaking", frequency: 1200, gain: 4, q: 2.5 },
			{ type: "peaking", frequency: 2800, gain: -5, q: 3 },
			{ type: "peaking", frequency: 6000, gain: 4, q: 2 },
			{ type: "peaking", frequency: 11000, gain: -3, q: 3 },
		]),
		"Stress: band budget vs complexity tradeoff visible.",
	);
	add(
		"14-multi-broad",
		"Multiple broad deviations (bass shelf + mid dip + treble shelf)",
		synthMeasurement([
			{ type: "lowshelf", frequency: 150, gain: 4, q: 1 },
			{ type: "peaking", frequency: 900, gain: -3, q: 1 },
			{ type: "highshelf", frequency: 8000, gain: 3, q: 1 },
		]),
		"Appropriate: shelves + one peak.",
	);
	add(
		"15-multi-narrow",
		"Multiple narrow deviations (Q 4–6 at 2/4/7 kHz)",
		synthMeasurement([
			{ type: "peaking", frequency: 2000, gain: 5, q: 5 },
			{ type: "peaking", frequency: 4000, gain: -4, q: 4 },
			{ type: "peaking", frequency: 7000, gain: 4, q: 6 },
		]),
		"Caution: narrow-stack overfitting risk.",
	);
	add(
		"16-combined",
		"Combined bass + mid + treble deviations",
		synthMeasurement(
			[
				{ type: "lowshelf", frequency: 120, gain: 6, q: 1 },
				{ type: "peaking", frequency: 1000, gain: -3, q: 1.2 },
				{ type: "peaking", frequency: 6500, gain: 5, q: 2.5 },
			],
			{ tiltDbPerOctave: -0.3 },
		),
		"Realistic full-range IEM-like shape.",
		flatTarget(),
		{ maxBands: 10 },
	);
	add(
		"17-sparse",
		"Sparse measurement (every 8th point of a 3-peak curve)",
		sparseSample(
			synthMeasurement([
				{ type: "peaking", frequency: 300, gain: 4, q: 1 },
				{ type: "peaking", frequency: 2500, gain: -5, q: 2 },
				{ type: "peaking", frequency: 8000, gain: 3, q: 2 },
			]),
			8,
		),
		"Appropriate: interpolation must bridge gaps.",
	);
	add(
		"18-noisy",
		"Noisy measurement (±1.5 dB seeded noise on smooth curve)",
		synthMeasurement([{ type: "peaking", frequency: 1000, gain: 3, q: 1 }], {
			noiseDb: 1.5,
			seed: 7,
		}),
		"Caution: must not chase noise wiggles.",
	);
	add(
		"19-truncated-hf",
		"Truncated at 12 kHz (realistic rig limit)",
		truncateRange(
			synthMeasurement([{ type: "peaking", frequency: 3000, gain: 5, q: 2 }]),
			20,
			12000,
		),
		"Must clamp fitting range, never extrapolate.",
	);
	add(
		"20-truncated-lf",
		"Truncated below 50 Hz",
		truncateRange(
			synthMeasurement([{ type: "lowshelf", frequency: 100, gain: 5, q: 1 }]),
			50,
			20000,
		),
		"Must clamp fitting range, never extrapolate.",
	);
	add(
		"21-extreme-plausible",
		"Extreme but plausible (+12 dB bass, −10 dB 3 kHz notch-ish, +8 dB air)",
		synthMeasurement([
			{ type: "lowshelf", frequency: 100, gain: 12, q: 1 },
			{ type: "peaking", frequency: 3000, gain: -10, q: 3 },
			{ type: "highshelf", frequency: 12000, gain: 8, q: 1 },
		]),
		"Stress: bounds, preamp, and headroom behavior.",
	);
	add(
		"22-tilt-target",
		"Mid dip against tilted parametric target",
		synthMeasurement([{ type: "peaking", frequency: 900, gain: -4, q: 1 }]),
		"Target-variation probe.",
		tiltTarget(),
	);
	return cases;
}
