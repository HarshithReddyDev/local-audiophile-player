/**
 * Tiny typed localStorage persistence. Only user preferences are stored —
 * never audio bytes, file paths, or the track index (see docs/architecture.md).
 */

const PREFIX = "iem-player.";

export function loadPrefs<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(PREFIX + key);
		if (raw == null) return fallback;
		return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
	} catch {
		return fallback;
	}
}

export function savePrefs(key: string, value: unknown): void {
	try {
		localStorage.setItem(PREFIX + key, JSON.stringify(value));
	} catch {
		// Storage may be unavailable (private mode, quota). Preferences are
		// best-effort; playback must work without them.
	}
}
