import { describe, expect, it } from "vitest";
import {
	countExtrema,
	resolveSmoothingWindow,
	SMOOTHING_PRESETS,
	SmoothingError,
	smoothByPreset,
	smoothingDeviation,
	smoothResponseCurve,
} from "./smoothing";
import { logGrid, synthMeasurement, truncateRange } from "./synth";

/**
 * Phase 8D unit suite: the pure smoothing core. No optimizer, no fixtures —
 * just the math (purity, determinism, bounds, edges, density, performance).
 * Corpus behavior lives in autoeq-smoothing.test.ts.
 */

function noisy(pts = 200): { frequencies: number[]; gains: number[] } {
	return synthMeasurement(
		[{ type: "peaking", frequency: 1000, gain: 3, q: 1 }],
		{ points: pts, noiseDb: 1.5, seed: 7 },
	);
}

describe("smoothing presets", () => {
	it("exposes Off/Light/Moderate with exact documented windows", () => {
		expect(SMOOTHING_PRESETS.map((p) => p.id)).toEqual([
			"off",
			"light",
			"moderate",
		]);
		expect(resolveSmoothingWindow("off")).toBe(0);
		expect(resolveSmoothingWindow("light")).toBeCloseTo(1 / 12, 12);
		expect(resolveSmoothingWindow("moderate")).toBeCloseTo(1 / 6, 12);
		expect(resolveSmoothingWindow("nope" as never)).toBe(0);
		for (const preset of SMOOTHING_PRESETS) {
			expect(preset.label.length).toBeGreaterThan(0);
			expect(preset.description.length).toBeGreaterThan(0);
		}
	});
});

describe("smoothing purity and determinism (§5, §24)", () => {
	it("never mutates input and is byte-identical across runs", () => {
		const raw = noisy();
		const freqCopy = [...raw.frequencies];
		const gainCopy = [...raw.gains];
		const once = smoothResponseCurve(raw, 1 / 12);
		const twice = smoothResponseCurve(raw, 1 / 12);
		expect(raw.frequencies).toEqual(freqCopy);
		expect(raw.gains).toEqual(gainCopy);
		expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
		expect(smoothByPreset(raw, "light")).toEqual(once);
	});

	it("window <= 0 returns an exact copy (the Off path)", () => {
		const raw = noisy();
		for (const w of [0, -1]) {
			const out = smoothResponseCurve(raw, w);
			expect(out.frequencies).toEqual(raw.frequencies);
			expect(out.gains).toEqual(raw.gains);
			expect(out.frequencies).not.toBe(raw.frequencies);
		}
		const dev = smoothingDeviation(raw, smoothByPreset(raw, "off"));
		expect(dev.rmsDb).toBe(0);
		expect(dev.maxAbsDb).toBe(0);
	});

	it("flat stays flat; finite in, finite out", () => {
		const flat = {
			frequencies: logGrid(64),
			gains: Array.from({ length: 64 }, () => 2.5),
		};
		for (const preset of ["light", "moderate"] as const) {
			const out = smoothByPreset(flat, preset);
			expect(out.frequencies.length).toBeGreaterThan(0);
			for (const g of out.gains) {
				expect(Number.isFinite(g)).toBe(true);
				expect(g).toBeCloseTo(2.5, 9);
			}
		}
	});

	it("rejects unusable input explicitly", () => {
		expect(() =>
			smoothResponseCurve({ frequencies: [], gains: [] }, 1 / 12),
		).toThrow(SmoothingError);
		expect(() =>
			smoothResponseCurve({ frequencies: [100], gains: [0] }, 1 / 12),
		).toThrow(SmoothingError);
	});
});

