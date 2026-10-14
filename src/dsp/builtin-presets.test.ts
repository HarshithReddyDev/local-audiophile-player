import { describe, expect, it } from "vitest";
import {
	BUILTIN_COMBINED_PRESETS,
	BUILTIN_DSP_PRESETS,
	BUILTIN_EQ_PRESETS,
	BUILTIN_PRESETS,
	builtinPreset,
	validateBuiltinPreset,
} from "./builtin-presets";

describe("built-in preset library", () => {
	it("has the required coverage", () => {
		expect(BUILTIN_EQ_PRESETS.length).toBeGreaterThanOrEqual(30);
		expect(BUILTIN_DSP_PRESETS.length).toBeGreaterThanOrEqual(12);
		expect(BUILTIN_COMBINED_PRESETS.length).toBeGreaterThanOrEqual(3);
	});

	it("has unique ids", () => {
		const ids = BUILTIN_PRESETS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("every preset validates", () => {
		for (const preset of BUILTIN_PRESETS) {
			expect(validateBuiltinPreset(preset), preset.id).toEqual([]);
		}
	});

	it("uses conservative gain (no absurd boosts)", () => {
		for (const preset of BUILTIN_PRESETS) {
			for (const b of preset.bands) {
				expect(Math.abs(b.gain), `${preset.id} gain`).toBeLessThanOrEqual(6);
			}
		}
	});

	it("preamp covers the peak boost (headroom understood)", () => {
		for (const preset of BUILTIN_PRESETS) {
			const peak = Math.max(0, ...preset.bands.map((b) => b.gain));
			expect(
				preset.preampDb <= -peak + 0.01,
				`${preset.id}: preamp ${preset.preampDb} vs peak ${peak}`,
			).toBe(true);
		}
	});

	it("all presets are in-repo authored, versioned, described", () => {
		for (const preset of BUILTIN_PRESETS) {
			expect(preset.provenance).toBe("in-repo");
			expect(preset.version).toBe(1);
			expect(preset.description.length).toBeGreaterThan(10);
			expect(preset.category.length).toBeGreaterThan(0);
		}
	});

	it("looks up by id", () => {
		expect(builtinPreset("builtin-flat")?.name).toBe("Flat");
		expect(builtinPreset("nope")).toBeNull();
	});
});
