import { describe, expect, it } from "vitest";
import { type DeviceDspSnapshot, parseSnapshot } from "./snapshot";

function fullSnapshot(): DeviceDspSnapshot {
	return {
		version: 1,
		eqMode: "graphic",
		peq: {
			version: 1,
			preamp: -3,
			enabled: true,
			bands: [
				{ type: "peaking", frequency: 1000, gain: 2, q: 1, enabled: true },
			],
		},
		graphic: {
			layoutId: "10",
			gains: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
			enabled: true,
		},
		bass: { enabled: true, gainDb: 3, turnoverHz: 200 },
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
			mix: 0.2,
			decay: 2.5,
			damping: 0.5,
			roomSec: 1.2,
			predelaySec: 0.02,
		},
		loudness: { enabled: false, listeningLevelDb: -20 },
		replayGainMode: "track",
	};
}

describe("device dsp snapshots", () => {
	it("accepts a complete snapshot", () => {
		expect(parseSnapshot(fullSnapshot())).not.toBeNull();
	});

	it("rejects wrong versions, modes, and missing modules", () => {
		const base = fullSnapshot();
		expect(parseSnapshot(null)).toBeNull();
		expect(parseSnapshot({ ...base, version: 2 })).toBeNull();
		expect(parseSnapshot({ ...base, eqMode: "spectral" })).toBeNull();
		const { bass: _bass, ...noBass } = base;
		expect(parseSnapshot(noBass)).toBeNull();
		expect(parseSnapshot({ ...base, replayGainMode: "loud" })).toBeNull();
		expect(
			parseSnapshot({
				...base,
				peq: { version: 2, preamp: 0, enabled: true, bands: [] },
			}),
		).toBeNull();
	});

	it("tolerates a null graphic (parametric-only snapshots)", () => {
		expect(parseSnapshot({ ...fullSnapshot(), graphic: null })).not.toBeNull();
	});
});
