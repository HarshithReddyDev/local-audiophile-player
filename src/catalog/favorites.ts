/**
 * Local catalog favorites (devices + catalog presets). Canonical data is
 * never mutated: favorites live in localStorage prefs beside theme and
 * transport prefs — no migration, no schema change.
 */

import { create } from "zustand";
import { loadPrefs, savePrefs } from "../storage/persistence";

interface CatalogFavorites {
	devices: string[];
	presets: string[];
}

interface FavoritesState extends CatalogFavorites {
	toggleDevice: (id: string) => void;
	togglePreset: (id: string) => void;
	clearAll: () => void;
}

const initial: CatalogFavorites = loadPrefs<CatalogFavorites>(
	"catalog-favorites",
	{ devices: [], presets: [] },
);

function sanitize(raw: CatalogFavorites): CatalogFavorites {
	const ids = (v: unknown): string[] =>
		Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
	return { devices: ids(raw.devices), presets: ids(raw.presets) };
}

function toggle(list: string[], id: string): string[] {
	return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function persist(state: CatalogFavorites): void {
	savePrefs("catalog-favorites", state);
}

const clean = sanitize(initial);
persist(clean);

export const useCatalogFavorites = create<FavoritesState>()((set, get) => ({
	devices: clean.devices,
	presets: clean.presets,

	toggleDevice: (id) => {
		const devices = toggle(get().devices, id);
		set({ devices });
		persist({ devices, presets: get().presets });
	},

	togglePreset: (id) => {
		const presets = toggle(get().presets, id);
		set({ presets });
		persist({ devices: get().devices, presets });
	},

	clearAll: () => {
		set({ devices: [], presets: [] });
		persist({ devices: [], presets: [] });
	},
}));
