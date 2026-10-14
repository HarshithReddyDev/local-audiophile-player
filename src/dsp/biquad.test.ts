import { describe, expect, it } from "vitest";
import { createBiquad } from "./biquad";
import { biquadMagnitudeDb } from "./response";
import type { EQBand } from "./types";
import { isStable, UNITY_BIQUAD } from "./types";

function band(overrides: Partial<EQBand> = {}): EQBand {
	return {
		id: "test",
		type: "peaking",
		frequency: 1000,
		gain: 0,
		q: 1,
		enabled: true,
		...overrides,
	};
}

describe("createBiquad", () => {
	it("returns unity for degenerate input, never NaN", () => {
		const bad: EQBand[] = [
			band({ frequency: Number.NaN }),
			band({ frequency: Number.POSITIVE_INFINITY }),
			band({ gain: Number.NaN }),
			band({ q: 0 }),
			band({ q: Number.NaN }),
			band({ type: "peaking", frequency: -100 }),
		];
		for (const b of bad) {
			const c = createBiquad(b, 48000);
			expect([c.b0, c.b1, c.b2, c.a1, c.a2].every(Number.isFinite)).toBe(true);
		}
		expect(createBiquad(band({ frequency: Number.NaN }), 48000)).toEqual(
			UNITY_BIQUAD,
		);
		expect(createBiquad(band(), Number.NaN)).toEqual(UNITY_BIQUAD);
	});

	it("renders a flat response at 0 dB gain (pole-zero cancellation, not raw unity)", () => {
		// NOTE: 0 dB coefficients are NOT (1,0,0,0,0) — e.g. peaking keeps
		// b1/a1 terms that cancel exactly. Flatness is the correct assertion.
		for (const type of ["peaking", "lowshelf", "highshelf"] as const) {
			const c = createBiquad(band({ type, gain: 0 }), 48000);
			for (const f of [20, 100, 1000, 10000, 20000]) {
				expect(biquadMagnitudeDb(c, f, 48000)).toBeCloseTo(0, 9);
			}
		}
	});

	it("produces stable filters over a wide parameter grid", () => {
		const types = [
			"peaking",
			"lowshelf",
			"highshelf",
			"lowpass",
			"highpass",
			"notch",
			"bandpass",
		] as const;
		for (const type of types) {
			for (const frequency of [20, 100, 1000, 10000, 20000]) {
				for (const q of [0.1, 0.7071, 1, 5, 20]) {
					for (const gain of [-12, 0, 12]) {
						for (const fs of [44100, 48000, 96000]) {
							const c = createBiquad(band({ type, frequency, q, gain }), fs);
							expect(isStable(c)).toBe(true);
						}
					}
				}
			}
		}
	});

	it("ignores gain for non-gain filter types", () => {
		for (const type of ["lowpass", "highpass", "notch", "bandpass"] as const) {
			const a = createBiquad(band({ type, gain: 6 }), 48000);
			const b = createBiquad(band({ type, gain: -6 }), 48000);
			expect(a).toEqual(b);
		}
	});

	it("ignores Q for shelving filters (node parity)", () => {
		for (const type of ["lowshelf", "highshelf"] as const) {
			const a = createBiquad(band({ type, gain: 6, q: 0.5 }), 48000);
			const b = createBiquad(band({ type, gain: 6, q: 5 }), 48000);
			expect(a).toEqual(b);
		}
	});
});

describe("definitional response checks", () => {
	it("peaking hits its gain exactly at center", () => {
		const c = createBiquad(
			band({ type: "peaking", frequency: 1000, gain: 6, q: 1 }),
			48000,
		);
		expect(biquadMagnitudeDb(c, 1000, 48000)).toBeCloseTo(6, 4);
		const cut = createBiquad(
			band({ type: "peaking", frequency: 1000, gain: -6, q: 1 }),
			48000,
		);
		expect(biquadMagnitudeDb(cut, 1000, 48000)).toBeCloseTo(-6, 4);
	});

	it("lowshelf reaches gain at DC and unity at Nyquist", () => {
		const c = createBiquad(
			band({ type: "lowshelf", frequency: 200, gain: 6 }),
			48000,
		);
		expect(biquadMagnitudeDb(c, 5, 48000)).toBeCloseTo(6, 1);
		expect(biquadMagnitudeDb(c, 23999, 48000)).toBeCloseTo(0, 1);
	});

	it("highshelf reaches gain at Nyquist and unity at DC", () => {
		const c = createBiquad(
			band({ type: "highshelf", frequency: 8000, gain: -5 }),
			48000,
		);
		expect(biquadMagnitudeDb(c, 23999, 48000)).toBeCloseTo(-5, 1);
		expect(biquadMagnitudeDb(c, 5, 48000)).toBeCloseTo(0, 1);
	});

	it("lowpass/highpass follow the Web Audio α_QdB convention, not textbook RBJ", () => {
		// Spec-anchored: Chromium's getFrequencyResponse reads +0.71 dB here.
		const hp = createBiquad(
			band({ type: "highpass", frequency: 1000, q: 0.7071 }),
			48000,
		);
		expect(biquadMagnitudeDb(hp, 1000, 48000)).toBeCloseTo(0.71, 1);
		const lp = createBiquad(
			band({ type: "lowpass", frequency: 1000, q: 0.7071 }),
			48000,
		);
		expect(biquadMagnitudeDb(lp, 1000, 48000)).toBeCloseTo(0.71, 1);
	});

	it("lowpass/highpass/notch extremes", () => {
		const lp2 = createBiquad(
			band({ type: "lowpass", frequency: 1000, q: 0.7071 }),
			48000,
		);
		expect(biquadMagnitudeDb(lp2, 10, 48000)).toBeCloseTo(0, 1);
		expect(biquadMagnitudeDb(lp2, 20000, 48000)).toBeLessThan(-60);
		const hp = createBiquad(
			band({ type: "highpass", frequency: 1000, q: 0.7071 }),
			48000,
		);
		expect(biquadMagnitudeDb(hp, 20000, 48000)).toBeCloseTo(0, 1);
		expect(biquadMagnitudeDb(hp, 10, 48000)).toBeLessThan(-60);
		const notch = createBiquad(
			band({ type: "notch", frequency: 1000, q: 10 }),
			48000,
		);
		expect(biquadMagnitudeDb(notch, 1000, 48000)).toBeLessThan(-40);
		expect(biquadMagnitudeDb(notch, 50, 48000)).toBeCloseTo(0, 1);
		const bp = createBiquad(
			band({ type: "bandpass", frequency: 1000, q: 1 }),
			48000,
		);
		expect(biquadMagnitudeDb(bp, 1000, 48000)).toBeCloseTo(0, 1);
	});
});