describe("smoothing quality properties (§30)", () => {
	it("never overshoots: output stays within the input range", () => {
		const raw = noisy();
		const lo = Math.min(...raw.gains);
		const hi = Math.max(...raw.gains);
		for (const preset of ["light", "moderate"] as const) {
			const out = smoothByPreset(raw, preset);
			for (const g of out.gains) {
				expect(g).toBeGreaterThanOrEqual(lo - 1e-9);
				expect(g).toBeLessThanOrEqual(hi + 1e-9);
			}
		}
	});

	it("preserves monotonicity on a ramp (no ringing)", () => {
		const freqs = logGrid(100);
		const ramp = {
			frequencies: freqs,
			gains: freqs.map((f) => 6 * Math.log10(f / 20) - 9),
		};
		for (const preset of ["light", "moderate"] as const) {
			const out = smoothByPreset(ramp, preset);
			for (let i = 1; i < out.gains.length; i++) {
				expect(out.gains[i] ?? 0).toBeGreaterThanOrEqual(
					(out.gains[i - 1] ?? 0) - 1e-9,
				);
			}
		}
	});

	it("reduces local extrema on noise without inventing spikes", () => {
		const raw = noisy();
		const before = countExtrema(raw.gains);
		expect(before).toBeGreaterThan(50);
		const light = countExtrema(smoothByPreset(raw, "light").gains);
		const moderate = countExtrema(smoothByPreset(raw, "moderate").gains);
		expect(light).toBeLessThan(before);
		expect(moderate).toBeLessThanOrEqual(light);
	});

	it("bounds narrow-peak damage on a Q4 resonance (07 analogue)", () => {
		const peak = synthMeasurement(
			[{ type: "peaking", frequency: 3000, gain: 7, q: 4 }],
			{ points: 500 },
		);
		const rawMax = Math.max(...peak.gains);
		const lightMax = Math.max(...smoothByPreset(peak, "light").gains);
		const moderateMax = Math.max(...smoothByPreset(peak, "moderate").gains);
		// Light keeps the resonance nearly intact; moderate softens it but
		// must not flatten it (see corpus suite for fit-level guards).
		expect(rawMax - lightMax).toBeLessThan(0.3);
		expect(rawMax - moderateMax).toBeLessThan(0.7);
	});
});

describe("smoothing edges and density (§15, §16)", () => {
	it("preserves valid range on truncated inputs, no NaN at boundaries", () => {
		const full = synthMeasurement(
			[{ type: "peaking", frequency: 3000, gain: 5, q: 2 }],
			{ points: 200, noiseDb: 1, seed: 3 },
		);
		const cases = [
			truncateRange(full, 20, 12000),
			truncateRange(full, 50, 20000),
			truncateRange(full, 20, 10000),
		];
		for (const raw of cases) {
			for (const preset of ["light", "moderate"] as const) {
				const out = smoothByPreset(raw, preset);
				const fMin = Math.min(...raw.frequencies);
				const fMax = Math.max(...raw.frequencies);
				expect(out.frequencies[0]).toBeCloseTo(fMin, 9);
				expect(out.frequencies[out.frequencies.length - 1]).toBeCloseTo(
					fMax,
					9,
				);
				for (let i = 0; i < out.frequencies.length; i++) {
					expect(Number.isFinite(out.frequencies[i] ?? NaN)).toBe(true);
					expect(Number.isFinite(out.gains[i] ?? NaN)).toBe(true);
				}
			}
		}
	});

	it("behaves sanely from 20 to 1000 points", () => {
		for (const pts of [20, 50, 100, 500, 1000]) {
			const raw = synthMeasurement(
				[{ type: "peaking", frequency: 1000, gain: 3, q: 1 }],
				{ points: pts, noiseDb: 1, seed: 11 },
			);
			for (const preset of ["light", "moderate"] as const) {
				const once = smoothByPreset(raw, preset);
				const twice = smoothByPreset(raw, preset);
				expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
				expect(once.frequencies.length).toBeGreaterThan(0);
				for (const g of once.gains) {
					expect(Number.isFinite(g)).toBe(true);
				}
			}
		}
	});
});

describe("smoothing performance (§26)", () => {
	it("is negligible versus optimization at all densities", () => {
		for (const pts of [100, 500, 1000, 5000, 10000]) {
			const raw = synthMeasurement(
				[{ type: "peaking", frequency: 1000, gain: 3, q: 1 }],
				{ points: pts, noiseDb: 1, seed: 5 },
			);
			const start = performance.now();
			const out = smoothResponseCurve(raw, 1 / 6);
			const ms = performance.now() - start;
			expect(out.gains.length).toBeGreaterThan(0);
			console.log(`smooth/perf pts=${pts}: ${ms.toFixed(2)}ms`);
			// Fixed output grid ⇒ cost is ~constant and far below the
			// 15 s optimizer budget; 1 s is a generous tripwire.
			expect(ms).toBeLessThan(1000);
		}
	}, 120000);
});
