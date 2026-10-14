/** Format seconds as m:ss or h:mm:ss. Non-finite input renders as em dash. */
export function formatTime(totalSeconds: number | null | undefined): string {
	if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "–:––";
	const clamped = Math.max(0, Math.floor(totalSeconds));
	const hours = Math.floor(clamped / 3600);
	const minutes = Math.floor((clamped % 3600) / 60);
	const seconds = clamped % 60;
	const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
	return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(seconds).padStart(2, "0")}`;
}

/** Clamp a value into [min, max]; NaN maps to min. */
export function clamp(value: number, min: number, max: number): number {
	if (Number.isNaN(value)) return min;
	return Math.min(max, Math.max(min, value));
}

/** Human file size, e.g. 4.2 MB. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.min(
		units.length - 1,
		Math.floor(Math.log(bytes) / Math.log(1024)),
	);
	const value = bytes / 1024 ** i;
	return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
