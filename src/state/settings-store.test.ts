import { describe, expect, it } from "vitest";
import { sanitizeSettings, useSettingsStore } from "./settings-store";

describe("sanitizeSettings", () => {
	it("keeps valid settings", () => {
		expect(
			sanitizeSettings({
				theme: "dark",
				selectedIemProfileId: "abc",
				preservePitch: false,
				outputDeviceId: "dev-1",
				recentDeviceIds: ["d1", "d2"],
			}),
		).toEqual({
			theme: "dark",
			selectedIemProfileId: "abc",
			preservePitch: false,
			outputDeviceId: "dev-1",
			recentDeviceIds: ["d1", "d2"],
		});
	});

	it("repairs corrupt stored values", () => {
		expect(
			sanitizeSettings({
				theme: "evil",
				selectedIemProfileId: 42,
			} as unknown as {
				theme: "dark";
				selectedIemProfileId: string;
				preservePitch: boolean;
				outputDeviceId: string | null;
				recentDeviceIds: string[];
			}),
		).toEqual({
			theme: "system",
			selectedIemProfileId: null,
			preservePitch: true,
			outputDeviceId: null,
			recentDeviceIds: [],
		});
	});

	it("caps and filters recent device ids", () => {
		expect(
			sanitizeSettings({
				theme: "system",
				selectedIemProfileId: null,
				preservePitch: true,
				outputDeviceId: null,
				recentDeviceIds: ["a", 42, "b", "a", "c", "d", "e", "f", "g", "h", "i"],
			} as unknown as Parameters<typeof sanitizeSettings>[0]),
		).toEqual({
			theme: "system",
			selectedIemProfileId: null,
			preservePitch: true,
			outputDeviceId: null,
			recentDeviceIds: ["a", "b", "a", "c", "d", "e", "f", "g"],
		});
	});

	it("tracks recently used devices most-recent-first, capped and deduped", () => {
		const store = useSettingsStore.getState();
		store.touchRecentDevice("d1");
		store.touchRecentDevice("d2");
		store.touchRecentDevice("d1");
		expect(useSettingsStore.getState().recentDeviceIds.slice(0, 2)).toEqual([
			"d1",
			"d2",
		]);
		for (let i = 0; i < 12; i++) {
			useSettingsStore.getState().touchRecentDevice(`dx${i}`);
		}
		const recent = useSettingsStore.getState().recentDeviceIds;
		expect(recent.length).toBeLessThanOrEqual(8);
		expect(recent[0]).toBe("dx11");
		useSettingsStore.setState({ recentDeviceIds: [] });
	});
});
