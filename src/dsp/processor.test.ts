import { describe, expect, it } from "vitest";
import { createBiquad } from "./biquad";
import { BiquadProcessor } from "./processor";
import type { EQBand } from "./types";

function band(overrides: Partial<EQBand> = {}): EQBand {
	return {
		id: "t",
		type: "lowpass",
		frequency: 1000,
		gain: 0,
		q: 0.7071,
		enabled: true,
		...overrides,
	};
}

function impulse(length: number): Float64Array {
	const x = new Float64Array(length);
	x[0] = 1;
	return x;
}

function rms(x: Float64Array, from: number, to: number): number {
	let sum = 0;
	for (let i = from; i < to; i++) sum += (x[i] ?? 0) ** 2;
	return Math.sqrt(sum / Math.max(1, to - from));
}

describe("BiquadProcessor", () => {
	it("passes impulse response finite and bounded", () => {
		const proc = new BiquadProcessor(1);
		proc.setCoefficients(createBiquad(band(), 48000));
		const x = impulse(4096);
		proc.process([x], x.length);
		expect([...x].every(Number.isFinite)).toBe(true);
		expect(Math.max(...x.map(Math.abs))).toBeLessThan(2);
		// Lowpass impulse energy decays: tail quieter than head.
		expect(rms(x, 3000, 4096)).toBeLessThan(rms(x, 0, 1000));
	});

	it("highpass step decays toward zero (no DC leak)", () => {
		const proc = new BiquadProcessor(1);
		proc.setCoefficients(
			createBiquad(band({ type: "highpass", frequency: 200 }), 48000),
		);
		const x = new Float64Array(8192).fill(1);
		proc.process([x], x.length);
		expect([...x].every(Number.isFinite)).toBe(true);
		expect(Math.abs(x[x.length - 1] ?? 1)).toBeLessThan(0.01);
	});

	it("processes channels independently and reset clears state", () => {
		const proc = new BiquadProcessor(2);
		proc.setCoefficients(
			createBiquad(
				band({ type: "peaking", frequency: 1000, gain: 12, q: 1 }),
				48000,
			),
		);
		const left = impulse(256);
		const right = new Float64Array(256);
		proc.process([left, right], 256);
		// Right (silence in) stays silent: no cross-channel leakage.
		expect(rms(right, 0, 256)).toBe(0);
		expect(rms(left, 0, 256)).toBeGreaterThan(0);
		proc.reset();
		const again = impulse(256);
		proc.process([again], 1);
		expect(again[0]).toBeCloseTo(left[0] ?? 0, 12);
	});

	it("unity coefficients pass audio through", () => {
		const proc = new BiquadProcessor(1);
		proc.setCoefficients({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 });
		const x = Float64Array.from([0.5, -0.25, 0.125, 0]);
		proc.process([x], x.length);
		expect([...x]).toEqual([0.5, -0.25, 0.125, 0]);
	});

	it("is deterministic across instances", () => {
		const make = () => {
			const p = new BiquadProcessor(2);
			p.setCoefficients(
				createBiquad(
					band({ type: "highshelf", frequency: 8000, gain: -4 }),
					44100,
				),
			);
			return p;
		};
		const a = new Float64Array(1024).map((_, i) => Math.sin(i * 0.1));
		const b = Float64Array.from(a);
		make().process([a], a.length);
		make().process([b], b.length);
		expect([...a]).toEqual([...b]);
	});
});
