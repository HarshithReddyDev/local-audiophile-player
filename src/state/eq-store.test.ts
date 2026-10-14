import { describe, expect, it } from "vitest";
import type { SerializedPEQ } from "../dsp/types";
import { useEQStore } from "./eq-store";

function reset() {
	useEQStore.getState().resetProfile();
	useEQStore.setState({ presets: [] });
}

describe("eq store", () => {
	it("toggles, tunes preamp, and manages bands", () => {
		reset();
		const s = useEQStore.getState();
		expect(s.profile.enabled).toBe(false);
		s.setEnabled(true);
		s.setPreamp(-6);
		expect(useEQStore.getState().profile.preamp).toBe(-6);
		s.setPreamp(99);
		expect(useEQStore.getState().profile.preamp).toBe(24);
		s.addBand("peaking");
		s.addBand("lowshelf");
		expect(useEQStore.getState().profile.bands).toHaveLength(2);
		const id = useEQStore.getState().profile.bands[0]?.id ?? "";
		s.updateBand(id, { frequency: 60, gain: 3, q: 0.7 });
		expect(useEQStore.getState().profile.bands[0]).toMatchObject({
			frequency: 60,
			gain: 3,
			q: 0.7,
		});
		// Out-of-range edits clamp instead of corrupting.
		s.updateBand(id, { frequency: 999999, gain: 999, q: -5 });
		const clamped = useEQStore.getState().profile.bands[0];
		expect(clamped?.frequency).toBeLessThanOrEqual(48000);
		expect(clamped?.gain).toBe(24);
		expect(clamped?.q).toBeGreaterThan(0);
		s.removeBand(id);
		expect(useEQStore.getState().profile.bands).toHaveLength(1);
		s.resetProfile();
		expect(useEQStore.getState().profile.bands).toHaveLength(0);
	});

	it("caps bands at the UI limit", () => {
		reset();
		const s = useEQStore.getState();
		for (let i = 0; i < 20; i++) s.addBand();
		expect(useEQStore.getState().profile.bands.length).toBeLessThanOrEqual(12);
	});

	it("saves, renames, loads, and deletes presets", () => {
		reset();
		const s = useEQStore.getState();
		s.setEnabled(true);
		s.addBand("highshelf");
		const id = s.savePreset("  Bright  ");
		expect(id).toBeTruthy();
		expect(s.savePreset("   ")).toBeNull();
		expect(useEQStore.getState().presets[0]).toMatchObject({ name: "Bright" });
		s.resetProfile();
		expect(useEQStore.getState().profile.bands).toHaveLength(0);
		if (id) useEQStore.getState().loadPreset(id);
		expect(useEQStore.getState().profile.bands).toHaveLength(1);
		expect(useEQStore.getState().profile.enabled).toBe(true);
		if (id) useEQStore.getState().renamePreset(id, "Brighter");
		expect(useEQStore.getState().presets[0]?.name).toBe("Brighter");
		if (id) useEQStore.getState().deletePreset(id);
		expect(useEQStore.getState().presets).toHaveLength(0);
	});

	it("imports external PEQ as an independent user-owned copy", () => {
		reset();
		const s = useEQStore.getState();
		const external: SerializedPEQ = {
			version: 1,
			preamp: -2,
			enabled: true,
			bands: [
				{ type: "peaking", frequency: 1000, gain: 3, q: 1, enabled: true },
			],
		};
		const id = s.importPreset(
			"Catalog copy",
			{ ...external },
			{
				origin: "tutorial",
				deviceName: "Example",
			},
		);
		expect(id).toBeTruthy();
		const stored = useEQStore.getState().presets.find((p) => p.id === id);
		expect(stored).toMatchObject({
			name: "Catalog copy",
			origin: "tutorial",
			deviceName: "Example",
			favorite: false,
		});
		// Mutating the source afterwards cannot touch the stored copy.
		(external.bands[0] as { gain: number }).gain = 99;
		expect(
			useEQStore.getState().presets.find((p) => p.id === id)?.data.bands[0]
				?.gain,
		).toBe(3);
		// Malformed payloads fail safe; user presets stay theirs to rename.
		expect(
			s.importPreset("bad", { version: 1 } as never, { origin: "user" }),
		).toBeNull();
		expect(
			s.importPreset(
				"   ",
				stored?.data ?? { version: 1, preamp: 0, enabled: true, bands: [] },
				{ origin: "user" },
			),
		).toBeNull();
		if (id) {
			useEQStore.getState().togglePresetFavorite(id);
			expect(
				useEQStore.getState().presets.find((p) => p.id === id)?.favorite,
			).toBe(true);
			useEQStore.getState().renamePreset(id, "Mine now");
			expect(useEQStore.getState().presets.find((p) => p.id === id)?.name).toBe(
				"Mine now",
			);
		}
	});

	it("preserves catalog attribution on the user-owned copy", () => {
		reset();
		const s = useEQStore.getState();
		const external: SerializedPEQ = {
			version: 1,
			preamp: -6.3,
			enabled: true,
			bands: [
				{ type: "peaking", frequency: 1000, gain: 3, q: 1, enabled: true },
			],
		};
		const id = s.importPreset("HD 600 — autoeq oratory1990", external, {
			origin: "community",
			deviceName: "Sennheiser HD 600",
			sourceAttribution: "EQ by AutoEQ via OPRA (Measured by oratory1990)",
			sourceLicense: "CC BY-SA 4.0",
			sourceUrl: "https://github.com/opra-project/OPRA/tree/main/x",
			sourcePresetId: "opra-sennheiser-hd-600-autoeq-oratory1990",
		});
		expect(id).toBeTruthy();
		const stored = useEQStore.getState().presets.find((p) => p.id === id);
		expect(stored).toMatchObject({
			origin: "community",
			deviceName: "Sennheiser HD 600",
			sourceAttribution: "EQ by AutoEQ via OPRA (Measured by oratory1990)",
			sourceLicense: "CC BY-SA 4.0",
			sourceUrl: "https://github.com/opra-project/OPRA/tree/main/x",
			sourcePresetId: "opra-sennheiser-hd-600-autoeq-oratory1990",
		});
		// Editing the copy (rename + band edit via load/update) never
		// touches the attribution or the canonical catalog record: the
		// stored PEQ is a deep copy.
		(external.bands[0] as { gain: number }).gain = 99;
		expect(
			useEQStore.getState().presets.find((p) => p.id === id)?.data.bands[0]
				?.gain,
		).toBe(3);
		if (id) {
			useEQStore.getState().renamePreset(id, "My HD 600");
			const renamed = useEQStore.getState().presets.find((p) => p.id === id);
			expect(renamed?.name).toBe("My HD 600");
			expect(renamed?.sourceAttribution).toBe(
				"EQ by AutoEQ via OPRA (Measured by oratory1990)",
			);
		}
	});
});
