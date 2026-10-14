import { create } from "zustand";
import type { PresetOrigin } from "../catalog/types";
import type {
	EQBand,
	FilterType,
	PEQProfile,
	SerializedPEQ,
} from "../dsp/types";
import {
	BAND_LIMITS,
	defaultBand,
	defaultProfile,
	newBandId,
	parseProfile,
	serializeProfile,
} from "../dsp/types";
import { loadPrefs, savePrefs } from "../storage/persistence";

export const MAX_UI_BANDS = 12;

export interface EQPreset {
	id: string;
	name: string;
	updatedAt: number;
	data: SerializedPEQ;
	/**
	 * Where this user-owned copy came from. "user" = saved from the live
	 * EQ editor; catalog origins = imported from the device catalog.
	 * Canonical catalog entries are NEVER stored here — import always
	 * copies, so the user can rename/delete freely.
	 */
	origin?: PresetOrigin | "user";
	/** Display name of the catalog device, if imported from one. */
	deviceName?: string;
	/**
	 * Provenance carried over from a catalog preset at import time
	 * (Phase 9: the user-owned copy stays attributable after it becomes
	 * independently editable). All optional; never blocks import.
	 */
	sourceAttribution?: string;
	sourceLicense?: string;
	sourceUrl?: string;
	sourcePresetId?: string;
	favorite?: boolean;
}

interface PersistedEQ {
	profile: SerializedPEQ;
	presets: EQPreset[];
}

interface EQState {
	profile: PEQProfile;
	presets: EQPreset[];

	setEnabled: (enabled: boolean) => void;
	setPreamp: (db: number) => void;
	addBand: (type?: FilterType) => void;
	removeBand: (id: string) => void;
	updateBand: (id: string, patch: Partial<EQBand>) => void;
	resetProfile: () => void;
	/** Load external bands (preset/AutoEQ): fresh ids, persisted, no merge. */
	loadBands: (
		bands: {
			type: FilterType;
			frequency: number;
			gain: number;
			q: number;
			enabled: boolean;
		}[],
		preamp: number,
		enabled: boolean,
	) => void;
	savePreset: (name: string) => string | null;
	renamePreset: (id: string, name: string) => void;
	deletePreset: (id: string) => void;
	loadPreset: (id: string) => void;
	/**
	 * Import an external PEQ (e.g. device catalog) as a user-owned copy.
	 * Malformed payloads fail safe with null; canonical data is never
	 * referenced, only copied.
	 */
	importPreset: (
		name: string,
		data: SerializedPEQ,
		meta: {
			origin: PresetOrigin | "user";
			deviceName?: string;
			sourceAttribution?: string;
			sourceLicense?: string;
			sourceUrl?: string;
			sourcePresetId?: string;
		},
	) => string | null;
	togglePresetFavorite: (id: string) => void;
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}

function sanitizeBand(band: EQBand): EQBand {
	return {
		...band,
		frequency: clamp(band.frequency, 1, 48000),
		gain: clamp(band.gain, BAND_LIMITS.gain.min, BAND_LIMITS.gain.max),
		q: clamp(band.q, BAND_LIMITS.q.min, BAND_LIMITS.q.max),
	};
}

function persist(profile: PEQProfile, presets: EQPreset[]): void {
	savePrefs("eq", {
		profile: serializeProfile(profile),
		presets,
	} satisfies PersistedEQ);
}

function restore(): { profile: PEQProfile; presets: EQPreset[] } {
	const fallback = { profile: serializeProfile(defaultProfile()), presets: [] };
	const raw = loadPrefs<PersistedEQ>("eq", fallback);
	const profile = parseProfile(raw.profile) ?? defaultProfile();
	const presets: EQPreset[] = Array.isArray(raw.presets)
		? raw.presets.filter(
				(p): p is EQPreset =>
					typeof p === "object" &&
					p !== null &&
					typeof (p as EQPreset).id === "string" &&
					typeof (p as EQPreset).name === "string" &&
					parseProfile((p as EQPreset).data) !== null,
			)
		: [];
	return { profile, presets };
}

const initial = restore();

