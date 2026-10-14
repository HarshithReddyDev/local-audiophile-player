import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { registerServiceWorker } from "./pwa/registerSW";
import { usePlayerStore } from "./state/player-store";
import type { Theme } from "./state/settings-store";
import { useSettingsStore } from "./state/settings-store";
import { loadPrefs, savePrefs } from "./storage/persistence";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

/**
 * Restore persisted output preferences (volume/mute/rate). Queue order and
 * transport modes (repeat/shuffle/crossfade) live in IndexedDB and restore
 * later via the library service — single source per setting, no conflicts.
 */
function hydratePlayerPrefs(): void {
	const prefs = loadPrefs("player", {
		volume: 1,
		muted: false,
		rate: 1,
	});
	// Clamp untrusted stored values through the same bounds as the live
	// setters: corrupt prefs (NaN, strings, out-of-range) must never reach
	// the engine or persist further.
	const volume =
		typeof prefs.volume === "number" && Number.isFinite(prefs.volume)
			? Math.min(1, Math.max(0, prefs.volume))
			: 1;
	const rate =
		typeof prefs.rate === "number" && Number.isFinite(prefs.rate)
			? Math.min(2, Math.max(0.25, prefs.rate))
			: 1;
	usePlayerStore.setState({
		volume,
		muted: prefs.muted === true,
		rate,
	});
	// Selector subscription: time/duration updates must not trigger writes.
	usePlayerStore.subscribe(
		(s) => ({
			volume: s.volume,
			muted: s.muted,
			rate: s.rate,
		}),
		(prefs) => savePrefs("player", prefs),
	);
}

function applyTheme(theme: Theme): void {
	const light =
		theme === "light" ||
		(theme === "system" &&
			window.matchMedia("(prefers-color-scheme: light)").matches);
	document.documentElement.classList.toggle("light", light);
}

function watchTheme(): void {
	applyTheme(useSettingsStore.getState().theme);
	window
		.matchMedia("(prefers-color-scheme: light)")
		.addEventListener("change", () =>
			applyTheme(useSettingsStore.getState().theme),
		);
	useSettingsStore.subscribe((s) => applyTheme(s.theme));
}

hydratePlayerPrefs();
watchTheme();
registerServiceWorker();

createRoot(rootElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
