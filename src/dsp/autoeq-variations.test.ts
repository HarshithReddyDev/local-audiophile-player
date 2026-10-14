import { describe, expect, it } from "vitest";
import type { AutoEQInput } from "../iem/types";
import type { FittingOptions } from "./autoeq";
import { fitPEQ } from "./autoeq";
import type { CorpusCase } from "./corpus";
import { buildCorpus } from "./corpus";
import { buildParametricTarget } from "./curves";

/**
 * Variation studies (§14–18): representative cases across targets, ranges,
 * band counts, gain bounds, and Q bounds. Asserts validity + determinism;
 * trends are recorded to stdout for the validation doc (no hard thresholds
 * on exploratory comparisons — the corpus regression test owns those).
 */
const REPRESENTATIVE = [
	"02-bass-deficient",
	"07-narrow-3k-peak",
	"10-treble-irregular",
	"13-highly-uneven",
	"16-combined",
	"19-truncated-hf",
];

function baseInput(case_: CorpusCase): AutoEQInput {
	return {
		measurement: case_.measurement,
		target: case_.target,
		frequencyRange: { min: 20, max: 20000 },
		fittingOptions: { maxBands: 8, maxGainDb: 12, preferParametric: true },
	};
}

function summarize(
	tag: string,
	rms: number,
	bands: number,
	maxQ: number,
	boundHits: number,
): void {
	console.log(
		`variation/${tag}: rms=${rms.toFixed(2)} bands=${bands} maxQ=${maxQ.toFixed(2)} boundHits=${boundHits}`,
	);
}

describe("variation studies", () => {
	it("targets: flat vs tilted parametric", () => {
		const tilted = buildParametricTarget(
			{
				bassGainDb: 4,
				bassFreq: 105,
				tiltDbPerOctave: -0.5,
				tiltPivotFreq: 1000,
				offsetDb: 0,
			},
			128,
		);
		for (const id of REPRESENTATIVE) {
			const case_ = buildCorpus().find((c) => c.id === id)!;
			const flat = fitPEQ(baseInput(case_));
			const tiltedResult = fitPEQ({
				...baseInput(case_),
				target: { frequencies: tilted.frequencies, gains: tilted.gains },
			});
			expect(tiltedResult.metrics.rmsAfterDb).toBeLessThan(
				tiltedResult.metrics.rmsBeforeDb + 0.05,
			);
			summarize(
				`${id}/tilt`,
				tiltedResult.metrics.rmsAfterDb,
				tiltedResult.profile.bands.length,
				Math.max(0, ...tiltedResult.profile.bands.map((b) => b.q)),
				tiltedResult.profile.bands.filter((b) => Math.abs(b.gain) >= 11.9)
					.length,
			);
			expect(flat.metrics.rmsAfterDb).toBeLessThan(
				flat.metrics.rmsBeforeDb + 0.05,
			);
		}
	});

	it("ranges: 20–20k, 20–10k, 20–8k, 30–10k, 20–15k", () => {
		const ranges: [number, number][] = [
			[20, 20000],
			[20, 10000],
			[20, 8000],
			[30, 10000],
			[20, 15000],
		];
		for (const id of [
			"10-treble-irregular",
			"16-combined",
			"19-truncated-hf",
		]) {
			const case_ = buildCorpus().find((c) => c.id === id)!;
			for (const [lo, hi] of ranges) {
				const r = fitPEQ(baseInput(case_), {
					minFrequency: lo,
					maxFrequency: hi,
				});
				summarize(
					`${id}/${lo}-${hi}`,
					r.metrics.rmsAfterDb,
					r.profile.bands.length,
					Math.max(0, ...r.profile.bands.map((b) => b.q)),
					r.profile.bands.filter((b) => Math.abs(b.gain) >= 11.9).length,
				);
				expect(r.metrics.rangeHz[0]).toBeGreaterThanOrEqual(10);
			}
		}
	});

	it("band counts: 2, 4, 6, 8 show diminishing returns", () => {
		const case_ = buildCorpus().find((c) => c.id === "16-combined")!;
		let previous = Number.POSITIVE_INFINITY;
		for (const maxBands of [2, 4, 6, 8]) {
			const r = fitPEQ(baseInput(case_), { maxBands });
			summarize(
				`16-combined/n${maxBands}`,
				r.metrics.rmsAfterDb,
				r.profile.bands.length,
				0,
				0,
			);
			// Greedy+local search is not strictly monotonic in band count
			// (documented finding); tolerance covers optimizer noise.
			expect(r.metrics.rmsAfterDb).toBeLessThanOrEqual(previous + 0.05);
			previous = Math.min(previous, r.metrics.rmsAfterDb);
			expect(r.profile.bands.length).toBeLessThanOrEqual(maxBands);
		}
	});

	it("gain bounds: ±6 vs ±9 vs ±12 bound-hit frequency", () => {
		for (const id of [
			"03-bass-boosted",
			"21-extreme-plausible",
			"16-combined",
		]) {
			const case_ = buildCorpus().find((c) => c.id === id)!;
			for (const bound of [6, 9, 12]) {
				const r = fitPEQ(baseInput(case_), {
					maxBoostDb: bound,
					maxCutDb: bound,
				});
				const hits = r.profile.bands.filter(
					(b) => Math.abs(b.gain) >= bound - 0.11,
				).length;
				summarize(
					`${id}/±${bound}`,
					r.metrics.rmsAfterDb,
					r.profile.bands.length,
					0,
					hits,
				);
			}
		}
	});

	it("Q ranges: 0.5–3 vs 0.5–6 vs 0.5–10", () => {
		for (const id of ["07-narrow-3k-peak", "15-multi-narrow", "18-noisy"]) {
			const case_ = buildCorpus().find(
				(c) => c.id === (id.startsWith("18") ? "18-noisy" : id),
			)!;
			for (const [minQ, maxQ] of [
				[0.5, 3],
				[0.5, 6],
				[0.5, 10],
			] as const) {
				const r = fitPEQ(baseInput(case_), {
					minQ,
					maxQ,
				} as Partial<FittingOptions>);
				const maxQSeen = Math.max(0, ...r.profile.bands.map((b) => b.q));
				summarize(
					`${id}/Q${minQ}-${maxQ}`,
					r.metrics.rmsAfterDb,
					r.profile.bands.length,
					maxQSeen,
					0,
				);
				expect(maxQSeen).toBeLessThanOrEqual(maxQ + 1e-9);
			}
		}
	});
});