export const useEQStore = create<EQState>()((set, get) => ({
	profile: initial.profile,
	presets: initial.presets,

	setEnabled: (enabled) => {
		const profile = { ...get().profile, enabled };
		set({ profile });
		persist(profile, get().presets);
	},

	setPreamp: (db) => {
		const profile = {
			...get().profile,
			preamp: clamp(db, BAND_LIMITS.preamp.min, BAND_LIMITS.preamp.max),
		};
		set({ profile });
		persist(profile, get().presets);
	},

	addBand: (type = "peaking") => {
		const { profile, presets } = get();
		if (profile.bands.length >= MAX_UI_BANDS) return;
		const next = { ...defaultBand(type), frequency: suggestFrequency(profile) };
		const updated = { ...profile, bands: [...profile.bands, next] };
		set({ profile: updated });
		persist(updated, presets);
	},

	removeBand: (id) => {
		const { profile, presets } = get();
		const updated = {
			...profile,
			bands: profile.bands.filter((b) => b.id !== id),
		};
		set({ profile: updated });
		persist(updated, presets);
	},

	updateBand: (id, patch) => {
		const { profile, presets } = get();
		// sanitizeBand clamps into range, so every edit stays storable and the
		// engine never receives out-of-range parameters.
		const bands = profile.bands.map((b) =>
			b.id === id ? sanitizeBand({ ...b, ...patch, id: b.id }) : b,
		);
		const updated = { ...profile, bands };
		set({ profile: updated });
		persist(updated, presets);
	},

	resetProfile: () => {
		const updated = defaultProfile();
		set({ profile: updated });
		persist(updated, get().presets);
	},

	loadBands: (bands, preamp, enabled) => {
		const updated: PEQProfile = {
			preamp: clamp(preamp, BAND_LIMITS.preamp.min, BAND_LIMITS.preamp.max),
			enabled,
			bands: bands
				.slice(0, MAX_UI_BANDS)
				.map((b) => sanitizeBand({ ...b, id: newBandId() })),
		};
		set({ profile: updated });
		persist(updated, get().presets);
	},

	savePreset: (name) => {
		const trimmed = name.trim();
		if (trimmed === "") return null;
		const preset: EQPreset = {
			id: newBandId().replace("band-", "preset-"),
			name: trimmed,
			updatedAt: Date.now(),
			data: serializeProfile(get().profile),
		};
		const presets = [preset, ...get().presets];
		set({ presets });
		persist(get().profile, presets);
		return preset.id;
	},

	renamePreset: (id, name) => {
		const trimmed = name.trim();
		if (trimmed === "") return;
		const presets = get().presets.map((p) =>
			p.id === id ? { ...p, name: trimmed, updatedAt: Date.now() } : p,
		);
		set({ presets });
		persist(get().profile, presets);
	},

	deletePreset: (id) => {
		const presets = get().presets.filter((p) => p.id !== id);
		set({ presets });
		persist(get().profile, presets);
	},

	loadPreset: (id) => {
		const preset = get().presets.find((p) => p.id === id);
		if (!preset) return;
		const profile = parseProfile(preset.data);
		if (!profile) return;
		set({ profile });
		persist(profile, get().presets);
	},

	importPreset: (name, data, meta) => {
		const trimmed = name.trim();
		if (trimmed === "") return null;
		if (parseProfile(data) === null) return null;
		const preset: EQPreset = {
			id: newBandId().replace("band-", "preset-"),
			name: trimmed,
			updatedAt: Date.now(),
			data: JSON.parse(JSON.stringify(data)) as SerializedPEQ,
			origin: meta.origin,
			favorite: false,
		};
		if (meta.deviceName !== undefined) preset.deviceName = meta.deviceName;
		if (meta.sourceAttribution !== undefined)
			preset.sourceAttribution = meta.sourceAttribution;
		if (meta.sourceLicense !== undefined)
			preset.sourceLicense = meta.sourceLicense;
		if (meta.sourceUrl !== undefined) preset.sourceUrl = meta.sourceUrl;
		if (meta.sourcePresetId !== undefined)
			preset.sourcePresetId = meta.sourcePresetId;
		const presets = [preset, ...get().presets];
		set({ presets });
		persist(get().profile, presets);
		return preset.id;
	},

	togglePresetFavorite: (id) => {
		const presets = get().presets.map((p) =>
			p.id === id
				? { ...p, favorite: !(p.favorite ?? false), updatedAt: Date.now() }
				: p,
		);
		set({ presets });
		persist(get().profile, presets);
	},
}));

/** Suggest a staggered default frequency so new bands don't stack at 1 kHz. */
function suggestFrequency(profile: PEQProfile): number {
	const steps = [60, 230, 910, 3600, 14000];
	return steps[profile.bands.length % steps.length] ?? 1000;
}
