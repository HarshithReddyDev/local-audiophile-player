import { describe, expect, it } from "vitest";
import {
	gainReductionDb,
	sanitizeCompressor,
	staticCurveDb,
	suggestedMakeupDb,
} from "./dynamics";
import { loudnessCompensation, toLoudnessBands } from "./loudness";
import {
	normalizeReplayGainTags,
	parseGainText,
	parsePeakText,
	selectReplayGain,
} from "./replaygain";
import {
	applyMatrix,
	balanceMatrix,
	crossfeedMatrix,
	modeMatrix,
	SPATIAL_DEFAULTS,
	spatialMatrix,
	widthMatrix,
} from "./spatial";
import {
	BASS_TUNER_DEFAULTS,
	sanitizeBassTuner,
	toToneBands,
	toTunerBands,
	tunerPeakDb,
} from "./tone";

describe("tone shaping", () => {
	it("emits shelf stages for bass/treble", () => {
		const bands = toToneBands(
			{ enabled: true, gainDb: 4, turnoverHz: 200 },
			{ enabled: true, gainDb: -2, turnoverHz: 4000 },
		);
		expect(bands).toEqual([
			{ type: "lowshelf", frequency: 200, gain: 4, q: 0.71, enabled: true },
			{ type: "highshelf", frequency: 4000, gain: -2, q: 0.71, enabled: true },
		]);
	});

	it("skips neutral and disabled controls", () => {
		expect(
			toToneBands(
				{ enabled: true, gainDb: 0, turnoverHz: 200 },
				{ enabled: false, gainDb: 6, turnoverHz: 4000 },
			),
		).toEqual([]);
	});

	it("bass tuner is neutral by default and bounded otherwise", () => {
		expect(toTunerBands(BASS_TUNER_DEFAULTS)).toEqual([]);
		expect(tunerPeakDb(BASS_TUNER_DEFAULTS)).toBe(0);
		const bands = toTunerBands(
			sanitizeBassTuner({
				enabled: true,
				amountDb: 6,
				centerHz: 60,
				subDb: 3,
				resonance: 1,
			}),
		);
		expect(bands).toHaveLength(2);
		expect(bands[0]).toMatchObject({
			type: "lowshelf",
			frequency: 60,
			gain: 6,
		});
		expect(bands[1]).toMatchObject({
			type: "peaking",
			frequency: 30,
			gain: 3,
			q: 1,
		});
		expect(
			tunerPeakDb({
				...BASS_TUNER_DEFAULTS,
				enabled: true,
				amountDb: 6,
				subDb: 3,
			}),
		).toBe(9);
		const clamped = sanitizeBassTuner({
			enabled: true,
			amountDb: 99,
			centerHz: 1,
			subDb: -5,
			resonance: 99,
		});
		expect(clamped).toMatchObject({
			amountDb: 12,
			centerHz: 30,
			subDb: 0,
			resonance: 2,
		});
	});
});

describe("dynamics", () => {
	it("static curve is unity at/below the knee and compresses above", () => {
		const params = sanitizeCompressor({
			enabled: true,
			thresholdDb: -18,
			ratio: 3,
			kneeDb: 0,
			attackSec: 0.01,
			releaseSec: 0.2,
			makeupDb: 0,
		});
		expect(staticCurveDb(params, -30)).toBe(-30);
		expect(staticCurveDb(params, -18)).toBeCloseTo(-18, 9);
		// 6 dB over at 3:1 → 2 dB out.
		expect(staticCurveDb(params, -12)).toBeCloseTo(-16, 9);
		expect(gainReductionDb(params, -12)).toBeCloseTo(4, 9);
		expect(gainReductionDb(params, -30)).toBe(0);
		expect(suggestedMakeupDb(params, -12)).toBeCloseTo(4, 9);
	});

	it("disabled compressor reduces nothing and clamps params", () => {
		expect(
			gainReductionDb(
				{
					...sanitizeCompressor({
						...sanitizeCompressor({
							enabled: false,
							thresholdDb: -18,
							ratio: 3,
							kneeDb: 6,
							attackSec: 0.01,
							releaseSec: 0.2,
							makeupDb: 0,
						}),
					}),
				},
				0,
			),
		).toBe(0);
		const clamped = sanitizeCompressor({
			enabled: true,
			thresholdDb: 99,
			ratio: 0,
			kneeDb: -1,
			attackSec: 0,
			releaseSec: 99,
			makeupDb: -3,
		});
		expect(clamped).toMatchObject({
			thresholdDb: 0,
			ratio: 1,
			kneeDb: 0,
			attackSec: 0.001,
			releaseSec: 2,
			makeupDb: 0,
		});
	});
});

