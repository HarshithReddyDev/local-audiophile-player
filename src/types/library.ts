/**
 * Core domain models. Tracks are serializable metadata only — the actual
 * `File` bytes stay in a separate in-memory registry (see AudioFileReference)
 * so tracks can move to IndexedDB later without restructuring. Remote cloud
 * tracks follow the same rule: metadata persists, playback URLs never do.
 */

import type { CloudProviderId, RemoteTrackRef } from "../cloud/model";

export type RepeatMode = "off" | "all" | "one";

/**
 * Playback lifecycle. Exactly one holds at a time; `seeking` is a separate
 * orthogonal flag (see player store) so loading+playing-style contradictions
 * cannot be represented. `ready` = restorable queue entry, press play.
 */
export type PlaybackStatus =
	| "idle"
	| "loading"
	| "ready"
	| "playing"
	| "paused"
	| "ended"
	| "error";

export interface Track {
	id: string;
	title: string;
	artist: string;
	album: string;
	albumArtist: string;
	trackNumber: number | null;
	discNumber: number | null;
	/** Seconds; from tags initially, refined by the media element. Persisted. */
	duration: number | null;
	year: number | null;
	genre: string[];
	fileName: string;
	/** MIME type reported by the browser, may be empty. */
	fileType: string;
	fileSize: number;
	/** File modification time (ms epoch) for change detection; 0 when unknown. */
	mtime: number;
	/**
	 * Container/codec facts from tag parsing (all null when unknown — the
	 * browser exposes no per-file audio parameters, and this app never
	 * claims otherwise). Additive: older records simply lack it.
	 */
	audioInfo?: {
		sampleRate: number | null;
		channels: number | null;
		bitrate: number | null;
		bitsPerSample: number | null;
		codec: string | null;
	} | null;
	/**
	 * ReplayGain tags in dB/linear form (null fields when absent).
	 * Additive: older records simply lack it.
	 */
	replayGain?: {
		trackGainDb: number | null;
		trackPeak: number | null;
		albumGainDb: number | null;
		albumPeak: number | null;
	} | null;
	/**
	 * Lyrics from embedded tags or .lrc sidecars (null when none found).
	 * No network lyric services — local data only. Additive.
	 */
	lyrics?: {
		plain: string | null;
		synced: { t: number; text: string }[] | null;
		source: "embedded" | "lrc" | null;
	} | null;
	/**
	 * CUE virtual track: plays a segment of another library track's file.
	 * No audio is duplicated. Additive: absent for normal tracks.
	 */
	cue?: {
		/** Library id of the track holding the audio bytes. */
		audioTrackId: string;
		/** Segment start within the audio file, seconds. */
		startSec: number;
		/** Segment end, or null for end-of-file. */
		endSec: number | null;
		cueTrackNumber: number;
		cueTitle: string | null;
	} | null;
	/** Stable content id into the artwork cache; null when no artwork. */
	artworkId: string | null;
	/** Owning library source, null for one-off picked files without a source. */
	sourceId: string | null;
	/** Path relative to the source root (directory sources) or file name. */
	path: string | null;
	/** Epoch ms of first import. Never changes; drives Recently Added. */
	addedAt: number;
	/** Epoch ms of last metadata change. */
	updatedAt: number;
	/**
	 * True when the file cannot currently be reached (deleted, permission
	 * revoked, or picked file not re-selected after reload). UI shows an
	 * "Unavailable" badge instead of failing at play time.
	 */
	missing: boolean;
	/**
	 * Present for remote cloud tracks: provider identity + file id.
	 * Absent for local tracks. Playback URLs are NEVER stored here —
	 * they resolve fresh at play time (see src/cloud).
	 */
	remote?: RemoteTrackRef;
}

/** In-memory handle linking a track id to its local file bytes. Never persisted. */
export interface AudioFileReference {
	trackId: string;
	file: File;
}

export interface QueueItem {
	/** Stable key so duplicate tracks can be reordered/removed independently. */
	queueId: string;
	trackId: string;
}

export interface Album {
	id: string;
	name: string;
	albumArtist: string;
	year: number | null;
	trackIds: string[];
	artworkId: string | null;
}

export interface Artist {
	id: string;
	name: string;
	trackIds: string[];
	albumIds: string[];
}

export interface Playlist {
	id: string;
	name: string;
	trackIds: string[];
	createdAt: number;
	updatedAt: number;
	/** Starred by the user. Additive: older records simply lack it. */
	favorite?: boolean;
	/**
	 * Present when created by playlist import. Additive: older records
	 * simply lack it. Unmatched external tracks are NOT stored here —
	 * they live in the import session.
	 */
	importedFrom?: {
		provider: string;
		externalId: string;
		sourceUrl: string | null;
		importedAt: number;
	};
}

/** A durable import root: a picked folder, loose files, or a cloud account. */
export type LibrarySourceKind = "directory" | "files" | "cloud";

export interface LibrarySource {
	id: string;
	kind: LibrarySourceKind;
	name: string;
	/** Persisted handle; null for loose-file sources and where unsupported. */
	handle: FileSystemDirectoryHandle | null;
	addedAt: number;
	lastValidatedAt: number | null;
	/**
	 * Present for cloud sources: provider + local account identity.
	 * Tokens are never stored here (see src/cloud/token-store).
	 */
	cloud?: {
		provider: CloudProviderId;
		/** Local cloud-account id (matches Track.remote.accountId). */
		accountId: string;
		accountLabel: string;
	};
}

/** Capability/permission state of a library source (see docs). */
export type SourceStatus =
	| "unsupported"
	| "no-source"
	| "permission-required"
	| "permission-denied"
	| "auth-required"
	| "ready"
	| "stale"
	| "unavailable";

export interface Favorite {
	trackId: string;
	addedAt: number;
}

export interface Rating {
	trackId: string;
	/** 0–5 in 0.5 steps; 0 clears. */
	value: number;
	updatedAt: number;
}

export interface PlayStats {
	trackId: string;
	playCount: number;
	lastPlayedAt: number;
}

export interface HistoryEntry {
	/** Auto-incremented by the database. */
	seq?: number;
	trackId: string;
	startedAt: number;
	completedAt: number | null;
	completed: boolean;
}

/** Raw embedded artwork bytes from a tag parse (owned by the artwork cache). */
export interface ArtworkPayload {
	bytes: Uint8Array;
	mime: string;
}

/** One row of the library index: light enough to virtualize later. */
export interface LibraryEntry {
	track: Track;
}

let idCounter = 0;

/** Collision-resistant local id (crypto.randomUUID when available). */
export function newId(prefix: string): string {
	const rand =
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID().slice(0, 8)
			: `${Date.now().toString(36)}-${(idCounter += 1)}`;
	return `${prefix}-${rand}`;
}

/** Test/default factory so call sites and tests never hand-build Tracks. */
export function makeTrack(overrides: Partial<Track> & { id: string }): Track {
	return {
		title: "Unknown title",
		artist: "Unknown artist",
		album: "Unknown album",
		albumArtist: "Unknown artist",
		trackNumber: null,
		discNumber: null,
		duration: null,
		year: null,
		genre: [],
		fileName: "unknown",
		fileType: "",
		fileSize: 0,
		mtime: 0,
		artworkId: null,
		sourceId: null,
		path: null,
		addedAt: Date.now(),
		updatedAt: Date.now(),
		missing: false,
		...overrides,
	};
}
