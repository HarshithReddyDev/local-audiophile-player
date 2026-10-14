import { describe, expect, it } from "vitest";
import { peqMagnitudeDb } from "./response";
import type { PEQProfile } from "./types";

/**
 * Golden reference cases (§28). Each stores the defining expectation with a
 * tolerance derived from float64 precision — not from the implementation
 * under test (all values follow directly from the RBJ definitions in
 * docs/dsp-research.md).
 */
const FS = 48000;

function profile(bands: PEQProfile["bands"], preamp = 0): PEQProfile {
	return { preamp, enabled: true, bands };
}

describe("DSP golden cases", () => {
	it("Case 1: 0 dB peaking is a flat wire", () => {
		const p = profile([
			{
				id: "g1",
				type: "peaking",
				frequency: 1000,
				gain: 0,
				q: 1,
				enabled: true,
			},
		]);
		for (const f of [20, 100, 1000, 10000, 20000]) {
			expect(peqMagnitudeDb(p, f, FS)).toBeCloseTo(0, 9);
		}
	});

	it("Case 2: +6 dB peaking at 1 kHz, Q 1", () => {
		const p = profile([
			{
				id: "g2",
				type: "peaking",
				frequency: 1000,
				gain: 6,
				q: 1,
				enabled: true,
			},
		]);
		// Center hits the specified gain; skirts fall symmetrically-ish.
		expect(peqMagnitudeDb(p, 1000, FS)).toBeCloseTo(6, 4);
		const at100 = peqMagnitudeDb(p, 100, FS);
		const at10000 = peqMagnitudeDb(p, 10000, FS);
		expect(at100).toBeGreaterThan(0);
		expect(at100).toBeLessThan(1);
		expect(at10000).toBeGreaterThan(0);
		expect(at10000).toBeLessThan(1);
		// Far-field returns to unity.
		expect(peqMagnitudeDb(p, 20, FS)).toBeCloseTo(0, 1);
		expect(peqMagnitudeDb(p, 20000, FS)).toBeCloseTo(0, 1);
	});

	it("Case 3: −5 dB low shelf at 200 Hz attenuates lows", () => {
		const p = profile([
			{
				id: "g3",
				type: "lowshelf",
				frequency: 200,
				gain: -5,
				q: 1,
				enabled: true,
			},
		]);
		expect(peqMagnitudeDb(p, 20, FS)).toBeCloseTo(-5, 1);
		expect(peqMagnitudeDb(p, 20000, FS)).toBeCloseTo(0, 1);
		// Midpoint of the transition carries roughly half the gain.
		const mid = peqMagnitudeDb(p, 200, FS);
		expect(mid).toBeGreaterThan(-4);
		expect(mid).toBeLessThan(-1);
	});

	it("Case 4: +4 dB high shelf at 8 kHz lifts highs", () => {
		const p = profile([
			{
				id: "g4",
				type: "highshelf",
				frequency: 8000,
				gain: 4,
				q: 1,
				enabled: true,
			},
		]);
		expect(peqMagnitudeDb(p, 20000, FS)).toBeCloseTo(4, 1);
		expect(peqMagnitudeDb(p, 20, FS)).toBeCloseTo(0, 1);
	});
});
