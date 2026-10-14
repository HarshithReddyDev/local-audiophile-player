import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { destroyLibraryDatabase } from "../db/database";
import { useEQStore } from "../state/eq-store";
import { useIEMStore } from "../state/iem-store";
import { useSettingsStore } from "../state/settings-store";
import { libraryService } from "./library-service";

const CSV = "frequency,raw\n20,0\n100,1\n1000,2\n10000,1\n20000,0\n";

function resetIEM(): void {
	useIEMStore.setState({ measurements: {}, targets: {}, profiles: {} });
}

afterEach(async () => {
	await libraryService.dispose();
	resetIEM();
	useSettingsStore.setState({ selectedIemProfileId: null });
	await destroyLibraryDatabase("iem-player-library");
});

describe("IEM service", () => {
	it("imports measurements with stereo channels split", async () => {
		await libraryService.initialize();
		const stereo = "frequency,left,right\n20,1,2\n100,3,4\n1000,5,6\n";
		const { ids, warnings } = await libraryService.importMeasurementFile(
			stereo,
			"stereo.csv",
			"unit",
		);
		expect(ids).toHaveLength(2);
		expect(warnings).toEqual([]);
		const state = useIEMStore.getState();
		expect(Object.keys(state.measurements)).toHaveLength(2);
		await libraryService.dispose();
	});

	it("rejects malformed measurement files with reasons", async () => {
		await libraryService.initialize();
		await expect(
			libraryService.importMeasurementFile("nope\n", "bad.csv", "unit"),
		).rejects.toThrow(/no data rows|usable points/);
		expect(Object.keys(useIEMStore.getState().measurements)).toHaveLength(0);
		await libraryService.dispose();
	});

	it("saves parametric targets and updates them in place", async () => {
		await libraryService.initialize();
		const params = {
			bassGainDb: 4,
			bassFreq: 105,
			tiltDbPerOctave: -0.5,
			tiltPivotFreq: 1000,
			offsetDb: 0,
		};
		const id = await libraryService.saveParametricTarget("Warm", params);
		let target = useIEMStore.getState().targets[id];
		expect(target?.kind).toBe("parametric");
		expect(target?.metadata.params).toMatchObject({ bassGainDb: 4 });
		const points = target?.frequencies.length ?? 0;
		expect(points).toBeGreaterThan(100);
		const again = await libraryService.saveParametricTarget(
			"Warmer",
			{ ...params, bassGainDb: 6 },
			id,
		);
		expect(again).toBe(id);
		target = useIEMStore.getState().targets[id];
		expect(target?.name).toBe("Warmer");
		expect(Object.keys(useIEMStore.getState().targets)).toHaveLength(1);
		await libraryService.dispose();
	});

	it("manages the profile lifecycle with references, not copies", async () => {
		await libraryService.initialize();
		const { ids } = await libraryService.importMeasurementFile(
			CSV,
			"m.csv",
			"unit",
		);
		const targetId = await libraryService.saveParametricTarget("T", {
			bassGainDb: 0,
			bassFreq: 105,
			tiltDbPerOctave: 0,
			tiltPivotFreq: 1000,
			offsetDb: 0,
		});
		const pid = await libraryService.createProfile({
			name: "Test IEM",
			manufacturer: "Acme",
			model: "One",
			measurementId: ids[0] ?? null,
			targetId,
		});
		libraryService.selectProfile(pid);
		expect(useSettingsStore.getState().selectedIemProfileId).toBe(pid);

		await libraryService.renameProfile(pid, "Renamed");
		expect(useIEMStore.getState().profiles[pid]?.name).toBe("Renamed");

		const copyId = await libraryService.duplicateProfile(pid);
		expect(copyId).not.toBe(pid);
		expect(useIEMStore.getState().profiles[copyId ?? ""]?.measurementId).toBe(
			ids[0],
		);

		// Deleting the measurement keeps the profile but clears the dangling
		// reference (stored EQ, if any, is preserved as history).
		await libraryService.deleteMeasurement(ids[0] ?? "");
		expect(useIEMStore.getState().profiles[pid]?.measurementId).toBeNull();

		await libraryService.deleteProfile(pid);
		expect(useSettingsStore.getState().selectedIemProfileId).toBeNull();
		expect(useIEMStore.getState().profiles[pid]).toBeUndefined();
		await libraryService.dispose();
	});

	it("selecting a profile makes its EQ live; deleting a target detaches", async () => {
		await libraryService.initialize();
		const targetId = await libraryService.saveParametricTarget("T", {
			bassGainDb: 0,
			bassFreq: 105,
			tiltDbPerOctave: 0,
			tiltPivotFreq: 1000,
			offsetDb: 0,
		});
		const withEq = await libraryService.createProfile({
			name: "With EQ",
			manufacturer: "",
			model: "",
			measurementId: null,
			targetId,
		});
		await libraryService.applyAutoEQResult(
			withEq,
			{
				version: 1,
				preamp: -3,
				enabled: true,
				bands: [
					{ type: "peaking", frequency: 1000, gain: 2, q: 1, enabled: true },
				],
			},
			{ optimizerVersion: 2, fittedAt: 0, rmsAfterDb: 0.1, maxBands: 8 },
		);
		const bare = await libraryService.createProfile({
			name: "Bare",
			manufacturer: "",
			model: "",
			measurementId: null,
			targetId,
		});

		libraryService.selectProfile(withEq);
		expect(useEQStore.getState().profile.bands).toHaveLength(1);
		expect(useEQStore.getState().profile.enabled).toBe(true);

		// A profile with no stored EQ bypasses instead of playing stale bands.
		libraryService.selectProfile(bare);
		expect(useEQStore.getState().profile.enabled).toBe(false);

		// Deleting the target clears the reference but keeps the profile.
		await libraryService.deleteTarget(targetId);
		expect(useIEMStore.getState().profiles[withEq]?.targetId).toBeNull();
		expect(useIEMStore.getState().profiles[withEq]?.eq).not.toBeNull();
		await libraryService.dispose();
	});

	it("restores IEM data across restart", async () => {
		await libraryService.initialize();
		const { ids } = await libraryService.importMeasurementFile(
			CSV,
			"m.csv",
			"unit",
		);
		const pid = await libraryService.createProfile({
			name: "Keep",
			manufacturer: "",
			model: "",
			measurementId: ids[0] ?? null,
			targetId: "builtin-flat",
		});
		await libraryService.dispose();
		resetIEM();
		await libraryService.initialize();
		expect(Object.keys(useIEMStore.getState().measurements)).toHaveLength(1);
		expect(useIEMStore.getState().profiles[pid]?.name).toBe("Keep");
		await libraryService.dispose();
	});
});
