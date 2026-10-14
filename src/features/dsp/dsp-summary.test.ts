import { describe, expect, it } from "vitest";
import { type DspSummaryInput, formatDb, summarizeDsp } from "./dsp-summary";

function base(): DspSummaryInput {
	return {
		eqMode: "parametric",
		eqEnabled: true,
		eqActiveBands: 5,
		preampDb: -4.8,
		replayGainDb: 0,
		bass: { enabled: false, gainDb: 0, turnoverHz: 200 },
		treble: { enabled: false, gainDb: 0, turnoverHz: 4000 },
		tuner: {
			enabled: false,
			amountDb: 0,
			centerHz: 60,
			subDb: 0,
			resonance: 0.71,
		},
		limiter: { enabled: true, ceilingDb: -1 },
		compressor: {
			enabled: false,
			thresholdDb: -18,
			ratio: 3,
			kneeDb: 6,
			attackSec: 0.01,
			releaseSec: 0.2,
			makeupDb: 0,
		},
		spatial: {
			enabled: false,
			balance: 0,
			width: 1,
			crossfeed: 0,
			mode: "stereo",
		},
		reverb: {
			enabled: false,
			mix: 0,
			decay: 2.5,
			damping: 0.5,
			roomSec: 1.2,
			predelaySec: 0.02,
		},
		loudness: { enabled: false, listeningLevelDb: -20 },
	};
}

describe("formatDb", () => {
	it("signs and rounds to one decimal", () => {
		expect(formatDb(2)).toBe("+2.0 dB");
		expect(formatDb(0)).toBe("0.0 dB");
		expect(formatDb(-4.76)).toBe("−4.8 dB");
	});
});

describe("summarizeDsp", () => {
	it("always shows EQ state plus preamp, hides defaults", () => {
		const rows = summarizeDsp(base());
		expect(rows.map((r) => r.key)).toEqual(["eq", "preamp"]);
		expect(rows[0]).toMatchObject({ label: "EQ", value: "ON · 5 bands" });
		expect(rows[1]).toMatchObject({ label: "Preamp", value: "−4.8 dB" });
	});

	it("marks EQ OFF unambiguously", () => {
		const rows = summarizeDsp({ ...base(), eqEnabled: false });
		expect(rows[0]).toMatchObject({ label: "EQ", value: "OFF" });
	});

	it("annotates ReplayGain contribution", () => {
		const rows = summarizeDsp({ ...base(), replayGainDb: -2 });
		expect(rows[1]?.value).toBe("−4.8 dB (RG −2.0 dB)");
	});

	it("lists only active non-default processors", () => {
		const rows = summarizeDsp({
			...base(),
			bass: { enabled: true, gainDb: 2, turnoverHz: 200 },
			treble: { enabled: true, gainDb: 0, turnoverHz: 4000 },
			compressor: {
				enabled: true,
				thresholdDb: -18,
				ratio: 3,
				kneeDb: 6,
				attackSec: 0.01,
				releaseSec: 0.2,
				makeupDb: 0,
			},
			spatial: {
				enabled: true,
				balance: 0,
				width: 1.1,
				crossfeed: 0,
				mode: "stereo",
			},
			reverb: {
				enabled: true,
				mix: 0.25,
				decay: 2.5,
				damping: 0.5,
				roomSec: 1.2,
				predelaySec: 0.02,
			},
			loudness: { enabled: true, listeningLevelDb: -20 },
		});
		const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
		expect(byKey["bass"]).toBe("+2.0 dB");
		expect(byKey["treble"]).toBeUndefined();
		expect(byKey["compressor"]).toBe("−18.0 dB 3:1");
		expect(byKey["width"]).toBe("110%");
		expect(byKey["reverb"]).toBe("25%");
		expect(byKey["loudness"]).toBe("−20.0 dB ref");
		expect(byKey["limiter"]).toBeUndefined();
	});

	it("warns when the limiter is off and names channel modes", () => {
		const rows = summarizeDsp({
			...base(),
			limiter: { enabled: false, ceilingDb: -1 },
			spatial: {
				enabled: true,
				balance: -0.3,
				width: 1,
				crossfeed: 0,
				mode: "mono",
			},
		});
		const limiter = rows.find((r) => r.key === "limiter");
		expect(limiter?.warning).toBe(true);
		expect(limiter?.value).toBe("OFF — unprotected");
		const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
		expect(byKey["balance"]).toBe("L 30");
		expect(byKey["mode"]).toBe("Mono");
		expect(byKey["width"]).toBeUndefined();
	});
});
