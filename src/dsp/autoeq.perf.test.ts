import { describe, expect, it } from "vitest";
import type { AutoEQInput } from "../iem/types";
import { fitPEQ } from "./autoeq";
import type { ResponseCurve } from "./curves";

function wiggly(points: number): ResponseCurve {
	const frequencies: number[] = [];
	const gains: number[] = [];
	for (let i = 0; i < points; i++) {
		const f = 20 * (20000 / 20) ** (i / (points - 1));
		frequencies.push(f);
		gains.push(
			4 * Math.exp(-((Math.log10(f) - 2) ** 2) / 0.1) -
				3 * Math.exp(-((Math.log10(f) - 3.5) ** 2) / 0.05) +
				2 * Math.sin(i * 0.05),
		);
	}
	return { frequencies, gains };
}

function flat(): ResponseCurve {
	return { frequencies: [20, 1000, 20000], gains: [0, 0, 0] };
}

describe("optimizer performance (Node timing, algorithmic cost)", () => {
	it("scales across grids and band counts within budget", () => {
		const measurement = wiggly(1000);
		for (const [gridPoints, maxBands] of [
			[64, 4],
			[160, 8],
			[256, 12],
		] as const) {
			const input: AutoEQInput = {
				measurement,
				target: flat(),
				frequencyRange: { min: 20, max: 20000 },
				fittingOptions: { maxBands: 8, maxGainDb: 12, preferParametric: true },
			};
			const start = performance.now();
			const result = fitPEQ(input, { gridPoints, maxBands });
			const ms = performance.now() - start;
			console.log(
				`perf/autoeq grid=${gridPoints} bands≤${maxBands}: ${ms.toFixed(0)}ms → ` +
					`${result.profile.bands.length} bands, rms ${result.metrics.rmsAfterDb.toFixed(3)} dB`,
			);
			expect(result.metrics.rmsAfterDb).toBeLessThan(
				result.metrics.rmsBeforeDb,
			);
			expect(ms).toBeLessThan(15000);
		}
	}, 60000);

	it("fit → cancel → fit × N keeps memory bounded", () => {
		const measurement = wiggly(1000);
		const heap = () => process.memoryUsage().heapUsed / 1048576;
		const before = heap();
		for (let i = 0; i < 20; i++) {
			const input: AutoEQInput = {
				measurement,
				target: flat(),
				frequencyRange: { min: 20, max: 20000 },
				fittingOptions: { maxBands: 8, maxGainDb: 12, preferParametric: true },
			};
			if (i % 2 === 0) {
				// Cancelled runs release their partial state all the same.
				let calls = 0;
				fitPEQ(input, {}, { shouldCancel: () => ++calls > 3 });
			} else {
				fitPEQ(input, {});
			}
		}
		const growth = heap() - before;
		console.log(`perf/autoeq 20 fits heap growth: ${growth.toFixed(1)} MB`);
		expect(growth).toBeLessThan(30);
	}, 120000);
});
