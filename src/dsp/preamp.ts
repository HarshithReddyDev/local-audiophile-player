/**
 * Preamp: a plain dB in/out gain stage ahead of the PEQ bands. This is NOT
 * master volume — it sets headroom for boosted EQ (cut first, then boost),
 * while master volume remains the listener's output control.
 */
import { BAND_LIMITS } from "./types";

export function dbToGain(db: number): number {
	if (!Number.isFinite(db)) return 1;
	return 10 ** (clampPreamp(db) / 20);
}

export function gainToDb(gain: number): number {
	if (!(gain > 0) || !Number.isFinite(gain)) return Number.NEGATIVE_INFINITY;
	return 20 * Math.log10(gain);
}

export function clampPreamp(db: number): number {
	if (!Number.isFinite(db)) return 0;
	return Math.min(BAND_LIMITS.preamp.max, Math.max(BAND_LIMITS.preamp.min, db));
}

/**
 * Suggested preamp compensation for a profile: negate the maximum positive
 * excursion so boosts cannot clip downstream. Advisory only — the limiter
 * remains the safety net, and the user always has the final say.
 */
export function suggestedPreampCompensation(peakDb: number): number {
	if (!Number.isFinite(peakDb) || peakDb <= 0) return 0;
	return clampPreamp(-peakDb);
}
