import { describe, expect, it } from "vitest";
import type { EQBand } from "./types";
import {
	defaultBand,
	defaultProfile,
	parseProfile,
	serializeProfile,
	validateBand,
} from "./types";

function band(overrides: Partial<EQBand> = {}): EQBand {
	return {
		id: "t",
		type: "peaking",
		frequency: 1000,
		gain: 0,
		q: 1,
		enabled: true,
		...overrides,
	};
}

describe("validateBand", () => {
	it("accepts sane bands", () => {
		expect(validateBand(band(), 48000)).toEqual([]);
		expect(
			validateBand(band({ type: "lowpass", frequency: 20000 }), 48000),
		).toEqual([]);
	});

	it("flags out-of-range and non-finite input", () => {
		expect(validateBand(band({ frequency: 5 }), 48000).length).toBeGreaterThan(
			0,
		);
		expect(
			validateBand(band({ frequency: 30000 }), 48000).length,
		).toBeGreaterThan(0);
		expect(validateBand(band({ frequency: 24000 }), 48000)).toContain(
			"frequency must be below Nyquist",
		);
		expect(validateBand(band({ q: 0 }), 48000).length).toBeGreaterThan(0);
		expect(validateBand(band({ gain: 99 }), 48000).length).toBeGreaterThan(0);
		expect(
			validateBand(band({ gain: Number.NaN }), 48000).length,
		).toBeGreaterThan(0);
		expect(validateBand(band(), 1000).length).toBeGreaterThan(0);
	});
});

describe("profile serialization", () => {
	it("round-trips", () => {
		const profile = {
			...defaultProfile(),
			preamp: -3,
			enabled: true,
			bands: [
				defaultBand("lowshelf"),
				{ ...defaultBand("peaking"), gain: 2.5 },
			],
		};
		const parsed = parseProfile(serializeProfile(profile));
		expect(parsed).toMatchObject({ preamp: -3, enabled: true });
		expect(parsed?.bands).toHaveLength(2);
		expect(parsed?.bands[1]).toMatchObject({ type: "peaking", gain: 2.5 });
		// Fresh client ids: position, not id, is identity.
		expect(parsed?.bands[0]?.id).not.toBe(profile.bands[0]?.id);
	});

	it("rejects malformed payloads", () => {
		expect(parseProfile(null)).toBeNull();
		expect(parseProfile({ version: 2 })).toBeNull();
		expect(
			parseProfile({
				version: 1,
				preamp: 0,
				enabled: true,
				bands: [{ type: "fancy" }],
			}),
		).toBeNull();
		expect(
			parseProfile({
				version: 1,
				preamp: 0,
				enabled: true,
				bands: [{ type: "peaking", frequency: 100, gain: 0, q: 1 }],
			}),
		).toBeNull();
	});
});
