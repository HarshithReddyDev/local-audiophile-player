import { describe, expect, it } from "vitest";
import {
	buildParametricTarget,
	interpolateLog,
	normalizeCurve,
	resampleLog,
} from "./curves";

function bigCurve(points: number) {
	const frequencies: number[] = [];
	const gains: number[] = [];
	for (let i = 0; i < points; i++) {
		frequencies.push(20 * (20000 / 20) ** (i / (points - 1)));
		gains.push(Math.sin(i * 0.01) * 10);
	}
	return { frequencies, gains };
}

describe("curve performance (Node timing, algorithmic cost)", () => {
	it("parses-equivalent normalize at 100 / 1k / 10k points", () => {
		for (const n of [100, 1000, 10000]) {
			const { frequencies, gains } = bigCurve(n);
			const start = performance.now();
			const result = normalizeCurve(frequencies, gains);
			const ms = performance.now() - start;
			if ("error" in result) throw new Error("should normalize");
			expect(result.curve.frequencies).toHaveLength(n);
			console.log(`perf/curve normalize n=${n}: ${ms.toFixed(1)}ms`);
			expect(ms).toBeLessThan(1000);
		}
	});

	it("interpolates and resamples 10k-point curves fast", () => {
		const curve = bigCurve(10000);
		let start = performance.now();
		for (let i = 0; i < 1000; i++) {
			interpolateLog(curve, 20 + (19980 * i) / 999);
		}
		const interpMs = performance.now() - start;
		start = performance.now();
		const grid = resampleLog(curve, 256, 20, 20000);
		const resampleMs = performance.now() - start;
		expect(grid.frequencies).toHaveLength(256);
		console.log(
			`perf/curve 1000×interp=${interpMs.toFixed(1)}ms resample256=${resampleMs.toFixed(1)}ms`,
		);
		expect(interpMs).toBeLessThan(500);
		expect(resampleMs).toBeLessThan(200);
	});

	it("builds parametric targets fast", () => {
		const start = performance.now();
		const out = buildParametricTarget(
			{
				bassGainDb: 6,
				bassFreq: 105,
				tiltDbPerOctave: -1,
				tiltPivotFreq: 1000,
				offsetDb: 2,
			},
			1024,
		);
		const ms = performance.now() - start;
		expect(out.frequencies).toHaveLength(1024);
		console.log(`perf/curve parametric1024=${ms.toFixed(1)}ms`);
		expect(ms).toBeLessThan(200);
	});
});
