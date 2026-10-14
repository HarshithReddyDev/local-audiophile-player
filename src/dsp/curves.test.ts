import { describe, expect, it } from "vitest";
import { CurveParseError, parseCurveText } from "./curve-io";
import {
	buildParametricTarget,
	compensationCurve,
	curveStats,
	interpolateLog,
	normalizeCurve,
	resampleLog,
	validateCurve,
} from "./curves";

describe("normalizeCurve", () => {
	it("sorts, dedupes by averaging, and drops bad rows", () => {
		const result = normalizeCurve(
			[100, 20, 100, -5, Number.NaN, 1000],
			[1, 2, 3, 0, 0, 4],
		);
		if ("error" in result) throw new Error("should parse");
		expect(result.curve.frequencies).toEqual([20, 100, 1000]);
		expect(result.curve.gains).toEqual([2, 2, 4]);
	});

	it("rejects empty and tiny inputs", () => {
		expect("error" in normalizeCurve([], [])).toBe(true);
		expect("error" in normalizeCurve([20], [1])).toBe(true);
		expect("error" in normalizeCurve([20, 30], [1, 2])).toBe(true);
	});
});

describe("validateCurve", () => {
	it("rejects impossible values but keeps honest acoustics", () => {
		expect(
			validateCurve({ frequencies: [], gains: [] }).length,
		).toBeGreaterThan(0);
		expect(
			validateCurve({ frequencies: [0, 100], gains: [0, 0] }).length,
		).toBeGreaterThan(0);
		expect(
			validateCurve({ frequencies: [20, 100], gains: [0, Number.NaN] }).length,
		).toBeGreaterThan(0);
		// Narrow resonances, negative dB, sparse points: all legitimate.
		expect(
			validateCurve({ frequencies: [20, 3000, 20000], gains: [-40, 25, -3] }),
		).toEqual([]);
	});
});

describe("interpolateLog", () => {
	const curve = { frequencies: [100, 1000, 10000], gains: [0, 10, 0] };

	it("is exact on knots and logarithmic between", () => {
		expect(interpolateLog(curve, 1000)).toBeCloseTo(10, 9);
		// Geometric midpoint (316 Hz) between 100→0 and 1000→10 gives 5 dB.
		expect(interpolateLog(curve, Math.sqrt(100 * 1000))).toBeCloseTo(5, 9);
		// Linear-in-frequency would give ~2.8 dB here instead.
		expect(interpolateLog(curve, 400)).toBeCloseTo(6.02, 2);
	});

	it("clamps outside the range and rejects garbage", () => {
		expect(interpolateLog(curve, 10)).toBe(0);
		expect(interpolateLog(curve, 30000)).toBe(0);
		expect(interpolateLog(curve, -5)).toBeNull();
		expect(interpolateLog(curve, Number.NaN)).toBeNull();
		expect(interpolateLog({ frequencies: [], gains: [] }, 100)).toBeNull();
	});
});

describe("compensationCurve sign convention", () => {
	it("golden 1: flat + flat = zero correction", () => {
		const flat = { frequencies: [20, 20000], gains: [0, 0] };
		const out = compensationCurve(flat, flat, 16, 20, 20000);
		for (const g of out.gains) expect(g).toBeCloseTo(0, 9);
	});

	it("golden 2: +3 dB measurement vs 0 dB target needs −3 dB", () => {
		const meas = { frequencies: [20, 20000], gains: [3, 3] };
		const target = { frequencies: [20, 20000], gains: [0, 0] };
		const out = compensationCurve(meas, target, 8, 20, 20000);
		for (const g of out.gains) expect(g).toBeCloseTo(-3, 9);
	});

	it("golden 3: −3 dB measurement vs 0 dB target needs +3 dB", () => {
		const meas = { frequencies: [20, 20000], gains: [-3, -3] };
		const target = { frequencies: [20, 20000], gains: [0, 0] };
		const out = compensationCurve(meas, target, 8, 20, 20000);
		for (const g of out.gains) expect(g).toBeCloseTo(3, 9);
	});

	it("golden 4: identical curves need nothing", () => {
		const curve = { frequencies: [20, 100, 1000, 10000], gains: [2, -1, 4, 0] };
		const out = compensationCurve(curve, curve, 32, 20, 10000);
		for (const g of out.gains) expect(g).toBeCloseTo(0, 9);
	});
});

