import { describe, expect, it } from "vitest";
import type { AutoEQInput } from "../iem/types";
import { AutoEQError, fitPEQ, OPTIMIZER_VERSION } from "./autoeq";
import { createBiquad } from "./biquad";
import type { ResponseCurve } from "./curves";
import { biquadMagnitudeDb } from "./response";

function flat(value: number, points = 64): ResponseCurve {
	const frequencies: number[] = [];
	const gains: number[] = [];
	for (let i = 0; i < points; i++) {
		frequencies.push(20 * (20000 / 20) ** (i / (points - 1)));
		gains.push(value);
	}
	return { frequencies, gains };
}

function input(measurement: ResponseCurve, target: ResponseCurve): AutoEQInput {
	return {
		measurement,
		target,
		frequencyRange: { min: 20, max: 20000 },
		fittingOptions: { maxBands: 8, maxGainDb: 12, preferParametric: true },
	};
}

describe("AutoEQ golden cases", () => {
	it("Case 1: flat + flat → approximately zero EQ", () => {
		const result = fitPEQ(input(flat(0), flat(0)));
		expect(result.metrics.rmsAfterDb).toBeCloseTo(0, 6);
		expect(result.profile.bands).toHaveLength(0);
		expect(result.profile.preamp).toBe(0);
		expect(result.metrics.optimizerVersion).toBe(OPTIMIZER_VERSION);
	});

	it("Case 2: +3 dB constant → approximately −3 dB correction", () => {
		const result = fitPEQ(input(flat(3), flat(0)));
		expect(result.metrics.rmsAfterDb).toBeLessThan(0.5);
		expect(result.profile.preamp).toBeLessThanOrEqual(0);
		// Correction + preamp must not demand headroom (response-level contract).
		expect(
			result.metrics.maxBoostDb + result.profile.preamp,
		).toBeLessThanOrEqual(0.01);
	});

	it("Case 3: known +6 dB peaking deviation recovers the inverse", () => {
		// Synthetic measurement = inverse of a known filter + flat target.
		const known = {
			id: "k",
			type: "peaking" as const,
			frequency: 1000,
			gain: 6,
			q: 1,
			enabled: true,
		};
		const frequencies: number[] = [];
		const gains: number[] = [];
		for (let i = 0; i < 96; i++) {
			const f = 20 * (20000 / 20) ** (i / 95);
			frequencies.push(f);
			gains.push(biquadMagnitudeDb(createBiquad(known, 48000), f, 48000));
		}
		const result = fitPEQ(input({ frequencies, gains }, flat(0)), {
			maxBands: 4,
		});
		expect(result.metrics.rmsAfterDb).toBeLessThan(0.4);
		// The dominant band should sit near the true center with negative gain.
		const strongest = [...result.profile.bands].sort(
			(a, b) => Math.abs(b.gain) - Math.abs(a.gain),
		)[0];
		expect(strongest).toBeDefined();
		expect(
			Math.abs(Math.log2((strongest?.frequency ?? 0) / 1000)),
		).toBeLessThan(0.5);
		expect(strongest?.gain ?? 0).toBeLessThan(-3);
	});

	it("Case 4: known low-shelf deviation recovers an inverse shelf", () => {
		const known = {
			id: "k",
			type: "lowshelf" as const,
			frequency: 150,
			gain: 6,
			q: 1,
			enabled: true,
		};
		const frequencies: number[] = [];
		const gains: number[] = [];
		for (let i = 0; i < 96; i++) {
			const f = 20 * (20000 / 20) ** (i / 95);
			frequencies.push(f);
			gains.push(biquadMagnitudeDb(createBiquad(known, 48000), f, 48000));
		}
		const result = fitPEQ(input({ frequencies, gains }, flat(0)), {
			maxBands: 4,
		});
		expect(result.metrics.rmsAfterDb).toBeLessThan(0.5);
		expect(
			result.profile.bands.some((b) => b.type === "lowshelf" && b.gain < 0),
		).toBe(true);
	});

	it("Case 5: multi-filter deviation reaches low residual", () => {
		const known = [
			{
				id: "a",
				type: "lowshelf" as const,
				frequency: 120,
				gain: 5,
				q: 1,
				enabled: true,
			},
			{
				id: "b",
				type: "peaking" as const,
				frequency: 800,
				gain: -4,
				q: 2,
				enabled: true,
			},
			{
				id: "c",
				type: "peaking" as const,
				frequency: 3500,
				gain: 3,
				q: 1.5,
				enabled: true,
			},
		];
		const frequencies: number[] = [];
		const gains: number[] = [];
		for (let i = 0; i < 128; i++) {
			const f = 20 * (20000 / 20) ** (i / 127);
			frequencies.push(f);
			let g = 0;
			for (const k of known)
				g += biquadMagnitudeDb(createBiquad(k, 48000), f, 48000);
			gains.push(g);
		}
		const before = Math.sqrt(
			gains.reduce((s, g) => s + g * g, 0) / gains.length,
		);
		const result = fitPEQ(input({ frequencies, gains }, flat(0)), {
			maxBands: 8,
		});
		expect(result.metrics.rmsAfterDb).toBeLessThan(before / 3);
		expect(result.profile.bands.length).toBeLessThanOrEqual(8);
	});
});

