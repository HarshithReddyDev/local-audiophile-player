/**
 * Provider-neutral playlist import domain.
 *
 * External playlists carry METADATA only — never streaming audio. Each
 * external track is matched deterministically against the local library
 * (see match.ts); unmatched tracks keep their metadata aside, never
 * becoming fake local track ids. The final local playlist uses existing
 * playlist infrastructure plus separate provenance.
 */

/** Sources an import can come from. File is fully local; the rest are
 * capability-described in providers.ts (no live OAuth ships). */
export type ImportProviderId =
	| "file"
	| "spotify"
	| "youtube"
	| "youtube-music"
	| "apple-music"
	| "deezer"
	| "tidal"
	| "soundcloud";

export interface ExternalTrack {
	provider: ImportProviderId;
	/** Provider-side id, URL, or file-relative key. "" when unknown. */
	externalId: string;
	title: string;
	artists: string[];
	album: string | null;
	/** Seconds; null when unknown. */
	durationSec: number | null;
	/** Only when the provider/file legally supplies it. */
	isrc: string | null;
	trackNumber: number | null;
	/** Canonical provider URL, if any (validated http(s) at parse). */
	sourceUrl: string | null;
	/** 0-based position in the source playlist. */
	position: number;
}

export interface ExternalPlaylist {
	provider: ImportProviderId;
	/** Stable identity for re-import detection (provider + source key). */
	externalId: string;
	name: string;
	description: string | null;
	owner: string | null;
	sourceUrl: string | null;
	importedAt: number;
	tracks: ExternalTrack[];
}

export type MatchState =
	| "matched"
	| "ambiguous"
	| "unmatched"
	| "unavailable"
	| "manual";

export type Confidence = "high" | "medium" | "low" | "none";

export interface TrackMatch {
	state: MatchState;
	/** Auto-link target (HIGH confidence, exactly one candidate). */
	localTrackId: string | null;
	/** All viable local candidates for review (ids). */
	candidates: string[];
	confidence: Confidence;
}

export interface ImportItem {
	/** Stable within one import: `${position}:${title}` hash. */
	key: string;
	external: ExternalTrack;
	match: TrackMatch;
	/** True once the user explicitly chose/skipped (preserved on update). */
	userResolved: boolean;
	/** User chose to leave this track out of the local playlist. */
	skipped: boolean;
}

export interface ImportSession {
	id: string;
	provider: ImportProviderId;
	externalId: string;
	name: string;
	description: string | null;
	sourceUrl: string | null;
	importedAt: number;
	updatedAt: number;
	/** Local playlist created from this import, if any. */
	localPlaylistId: string | null;
	items: ImportItem[];
}

/** Provenance stored on the local playlist (additive, optional). */
export interface PlaylistImportProvenance {
	provider: ImportProviderId;
	externalId: string;
	sourceUrl: string | null;
	importedAt: number;
}

/** Summary counts for the review UI. */
export function summarizeMatches(
	items: ImportItem[],
): Record<MatchState, number> {
	const out: Record<MatchState, number> = {
		matched: 0,
		ambiguous: 0,
		unmatched: 0,
		unavailable: 0,
		manual: 0,
	};
	for (const item of items) {
		if (item.skipped) continue;
		out[item.match.state] += 1;
	}
	return out;
}