describe("buildParametricTarget", () => {
	it("flat params render flat", () => {
		const out = buildParametricTarget(
			{
				bassGainDb: 0,
				bassFreq: 105,
				tiltDbPerOctave: 0,
				tiltPivotFreq: 1000,
				offsetDb: 0,
			},
			16,
		);
		for (const g of out.gains) expect(g).toBeCloseTo(0, 9);
	});

	it("bass shelf concentrates below its midpoint", () => {
		const out = buildParametricTarget(
			{
				bassGainDb: 6,
				bassFreq: 100,
				tiltDbPerOctave: 0,
				tiltPivotFreq: 1000,
				offsetDb: 0,
			},
			64,
		);
		const at = (f: number) => {
			let best = 0;
			let bestDist = Infinity;
			out.frequencies.forEach((ff, i) => {
				const d = Math.abs(Math.log(ff / f));
				if (d < bestDist) {
					bestDist = d;
					best = out.gains[i] ?? 0;
				}
			});
			return best;
		};
		expect(at(20)).toBeGreaterThan(5);
		expect(at(20)).toBeLessThanOrEqual(6);
		expect(at(100)).toBeCloseTo(3, 0);
		expect(at(10000)).toBeCloseTo(0, 0);
	});

	it("tilt pivots correctly with offset stacking", () => {
		const out = buildParametricTarget(
			{
				bassGainDb: 0,
				bassFreq: 105,
				tiltDbPerOctave: -1,
				tiltPivotFreq: 1000,
				offsetDb: 2,
			},
			64,
		);
		const at = (f: number) => {
			let best = 0;
			let bestDist = Infinity;
			out.frequencies.forEach((ff, i) => {
				const d = Math.abs(Math.log(ff / f));
				if (d < bestDist) {
					bestDist = d;
					best = out.gains[i] ?? 0;
				}
			});
			return best;
		};
		expect(at(1000)).toBeCloseTo(2, 0);
		expect(at(2000)).toBeCloseTo(1, 0);
		expect(at(500)).toBeCloseTo(3, 0);
	});
});

describe("parseCurveText golden cases", () => {
	it("golden 5: sparse input parses", () => {
		const file = parseCurveText("20,0\n100,1\n1000,2\n", "sparse.csv");
		expect(file.curves).toHaveLength(1);
		expect(file.curves[0]?.curve.frequencies).toEqual([20, 100, 1000]);
	});

	it("golden: AutoEQ header layout with comments", () => {
		const file = parseCurveText(
			"# comment\nfrequency,raw\n20.0,7.0\n25.0,6.9\n30.0,6.8\nnot-a-row\n",
			"autoeq.csv",
		);
		expect(file.format).toBe("comma-separated");
		expect(file.curves[0]?.curve.frequencies).toEqual([20, 25, 30]);
		expect(file.warnings.join(" ")).toMatch(/line 6/);
	});

	it("golden: tab and whitespace layouts", () => {
		const tabbed = parseCurveText(
			"freq\tresp\n20\t1.5\n30\t2.5\n40\t0.5\n",
			"t.txt",
		);
		expect(tabbed.format).toBe("tab-separated");
		expect(tabbed.curves[0]?.curve.gains).toEqual([1.5, 2.5, 0.5]);
		const spaced = parseCurveText("20 1\n30 2\n40 3\n", "s.txt");
		expect(spaced.curves[0]?.curve.frequencies).toEqual([20, 30, 40]);
	});

	it("golden 6+7: unsorted input sorts, duplicates average", () => {
		const file = parseCurveText("1000,2\n20,0\n100,1\n100,3\n500,1\n", "u.csv");
		expect(file.curves[0]?.curve.frequencies).toEqual([20, 100, 500, 1000]);
		expect(file.curves[0]?.curve.gains?.[1]).toBeCloseTo(2, 9);
	});

	it("stereo L/R exports yield two channels", () => {
		const file = parseCurveText(
			"frequency,left,right\n20,1,2\n100,3,4\n1000,5,6\n",
			"stereo.csv",
		);
		expect(file.curves).toHaveLength(2);
		expect(file.curves[0]?.channel).toBe("left");
		expect(file.curves[1]?.curve.gains).toEqual([2, 4, 6]);
	});

	it("golden 8: malformed input rejects with reasons", () => {
		expect(() => parseCurveText("", "empty.csv")).toThrow(CurveParseError);
		expect(() => parseCurveText("# only comments\n", "c.csv")).toThrow(
			CurveParseError,
		);
		expect(() => parseCurveText("hello\nworld\n", "t.csv")).toThrow(
			CurveParseError,
		);
		expect(() => parseCurveText("20\n30\n", "onecol.csv")).toThrow(
			/at least frequency/,
		);
		expect(() => parseCurveText("0,1\n-5,2\n", "bad.csv")).toThrow(
			/usable points/,
		);
		const err = (() => {
			try {
				parseCurveText("20,1\nabc,2\n30,3\n40,4\n", "row.csv");
				return null;
			} catch (e) {
				return e;
			}
		})();
		expect(err).toBeNull(); // single bad row warns, file still parses
		const file = parseCurveText("20,1\nabc,2\n30,3\n40,4\n", "row.csv");
		expect(file.warnings.join(" ")).toMatch(/line 2/);
	});

	it("curveStats summarizes", () => {
		const stats = curveStats({ frequencies: [20, 20000], gains: [-3, 5] });
		expect(stats).toMatchObject({
			points: 2,
			minFrequency: 20,
			maxFrequency: 20000,
			minGain: -3,
			maxGain: 5,
		});
		expect(curveStats({ frequencies: [], gains: [] })).toBeNull();
	});

	it("resampleLog honors the grid", () => {
		const out = resampleLog(
			{ frequencies: [20, 20000], gains: [0, 0] },
			8,
			20,
			20000,
		);
		expect(out.frequencies).toHaveLength(8);
		expect(out.frequencies[0]).toBeCloseTo(20, 6);
		expect(out.frequencies[7]).toBeCloseTo(20000, 3);
	});
});
