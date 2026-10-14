/**
 * Deterministic local matching: external metadata → local library tracks.
 *
 * Everything runs locally on already-imported metadata; the library is
 * never uploaded anywhere. No fuzzy machinery: normalization is explicit
 * (Unicode, case, punctuation, featured artists, version tags), scoring is
 * rule-based, and only HIGH-confidence single candidates auto-link.
 * Anything else is ambiguous/unmatched for the user to resolve.
 */

import type { Confidence, ExternalTrack, TrackMatch } from "./model";

export interface LocalCandidate {
	id: string;
	title: string;
	artist: string;
	album: string;
	/** Seconds; null when unknown. */
	durationSec: number | null;
	isrc: string | null;
}

/** Seconds of slack when comparing durations. */
const DURATION_SLACK_SEC = 3;

const FEAT_SPLIT = /\s+(?:feat\.?|ft\.?|featuring|with|con|mit)\s+/i;

/** Normalize free text for comparison (NOT for display). */
export function normalizeText(text: string): string {
	return text
		.normalize("NFKD")
		.replaceAll(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replaceAll(/[“”«»„‟]/g, '"')
		.replaceAll(/[‘’‚‛]/g, "'")
		.replaceAll(/[^a-z0-9\s&'+$-]/g, " ")
		.replaceAll(/\s+/g, " ")
		.trim();
}

/** "Artist A feat. B" → ["artist a", "b"]. Primary artist first. */
export function splitArtists(raw: string): string[] {
	return raw
		.split(/\s*[,&;]\s*|\s+and\s+|\s+x\s+|\s+vs\.?\s+/i)
		.flatMap((part) => part.split(FEAT_SPLIT))
		.map((a) => normalizeText(a))
		.filter((a) => a !== "");
}

/**
 * Split "Title (Remix)" into base + version tags. Parenthetical content is
 * a version signal, not part of identity: matching compares bases, and an
 * equal base with different tags lowers confidence instead of failing.
 */
export function splitVersion(title: string): { base: string; tags: string[] } {
	const tags: string[] = [];
	const base = title.replaceAll(
		/\s*[[(]([^)\]]*)[\])]/g,
		(_, inner: string) => {
			const tag = normalizeText(inner);
			if (tag) tags.push(tag);
			return "";
		},
	);
	return { base: normalizeText(base), tags };
}

function sameVersion(a: string[], b: string[]): boolean {
	if (a.length === 0 && b.length === 0) return true;
	return a.some((t) => b.includes(t));
}

function durationsClose(a: number | null, b: number | null): boolean {
	if (a === null || b === null) return false;
	return Math.abs(a - b) <= DURATION_SLACK_SEC;
}

/**
 * Score one external/local pair. Returns confidence only — the caller
 * decides auto-link vs review from candidate count + threshold.
 */
export function scorePair(
	external: ExternalTrack,
	local: LocalCandidate,
): Confidence {
	// ISRC is an industry identifier: exact match short-circuits.
	if (
		external.isrc &&
		local.isrc &&
		external.isrc.replaceAll(/[\s-]/g, "").toUpperCase() ===
			local.isrc.replaceAll(/[\s-]/g, "").toUpperCase()
	) {
		return "high";
	}
	const extArtists = external.artists.flatMap(splitArtists);
	const localArtists = splitArtists(local.artist);
	const artistHit =
		extArtists.length > 0 &&
		localArtists.length > 0 &&
		extArtists.some((a) => localArtists.includes(a));
	if (!artistHit) return "none";

	const extVer = splitVersion(external.title);
	const localVer = splitVersion(local.title);
	if (extVer.base === "" || extVer.base !== localVer.base) return "none";

	const albumHit =
		external.album !== null &&
		normalizeText(external.album) !== "" &&
		normalizeText(external.album) === normalizeText(local.album);
	const durationHit = durationsClose(external.durationSec, local.durationSec);
	const versionOk = sameVersion(extVer.tags, localVer.tags);

	// Title + artist agree. Corroborate before calling it HIGH.
	if ((albumHit || durationHit) && versionOk) return "high";
	if (versionOk) return "medium";
	// Same song, different version tag (live vs studio): usable lead only.
	return "low";
}

/**
 * Match one external track against the library. Deterministic: candidates
 * are evaluated in library order; ties keep every candidate.
 *
 * Auto-link ONLY on exactly one HIGH candidate. Multiple HIGHs (e.g. same
 * song on two albums) are ambiguous — never silently pick one.
 */
export function matchTrack(
	external: ExternalTrack,
	library: LocalCandidate[],
): TrackMatch {
	const scored = library.map((local) => ({
		id: local.id,
		confidence: scorePair(external, local),
	}));
	const highs = scored.filter((s) => s.confidence === "high");
	if (highs.length === 1 && highs[0]) {
		return {
			state: "matched",
			localTrackId: highs[0].id,
			candidates: [highs[0].id],
			confidence: "high",
		};
	}
	const reviewable = scored.filter(
		(s) => s.confidence === "high" || s.confidence === "medium",
	);
	if (highs.length > 1 || reviewable.length > 0) {
		return {
			state: "ambiguous",
			localTrackId: null,
			candidates: reviewable.map((s) => s.id),
			confidence: highs.length > 1 ? "high" : "medium",
		};
	}
	const lows = scored.filter((s) => s.confidence === "low");
	if (lows.length > 0) {
		return {
			state: "ambiguous",
			localTrackId: null,
			candidates: lows.map((s) => s.id),
			confidence: "low",
		};
	}
	return {
		state: "unmatched",
		localTrackId: null,
		candidates: [],
		confidence: "none",
	};
}

/** Match a whole playlist, preserving order. Pure and cancellable-by-slice. */
export function matchPlaylist(
	tracks: ExternalTrack[],
	library: LocalCandidate[],
): TrackMatch[] {
	return tracks.map((t) => matchTrack(t, library));
}
