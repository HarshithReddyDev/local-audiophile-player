/**
 * Database schema (DB v3: v1 library, v2 IEM, v3 playlist imports). Record
 * types are persistence shapes: runtime-only fields (object URLs, File
 * handles for playback) never enter these stores.
 */

import type { IEMProfile, Measurement, TargetCurve } from "../iem/types";
import type { ImportSession } from "../import/model";
import type {
	Favorite,
	HistoryEntry,
	LibrarySource,
	Playlist,
	PlayStats,
	Rating,
	Track,
} from "../types/library";

/** Stored track: identical to the UI Track (no runtime-only fields remain). */
export type TrackRecord = Track;

export interface ArtworkRecord {
	id: string;
	blob: Blob;
	mime: string;
	width: number | null;
	height: number | null;
	refs: number;
}

export interface SourceRecord extends LibrarySource {}

export interface MetaRecord {
	key: string;
	value: unknown;
}

/** Persisted playlist-import session (external metadata + resolutions). */
export interface ImportSessionRecord extends ImportSession {}

export const DB_NAME = "iem-player-library";
export const DB_VERSION = 3;

export const STORES = {
	tracks: "tracks",
	sources: "sources",
	artwork: "artwork",
	playlists: "playlists",
	favorites: "favorites",
	ratings: "ratings",
	history: "history",
	stats: "stats",
	meta: "meta",
	measurements: "measurements",
	targets: "targets",
	iemProfiles: "iemProfiles",
	playlistImports: "playlistImports",
} as const;

export interface Schema {
	tracks: TrackRecord;
	sources: SourceRecord;
	artwork: ArtworkRecord;
	playlists: Playlist;
	favorites: Favorite;
	ratings: Rating;
	history: HistoryEntry;
	stats: PlayStats;
	meta: MetaRecord;
	measurements: Measurement;
	targets: TargetCurve;
	iemProfiles: IEMProfile;
	playlistImports: ImportSession;
}

export function toRecord(track: Track): TrackRecord {
	return { ...track };
}

export function fromRecord(record: TrackRecord): Track {
	return { ...record };
}
