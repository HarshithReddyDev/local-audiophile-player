import { beforeEach, describe, expect, it } from "vitest";
import { useDspStore } from "./dsp-store";
import { useEQStore } from "./eq-store";

beforeEach(() => {
	useDspStore.getState().resetAll();
	useDspStore.setState({
		graphicPresets: [],
		activeDeviceId: null,
		activeDeviceName: null,
	});
	useEQStore.getState().resetProfile();
});

describe("dsp store", () => {
	it("updates and resets modules independently", () => {
		const store = useDspStore.getState();
		expect(store.compressor.enabled).toBe(false);
		store.setCompressor({
			...store.compressor,
			enabled: true,
			thresholdDb: -12,
		});
		expect(useDspStore.getState().compressor.thresholdDb).toBe(-12);
		expect(useDspStore.getState().bass.gainDb).toBe(0);
		useDspStore.getState().resetModule("compressor");
		expect(useDspStore.getState().compressor.thresholdDb).toBe(-18);
		useDspStore
			.getState()
			.setBass({ enabled: true, gainDb: 5, turnoverHz: 200 });
		useDspStore.getState().resetAll();
		expect(useDspStore.getState().bass.gainDb).toBe(0);
	});

	it("manages graphic presets without touching PEQ presets", () => {
		const store = useDspStore.getState();
		store.setGraphic({ layoutId: "5", gains: [1, 2, 3, 4, 5], enabled: true });
		const id = store.saveGraphicPreset("My 5-band");
		expect(id).not.toBeNull();
		expect(useDspStore.getState().graphicPresets).toHaveLength(1);
		expect(useEQStore.getState().presets).toHaveLength(0);
		useDspStore
			.getState()
			.setGraphic({ layoutId: "5", gains: [0, 0, 0, 0, 0], enabled: true });
		if (id) useDspStore.getState().loadGraphicPreset(id);
		expect(useDspStore.getState().graphic.gains[1]).toBe(2);
		if (id) useDspStore.getState().renameGraphicPreset(id, "Renamed");
		expect(useDspStore.getState().graphicPresets[0]?.name).toBe("Renamed");
		if (id) useDspStore.getState().deleteGraphicPreset(id);
		expect(useDspStore.getState().graphicPresets).toHaveLength(0);
		expect(useDspStore.getState().saveGraphicPreset("   ")).toBeNull();
	});

	it("round-trips a device snapshot with PEQ handoff", () => {
		const store = useDspStore.getState();
		store.setEqMode("graphic");
		store.setBass({ enabled: true, gainDb: 4, turnoverHz: 150 });
		store.setSpatial({
			enabled: true,
			balance: -0.5,
			width: 1,
			crossfeed: 0,
			mode: "stereo",
		});
		const snap = store.snapshot();
		expect(snap.eqMode).toBe("graphic");
		expect(snap.bass.gainDb).toBe(4);
		expect(snap.peq).not.toBeNull();

		// Diverge everywhere, then apply back with a device identity.
		useDspStore.getState().resetAll();
		useDspStore.getState().setEqMode("parametric");
		useDspStore
			.getState()
			.applySnapshot(snap, { id: "dev-1", name: "Test IEM" });
		const back = useDspStore.getState();
		expect(back.eqMode).toBe("graphic");
		expect(back.bass.gainDb).toBe(4);
		expect(back.spatial.balance).toBe(-0.5);
		expect(back.activeDeviceId).toBe("dev-1");
		expect(back.activeDeviceName).toBe("Test IEM");
		useDspStore.getState().clearDevice();
		expect(useDspStore.getState().activeDeviceId).toBeNull();
		// PEQ traveled through the EQ store, not a side channel.
		expect(useEQStore.getState().profile.preamp).toBe(snap.peq?.preamp ?? 0);
	});

	it("toggles master bypass without mutating modules or presets", () => {
		const store = useDspStore.getState();
		store.setBass({ enabled: true, gainDb: 3, turnoverHz: 200 });
		const presetId = useEQStore.getState().savePreset("Bypass probe");
		expect(useDspStore.getState().masterBypass).toBe(false);
		useDspStore.getState().setMasterBypass(true);
		expect(useDspStore.getState().masterBypass).toBe(true);
		// Nothing else moved: modules, EQ profile, and presets intact.
		expect(useDspStore.getState().bass).toEqual({
			enabled: true,
			gainDb: 3,
			turnoverHz: 200,
		});
		expect(
			useEQStore.getState().presets.find((p) => p.id === presetId),
		).toBeTruthy();
		useDspStore.getState().setMasterBypass(false);
		expect(useDspStore.getState().masterBypass).toBe(false);
		expect(useDspStore.getState().bass.gainDb).toBe(3);
		if (presetId) useEQStore.getState().deletePreset(presetId);
	});

	it("treats A/B compare as transient listening state only", () => {
		expect(useDspStore.getState().comparing).toBe(false);
		useDspStore.getState().setComparing(true);
		expect(useDspStore.getState().comparing).toBe(true);
		// Stored configuration is untouched by comparing.
		expect(useDspStore.getState().bass.gainDb).toBe(0);
		useDspStore.getState().setComparing(false);
		expect(useDspStore.getState().comparing).toBe(false);
	});
});
