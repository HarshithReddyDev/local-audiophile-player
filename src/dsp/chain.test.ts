import { describe, expect, it } from "vitest";
import { PEQChain } from "./chain";
import { clampCeiling, PeakLimiter } from "./limiter";
import {
	clampPreamp,
	dbToGain,
	gainToDb,
	suggestedPreampCompensation,
} from "./preamp";
import type { EQBand } from "./types";

function band(overrides: Partial<EQBand> = {}): EQBand {
	return {
		id: "t",
		type: "peaking",
		frequency: 1000,
		gain: 0,
		q: 1,
		enabled: true,
		...overrides,
	};
}

describe("preamp", () => {
	it("converts and clamps", () => {
		expect(dbToGain(0)).toBe(1);
		expect(dbToGain(6)).toBeCloseTo(1.9953, 4);
		expect(gainToDb(1)).toBe(0);
		expect(gainToDb(0)).toBe(Number.NEGATIVE_INFINITY);
		expect(clampPreamp(99)).toBe(24);
		expect(clampPreamp(Number.NaN)).toBe(0);
		expect(suggestedPreampCompensation(6)).toBe(-6);
		expect(suggestedPreampCompensation(-2)).toBe(0);
	});
});

describe("limiter", () => {
	it("passes quiet audio untouched", () => {
		const limiter = new PeakLimiter({ ceilingDb: -1 }, 48000);
		const x = new Float64Array(4096).map((_, i) => 0.5 * Math.sin(i * 0.05));
		const before = Float64Array.from(x);
		limiter.process([x], x.length);
		for (let i = 512; i < x.length; i++) {
			expect(x[i] ?? 0).toBeCloseTo(before[i] ?? 0, 6);
		}
	});

	it("bounds hot bursts at the ceiling and recovers", () => {
		const limiter = new PeakLimiter({ ceilingDb: -1 }, 48000);
		const ceiling = 10 ** (-1 / 20);
		const burst = new Float64Array(4800).map((_, i) => 4 * Math.sin(i * 0.1));
		limiter.process([burst], burst.length);
		expect([...burst].every(Number.isFinite)).toBe(true);
		const peak = Math.max(...burst.map(Math.abs));
		// Instant attack: strictly bounded at the ceiling (float rounding only).
		expect(peak).toBeLessThanOrEqual(ceiling * 1.001);
		// Release: quiet audio returns to unity gain.
		const tail = new Float64Array(48000).map(
			(_, i) => 0.5 * Math.sin(i * 0.05),
		);
		limiter.process([tail], tail.length);
		expect(
			Math.abs(
				(tail[tail.length - 1] ?? 0) - 0.5 * Math.sin((tail.length - 1) * 0.05),
			),
		).toBeLessThan(0.05);
	});

	it("survives silence, impulses, and garbage", () => {
		const limiter = new PeakLimiter({}, 48000);
		const silence = new Float64Array(1024);
		limiter.process([silence], silence.length);
		expect([...silence].every((v) => v === 0)).toBe(true);
		const impulse = new Float64Array(1024);
		impulse[0] = 100;
		limiter.process([impulse], impulse.length);
		expect([...impulse].every(Number.isFinite)).toBe(true);
		expect(clampCeiling(Number.NaN)).toBe(-1);
		expect(clampCeiling(99)).toBe(0);
	});
});

describe("PEQChain", () => {
	it("counts only enabled bands and passes flat audio through", () => {
		const chain = new PEQChain({
			bands: [band({ id: "a" }), { ...band({ id: "b" }), enabled: false }],
			preampDb: 0,
			sampleRate: 48000,
			channels: 2,
			limiterCeilingDb: -1,
		});
		expect(chain.bandCount).toBe(1);
		const left = new Float64Array(1024).map((_, i) => 0.3 * Math.sin(i * 0.07));
		const right = Float64Array.from(left);
		const before = Float64Array.from(left);
		chain.process([left, right], 1024);
		for (let i = 100; i < 1024; i++) {
			expect(left[i] ?? 0).toBeCloseTo(before[i] ?? 0, 9);
		}
	});

	it("applies preamp gain and rebuilds on configure", () => {
		const chain = new PEQChain({
			bands: [],
			preampDb: 6,
			sampleRate: 48000,
			channels: 1,
			limiterCeilingDb: 0,
		});
		const x = new Float64Array(512).fill(0.25);
		chain.process([x], x.length);
		expect(x[100] ?? 0).toBeCloseTo(0.25 * dbToGain(6), 9);
		chain.configure(
			[band({ type: "peaking", frequency: 100, gain: -96 })],
			-96,
		);
		expect(chain.bandCount).toBe(1);
	});
});