describe("spatial matrices", () => {
	it("center balance is bit-for-bit unity", () => {
		expect(balanceMatrix(0)).toEqual([
			[1, 0],
			[0, 1],
		]);
		const [l, r] = applyMatrix(balanceMatrix(0), 0.5, -0.25);
		expect([l, r]).toEqual([0.5, -0.25]);
	});

	it("extreme pans silence the opposite channel", () => {
		expect(applyMatrix(balanceMatrix(-1), 0.5, 0.5)[1]).toBeCloseTo(0, 12);
		expect(applyMatrix(balanceMatrix(1), 0.5, 0.5)[0]).toBeCloseTo(0, 12);
	});

	it("width 1 is identity, 0 is mono", () => {
		expect(widthMatrix(1)).toEqual([
			[1, 0],
			[0, 1],
		]);
		const [l, r] = applyMatrix(widthMatrix(0), 0.8, 0.2);
		expect(l).toBeCloseTo(0.5, 12);
		expect(r).toBeCloseTo(0.5, 12);
	});

	it("crossfeed blends channels symmetrically", () => {
		const [l, r] = applyMatrix(crossfeedMatrix(0.2), 1, 0);
		expect(l).toBeCloseTo(0.8, 12);
		expect(r).toBeCloseTo(0.2, 12);
	});

	it("channel modes route as labeled", () => {
		expect(applyMatrix(modeMatrix("swap"), 1, 2)).toEqual([2, 1]);
		expect(applyMatrix(modeMatrix("mono"), 1, -1)).toEqual([0, 0]);
		expect(applyMatrix(modeMatrix("left-only"), 1, 2)).toEqual([1, 1]);
		expect(applyMatrix(modeMatrix("right-only"), 1, 2)).toEqual([2, 2]);
	});

	it("neutral spatial params compose to identity", () => {
		expect(spatialMatrix(SPATIAL_DEFAULTS)).toEqual([
			[1, 0],
			[0, 1],
		]);
		expect(spatialMatrix({ ...SPATIAL_DEFAULTS, enabled: true })).toEqual([
			[1, 0],
			[0, 1],
		]);
		// Balance then width then mode compose in documented order.
		const m = spatialMatrix({
			enabled: true,
			balance: 0,
			width: 0,
			crossfeed: 0,
			mode: "swap",
		});
		expect(applyMatrix(m, 1, 2)).toEqual([1.5, 1.5]);
	});
});

describe("loudness compensation", () => {
	it("is exactly zero at/above reference and when off", () => {
		expect(
			loudnessCompensation({ enabled: true, listeningLevelDb: 0 }),
		).toEqual({
			bassDb: 0,
			trebleDb: 0,
		});
		expect(
			loudnessCompensation({ enabled: false, listeningLevelDb: -40 }),
		).toEqual({
			bassDb: 0,
			trebleDb: 0,
		});
		expect(toLoudnessBands({ enabled: true, listeningLevelDb: 0 })).toEqual([]);
	});

	it("grows monotonically with deficit and caps", () => {
		const low = loudnessCompensation({ enabled: true, listeningLevelDb: -40 });
		const mid = loudnessCompensation({ enabled: true, listeningLevelDb: -20 });
		expect(low.bassDb).toBe(8);
		expect(mid.bassDb).toBe(5);
		expect(low.trebleDb).toBe(3);
		expect(mid.trebleDb).toBeCloseTo(1.6, 9);
		expect(
			toLoudnessBands({ enabled: true, listeningLevelDb: -20 }),
		).toHaveLength(2);
	});
});

describe("replaygain", () => {
	it("parses tag text", () => {
		expect(parseGainText("-6.54 dB")).toBe(-6.54);
		expect(parseGainText("+3")).toBe(3);
		expect(parseGainText("bogus")).toBeNull();
		expect(parseGainText(99)).toBeNull();
		expect(parsePeakText("0.987")).toBeCloseTo(0.987, 9);
		expect(parsePeakText("-0.11 dB")).toBeCloseTo(10 ** (-0.11 / 20), 9);
		expect(parsePeakText("nope")).toBeNull();
		expect(
			normalizeReplayGainTags({
				REPLAYGAIN_TRACK_GAIN: "-6.00 dB",
				REPLAYGAIN_TRACK_PEAK: "0.5",
			}),
		).toMatchObject({ trackGainDb: -6, trackPeak: 0.5 });
	});

	it("selects mode gain with album fallback and peak guard", () => {
		expect(
			selectReplayGain("off", {
				...{
					trackGainDb: -6,
					trackPeak: null,
					albumGainDb: null,
					albumPeak: null,
				},
			}),
		).toEqual({
			gainDb: 0,
			source: "none",
			limitedByPeak: false,
		});
		expect(
			selectReplayGain("album", {
				trackGainDb: -6,
				trackPeak: null,
				albumGainDb: null,
				albumPeak: null,
			}),
		).toMatchObject({ gainDb: -6, source: "track" });
		// +2 dB gain against a 0 dBFS peak → held at 0, flagged.
		expect(
			selectReplayGain("track", {
				trackGainDb: 2,
				trackPeak: 1,
				albumGainDb: null,
				albumPeak: null,
			}),
		).toEqual({ gainDb: 0, source: "track", limitedByPeak: true });
		// Headroom respected: +2 dB against −6 dBFS peak passes through.
		expect(
			selectReplayGain("track", {
				trackGainDb: 2,
				trackPeak: 0.5,
				albumGainDb: null,
				albumPeak: null,
			}),
		).toMatchObject({ gainDb: 2, limitedByPeak: false });
	});
});
