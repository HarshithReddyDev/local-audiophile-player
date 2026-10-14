import { beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_PRESETS, builtinPreset } from "../../dsp/builtin-presets";
import { useDspStore } from "../../state/dsp-store";
import { useEQStore } from "../../state/eq-store";
import { applyBuiltinPreset } from "./apply-preset";

function snapshotLibrary(): string {
	return JSON.stringify(BUILTIN_PRESETS);
}

describe("built-in preset application", () => {
	beforeEach(() => {
		useEQStore.getState().resetProfile();
		useDspStore.getState().resetAll();
		useDspStore.getState().clearDevice();
	});

	it("applies an EQ preset to the live profile", () => {
		const preset = builtinPreset("builtin-warm");
		expect(preset).not.toBeNull();
		applyBuiltinPreset(preset!);
		const profile = useEQStore.getState().profile;
		expect(profile.enabled).toBe(true);
		expect(profile.bands.length).toBe(preset!.bands.length);
		expect(profile.preamp).toBe(preset!.preampDb);
	});

	it("applies a DSP preset without touching EQ bands", () => {
		const preset = builtinPreset("builtin-dsp-night-dyn");
		expect(preset).not.toBeNull();
		applyBuiltinPreset(preset!);
		expect(useEQStore.getState().profile.bands.length).toBe(0);
		expect(useDspStore.getState().compressor.enabled).toBe(true);
	});

	it("applies a combined preset to both EQ and DSP", () => {
		const preset = builtinPreset("builtin-combined-night");
		expect(preset).not.toBeNull();
		applyBuiltinPreset(preset!);
		expect(useEQStore.getState().profile.bands.length).toBeGreaterThan(0);
		expect(useDspStore.getState().loudness.enabled).toBe(true);
		expect(useDspStore.getState().limiter.enabled).toBe(true);
	});

	it("never mutates the built-in library (read-only semantics)", () => {
		const before = snapshotLibrary();
		for (const preset of BUILTIN_PRESETS) applyBuiltinPreset(preset);
		expect(snapshotLibrary()).toBe(before);
	});
});