describe("AutoEQ sanity and errors", () => {
	it("rejects malformed input with reasons", () => {
		expect(() =>
			fitPEQ(input({ frequencies: [20], gains: [0] }, flat(0))),
		).toThrow(AutoEQError);
		expect(() => fitPEQ(input(flat(0), flat(0)), { maxBands: 0 })).toThrow(
			/at least 1/,
		);
		expect(() =>
			fitPEQ(
				{
					measurement: flat(0),
					target: flat(0),
					frequencyRange: { min: 1000, max: 1100 },
					fittingOptions: {
						maxBands: 4,
						maxGainDb: 12,
						preferParametric: true,
					},
				},
				{ minFrequency: 1000, maxFrequency: 1100 },
			),
		).toThrow(/too narrow/);
	});

	it("is deterministic across runs", () => {
		const known = {
			id: "k",
			type: "peaking" as const,
			frequency: 2000,
			gain: -5,
			q: 2,
			enabled: true,
		};
		const frequencies: number[] = [];
		const gains: number[] = [];
		for (let i = 0; i < 96; i++) {
			const f = 20 * (20000 / 20) ** (i / 95);
			frequencies.push(f);
			gains.push(biquadMagnitudeDb(createBiquad(known, 48000), f, 48000));
		}
		const a = fitPEQ(input({ frequencies, gains }, flat(0)));
		const b = fitPEQ(input({ frequencies, gains }, flat(0)));
		// Wall-clock timing excluded by design; everything else (including
		// serialized bands, which carry no random ids) must match exactly.
		const scrub = (r: typeof a) => ({
			...r,
			metrics: { ...r.metrics, elapsedMs: 0 },
		});
		expect(JSON.stringify(scrub(a))).toBe(JSON.stringify(scrub(b)));
	});

	it("respects band, gain, and Q bounds", () => {
		const result = fitPEQ(input(flat(8), flat(0)), {
			maxBands: 5,
			maxBoostDb: 6,
			maxCutDb: 6,
			minQ: 0.5,
			maxQ: 6,
		});
		expect(result.profile.bands.length).toBeLessThanOrEqual(5);
		for (const band of result.profile.bands) {
			expect(band.gain).toBeGreaterThanOrEqual(-6.01);
			expect(band.gain).toBeLessThanOrEqual(6.01);
			expect(band.q).toBeGreaterThanOrEqual(0.5 - 1e-9);
			expect(band.q).toBeLessThanOrEqual(6 + 1e-9);
			expect(band.frequency).toBeGreaterThanOrEqual(20);
			expect(band.frequency).toBeLessThanOrEqual(10000);
		}
	});

	it("supports cancellation", () => {
		let calls = 0;
		const result = fitPEQ(
			input(flat(8), flat(0)),
			{},
			{
				shouldCancel: () => ++calls > 2,
			},
		);
		expect(result.metrics.cancelled).toBe(true);
	});
});
