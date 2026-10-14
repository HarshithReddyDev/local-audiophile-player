import { create } from "zustand";
import { loadPrefs, savePrefs } from "../storage/persistence";

export type Theme = "system" | "dark" | "light";

interface PersistedSettings {
	theme: Theme;
	selectedIemProfileId: string | null;
	/** Keep pitch stable when playback rate changes (default on). */
	preservePitch: boolean;
	/** Explicit output device id, or null for the system default. */
	outputDeviceId: string | null;
	/**
	 * Recently used catalog device ids, most recent first (capped).
	 * Display order only — never affects audio.
	 */
	recentDeviceIds: string[];
}

interface SettingsState extends PersistedSettings {
	/** Placeholder for the future EQ system. UI stays disabled until Phase 5. */
	eqEnabled: boolean;

	setTheme: (theme: Theme) => void;
	setEqEnabled: (enabled: boolean) => void;
	setSelectedIemProfileId: (id: string | null) => void;
	setPreservePitch: (on: boolean) => void;
	setOutputDeviceId: (id: string | null) => void;
	/** Record a used device id (most-recent-first, capped at 8). */
	touchRecentDevice: (id: string) => void;
}

/** Max remembered devices (display order only). */
export const MAX_RECENT_DEVICES = 8;

const initial: PersistedSettings = sanitizeSettings(
	loadPrefs<PersistedSettings>("settings", {
		theme: "system",
		selectedIemProfileId: null,
		preservePitch: true,
		outputDeviceId: null,
		recentDeviceIds: [],
	}),
);

/** Reject corrupt stored settings at the boundary (unknown theme, ids). */
export function sanitizeSettings(raw: PersistedSettings): PersistedSettings {
	const theme =
		raw.theme === "dark" || raw.theme === "light" || raw.theme === "system"
			? raw.theme
			: "system";
	const selectedIemProfileId =
		typeof raw.selectedIemProfileId === "string"
			? raw.selectedIemProfileId
			: null;
	const recentDeviceIds = Array.isArray(raw.recentDeviceIds)
		? raw.recentDeviceIds.filter((id): id is string => typeof id === "string")
		: [];
	return {
		theme,
		selectedIemProfileId,
		preservePitch: raw.preservePitch !== false,
		outputDeviceId:
			typeof raw.outputDeviceId === "string" ? raw.outputDeviceId : null,
		recentDeviceIds: recentDeviceIds.slice(0, MAX_RECENT_DEVICES),
	};
}

function persist(patch: Partial<PersistedSettings>): void {
	const current = loadPrefs<PersistedSettings>("settings", initial);
	savePrefs("settings", { ...sanitizeSettings(current), ...patch });
}

export const useSettingsStore = create<SettingsState>()((set) => ({
	theme: initial.theme,
	eqEnabled: false,
	selectedIemProfileId: initial.selectedIemProfileId,
	preservePitch: initial.preservePitch,
	outputDeviceId: initial.outputDeviceId,
	recentDeviceIds: initial.recentDeviceIds,

	setTheme: (theme) => {
		persist({ theme });
		set({ theme });
	},
	setEqEnabled: (enabled) => set({ eqEnabled: enabled }),
	setSelectedIemProfileId: (id) => {
		persist({ selectedIemProfileId: id });
		set({ selectedIemProfileId: id });
	},
	setPreservePitch: (on) => {
		persist({ preservePitch: on });
		set({ preservePitch: on });
	},
	setOutputDeviceId: (id) => {
		persist({ outputDeviceId: id });
		set({ outputDeviceId: id });
	},
	touchRecentDevice: (id) => {
		const { recentDeviceIds } = useSettingsStore.getState();
		const next = [id, ...recentDeviceIds.filter((x) => x !== id)].slice(
			0,
			MAX_RECENT_DEVICES,
		);
		persist({ recentDeviceIds: next });
		set({ recentDeviceIds: next });
	},
}));
