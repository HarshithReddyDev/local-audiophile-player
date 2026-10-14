/**
 * ReplayGain: tag parsing + mode selection as pure functions. The single
 * gain application point lives in the playback controller (added to the
 * preamp exactly once) — this module never touches audio.
 *
 * Tag text looks like "-6.54 dB" (case-insensitive, optional "dB").
 * Peaks are linear ratios (or dB text in some taggers — both accepted).
 */

export type ReplayGainMode = "off" | "track" | "album";

export const REPLAYGAIN_MODES: ReplayGainMode[] = ["off", "track", "album"];

export interface ReplayGainTags {
	trackGainDb: number | null;
	trackPeak: number | null;
	albumGainDb: number | null;
	albumPeak: number | null;
}

export const EMPTY_REPLAYGAIN_TAGS: ReplayGainTags = {
	trackGainDb: null,
	trackPeak: null,
	albumGainDb: null,
	albumPeak: null,
};

/** Parse "-6.54 dB" (or bare "-6.54") to dB; null when unparseable. */
export function parseGainText(value: unknown): number | null {
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value < -60 || value > 60) return null;
		return value;
	}
	if (typeof value !== "string") return null;
	const match = value.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*(?:db)?$/i);
	if (!match?.[1]) return null;
	const db = Number(match[1]);
	if (!Number.isFinite(db) || db < -60 || db > 60) return null;
	return db;
}

/**
 * Parse a peak value: linear ratio preferred ("0.987"), dB text accepted
 * ("-0.11 dB" → ratio). Clamped to (0, 8]; null when unparseable.
 */
export function parsePeakText(value: unknown): number | null {
	if (typeof value === "number") {
		return value > 0 && Number.isFinite(value) && value <= 8 ? value : null;
	}
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	const dbMatch = trimmed.match(/^([+-]?\d+(?:\.\d+)?)\s*db$/i);
	if (dbMatch?.[1]) {
		const db = Number(dbMatch[1]);
		if (!Number.isFinite(db)) return null;
		return Math.min(8, 10 ** (db / 20));
	}
	const ratio = Number(trimmed);
	if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 8) return null;
	return ratio;
}

/** Normalize a raw tag record (music-metadata common or flat) to tags. */
export function normalizeReplayGainTags(
	raw: Record<string, unknown>,
): ReplayGainTags {
	// music-metadata exposes IRatio objects { dB, ratio } on common;
	// flat tag maps carry strings. Both accepted.
	const ratioOf = (value: unknown, want: "gain" | "peak"): number | null => {
		if (typeof value === "object" && value !== null) {
			const record = value as Record<string, unknown>;
			if (want === "gain") return parseGainText(record["dB"]);
			return parsePeakText(record["ratio"]);
		}
		return want === "gain" ? parseGainText(value) : parsePeakText(value);
	};
	const pick = (...keys: string[]): unknown => {
		for (const key of keys) {
			const value = raw[key];
			if (value !== undefined && value !== null) return value;
		}
		return null;
	};
	return {
		trackGainDb: ratioOf(
			pick("replaygain_track_gain", "REPLAYGAIN_TRACK_GAIN"),
			"gain",
		),
		trackPeak: ratioOf(
			pick("replaygain_track_peak", "REPLAYGAIN_TRACK_PEAK"),
			"peak",
		),
		albumGainDb: ratioOf(
			pick("replaygain_album_gain", "REPLAYGAIN_ALBUM_GAIN"),
			"gain",
		),
		albumPeak: ratioOf(
			pick("replaygain_album_peak", "REPLAYGAIN_ALBUM_PEAK"),
			"peak",
		),
	};
}

export interface ReplayGainSelection {
	/** dB to add to the preamp path (0 when off/unavailable). */
	gainDb: number;
	/** Which tag supplied it (display + debugging). */
	source: "track" | "album" | "none";
	/** True when the peak guard reduced the gain (clipping prevented). */
	limitedByPeak: boolean;
}

/**
 * Select the applied gain. Fallback: album mode falls back to track tags
 * when album tags are absent (standard behavior, stated in the UI).
 * Peak guard: when a peak is known and gain + peak would exceed full
 * scale, the gain is reduced by exactly the excess.
 */
export function selectReplayGain(
	mode: ReplayGainMode,
	tags: ReplayGainTags,
): ReplayGainSelection {
	if (mode === "off")
		return { gainDb: 0, source: "none", limitedByPeak: false };
	let gain: number | null = null;
	let peak: number | null = null;
	let source: "track" | "album" | "none" = "none";
	if (mode === "track" && tags.trackGainDb !== null) {
		gain = tags.trackGainDb;
		peak = tags.trackPeak;
		source = "track";
	} else if (mode === "album") {
		if (tags.albumGainDb !== null) {
			gain = tags.albumGainDb;
			peak = tags.albumPeak;
			source = "album";
		} else if (tags.trackGainDb !== null) {
			gain = tags.trackGainDb;
			peak = tags.trackPeak;
			source = "track";
		}
	}
	if (gain === null) return { gainDb: 0, source: "none", limitedByPeak: false };
	if (peak !== null && peak > 0) {
		const peakDb = 20 * Math.log10(peak);
		const excess = gain + peakDb;
		if (excess > 0) {
			return { gainDb: gain - excess, source, limitedByPeak: true };
		}
	}
	return { gainDb: gain, source, limitedByPeak: false };
}
