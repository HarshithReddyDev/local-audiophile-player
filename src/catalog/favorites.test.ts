import { describe, expect, it } from "vitest";
import { useCatalogFavorites } from "./favorites";

function reset() {
	useCatalogFavorites.setState({ devices: [], presets: [] });
}

describe("catalog favorites", () => {
	it("toggles devices and presets without touching canonical data", async () => {
		reset();
		const { SEED_CATALOG } = await import("./seed");
		const before = JSON.stringify(SEED_CATALOG.devices[0]);
		const s = useCatalogFavorites.getState();
		s.toggleDevice("a");
		expect(useCatalogFavorites.getState().devices).toEqual(["a"]);
		s.toggleDevice("a");
		expect(useCatalogFavorites.getState().devices).toEqual([]);
		s.togglePreset("p");
		expect(useCatalogFavorites.getState().presets).toEqual(["p"]);
		s.clearAll();
		expect(useCatalogFavorites.getState().presets).toEqual([]);
		expect(JSON.stringify(SEED_CATALOG.devices[0])).toBe(before);
	});
});
