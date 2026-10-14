import { describe, expect, it } from "vitest";
import { createBiquad } from "./biquad";
import {
	bandGrids,
	biquadMagnitudeDb,
	peqMagnitudeDb,
	responseGrid,
} from "./response";
import type { PEQProfile } from "./types";

function profile(): PEQProfile {
	return {
		preamp: 0,
		enabled: true,
		bands: [
			{
				id: "a",
				type: "peaking",
				frequency: 100,
				gain: 3,
				q: 1,
				enabled: true,
			},
			{
				id: "b",
				type: "peaking",
				frequency: 3000,
				gain: -2,
				q: 2,
				enabled: true,
			},
		],
	};
}

describe("peqMagnitudeDb", () => {
	it("is silent when the profile is disabled", () => {
		expect(peqMagnitudeDb({ ...profile(), enabled: false }, 1000, 48000)).toBe(
			0,
		);
	});

	it("sums preamp and enabled bands only", () => {
		const withPreamp = { ...profile(), preamp: -2 };
		expect(peqMagnitudeDb(withPreamp, 100, 48000)).toBeCloseTo(
			peqMagnitudeDb(profile(), 100, 48000) - 2,
			9,
		);
		const oneOff = profile();
		oneOff.bands[0] = { ...oneOff.bands[0]!, enabled: false };
		expect(peqMagnitudeDb(oneOff, 100, 48000)).toBeCloseTo(-0.03, 1);
	});

	it("cascade responses add in dB", () => {
		const fs = 48000;
		const p = profile();
		for (const f of [40, 100, 500, 1000, 3000, 8000, 15000]) {
			const expected = p.bands.reduce(
				(sum, band) => sum + biquadMagnitudeDb(createBiquad(band, fs), f, fs),
				0,
			);
			expect(peqMagnitudeDb(p, f, fs)).toBeCloseTo(expected, 9);
		}
	});

	it("boost+cut symmetry sums to a flat wire", () => {
		const fs = 48000;
		const symmetric: PEQProfile = {
			preamp: 0,
			enabled: true,
			bands: [
				{
					id: "a",
					type: "peaking",
					frequency: 1000,
					gain: 6,
					q: 1,
					enabled: true,
				},
				{
					id: "b",
					type: "peaking",
					frequency: 1000,
					gain: -6,
					q: 1,
					enabled: true,
				},
			],
		};
		for (const f of [20, 100, 500, 1000, 5000, 15000, 20000]) {
			expect(peqMagnitudeDb(symmetric, f, fs)).toBeCloseTo(0, 6);
		}
	});
});

describe("responseGrid", () => {
	it("covers 20 Hz → 20 kHz on a log grid", () => {
		const grid = responseGrid(profile(), 48000, 64);
		expect(grid).toHaveLength(64);
		expect(grid[0]?.frequency).toBeCloseTo(20, 6);
		expect(grid[63]?.frequency).toBeCloseTo(20000, 3);
		for (let i = 1; i < grid.length; i++) {
			expect(grid[i]?.frequency ?? 0).toBeGreaterThan(
				grid[i - 1]?.frequency ?? 0,
			);
		}
	});

	it("flat profile renders ~0 dB everywhere", () => {
		const grid = responseGrid(
			{ preamp: 0, enabled: true, bands: [] },
			48000,
			32,
		);
		for (const point of grid) expect(point.db).toBeCloseTo(0, 9);
	});

	it("bandGrids solo each enabled band", () => {
		const grids = bandGrids(profile(), 48000, 16);
		expect(grids).toHaveLength(2);
		expect(grids[0]?.points).toHaveLength(16);
	});

	it("renders a 20-band grid fast enough for live UI", () => {
		const big = {
			preamp: -3,
			enabled: true,
			bands: Array.from({ length: 20 }, (_, i) => ({
				id: `b${i}`,
				type: "peaking" as const,
				frequency: 40 * 2 ** (i / 2),
				gain: (i % 5) - 2,
				q: 1,
				enabled: true,
			})),
		};
		const start = performance.now();
		const grid = responseGrid(big, 48000, 128);
		const ms = performance.now() - start;
		expect(grid).toHaveLength(128);
		console.log(`perf/20-band response grid: ${ms.toFixed(1)}ms`);
		expect(ms).toBeLessThan(100);
	});
});
