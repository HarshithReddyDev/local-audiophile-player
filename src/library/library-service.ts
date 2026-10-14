/**
 * LibraryService — orchestration between scanner, repository, and stores.
 *
 * UI components never touch IndexedDB: they call this service (or read the
 * stores), and the service persists first, then syncs state. The player
 * resolves playable Files here too: session registry first, then the stored
 * directory handle walked on demand — audio bytes are never persisted.
 */
import {
	ArtworkUrlCache,
	processArtwork,
	toRecord as toArtworkRecord,
} from "../db/artwork-cache";
import { queryHandlePermission, requestHandlePermission } from "../db/handles";
import {
	directorySourceId,
	looseFileTrackId,
	resolveCollision,
	stableTrackId,
} from "../db/identity";
import { LibraryRepository } from "../db/repository";
import { toRecord } from "../db/schema";
import type { FitRangePresetId, HfTreatment } from "../dsp/autoeq";
import { parseCurveText } from "../dsp/curve-io";
import type { TargetBuilderParams } from "../dsp/curves";
import { buildParametricTarget } from "../dsp/curves";
import type { SmoothingPresetId } from "../dsp/smoothing";
import type { SerializedPEQ } from "../dsp/types";
import type { IEMProfile, Measurement, TargetCurve } from "../iem/types";
import type { ImportSession } from "../import/model";
import { sessionLocalIds } from "../import/session";
import { useDspStore } from "../state/dsp-store";
import { useEQStore } from "../state/eq-store";
import { useIEMStore } from "../state/iem-store";
import { useLibraryStore } from "../state/library-store";
import { usePlayerStore } from "../state/player-store";
import { useSettingsStore } from "../state/settings-store";
import type {
	ArtworkPayload,
	LibrarySource,
	PlayStats,
	RepeatMode,
	Track,
} from "../types/library";
import { newId } from "../types/library";
import { diffScan } from "./diff";
import type { ScannedFile } from "./scanner";
import { scanDirectory, scanFiles, supportsDirectoryPicker } from "./scanner";

export interface IngestResult {
	added: string[];
	updated: string[];
}

/**
 * What the playback controller loads onto a deck. Local tracks resolve
 * to bytes the engine turns into an owned blob URL; remote tracks
 * resolve to a borrowed provider URL (never persisted, refreshed on
 * expiry). The engine consumes both without a second code path.
 */
export type PlayableTrackSource =
	| { kind: "file"; file: File }
	| {
			kind: "url";
			url: string;
			mimeType: string | null;
			expiresAt: number;
			supportsRange: boolean;
			refresh: (() => Promise<PlayableTrackSource>) | null;
	  };

export interface PersistedQueueState {
	version: 1;
	trackIds: string[];
	index: number;
	/** Preferred anchor: the track that was current at save time. */
	currentTrackId?: string;
	repeat: RepeatMode;
	shuffle: boolean;
	crossfadeEnabled: boolean;
	crossfadeDuration: number;
}

const QUEUE_STATE_KEY = "queue-state";

/**
 * Migration-safe parse: any shape violation yields null (fresh queue)
 * instead of a crash. Unknown fields are ignored for forward compatibility.
 */
export function parseQueueState(raw: unknown): PersistedQueueState | null {
	if (typeof raw !== "object" || raw === null) return null;
	const v = raw as Record<string, unknown>;
	if (v["version"] !== 1) return null;
	if (
		!Array.isArray(v["trackIds"]) ||
		!v["trackIds"].every((t) => typeof t === "string")
	)
		return null;
	if (typeof v["index"] !== "number" || !Number.isFinite(v["index"]))
		return null;
	if (v["repeat"] !== "off" && v["repeat"] !== "all" && v["repeat"] !== "one")
		return null;
	if (typeof v["shuffle"] !== "boolean") return null;
	if (typeof v["crossfadeEnabled"] !== "boolean") return null;
	if (
		typeof v["crossfadeDuration"] !== "number" ||
		!Number.isFinite(v["crossfadeDuration"])
	)
		return null;
	const currentTrackId =
		typeof v["currentTrackId"] === "string" ? v["currentTrackId"] : undefined;
	const state: PersistedQueueState = {
		version: 1,
		trackIds: v["trackIds"] as string[],
		index: v["index"] as number,
		repeat: v["repeat"] as RepeatMode,
		shuffle: v["shuffle"] as boolean,
		crossfadeEnabled: v["crossfadeEnabled"] as boolean,
		crossfadeDuration: v["crossfadeDuration"] as number,
	};
	if (currentTrackId !== undefined) state.currentTrackId = currentTrackId;
	return state;
}

interface ActivePlayback {
	trackId: string;
	seq: number;
	startedAt: number;
}

function store(): ReturnType<typeof useLibraryStore.getState> {
	return useLibraryStore.getState();
}

class LibraryService {
	readonly repo = new LibraryRepository();
	readonly urls = new ArtworkUrlCache();
	/** False when IndexedDB is unavailable: memory-only mode. */
	persistent = false;
	private active: ActivePlayback | null = null;

	// -- lifecycle ------------------------------------------------------

	/** Test/restart helper: closes the database and clears runtime state. */
	async dispose(): Promise<void> {
		if (this.queueUnsubscribe) {
			this.queueUnsubscribe();
			this.queueUnsubscribe = null;
		}
		if (this.active && this.persistent) {
			try {
				await this.repo.recordPlayEnd(this.active.seq, false, Date.now());
			} catch {
				// Best-effort on teardown.
			}
		}
		this.active = null;
		this.urls.revokeAll();
		await this.repo.close();
		this.persistent = false;
	}

	async initialize(): Promise<{ persistent: boolean }> {
		this.persistent = await this.repo.init();
		if (!this.persistent) return { persistent: false };
		store().setRestoring(true);
		try {
			const [
				tracks,
				playlists,
				favorites,
				ratings,
				stats,
				sources,
				measurements,
				targets,
				profiles,
			] = await Promise.all([
				this.repo.getAllTracks(),
				this.repo.getPlaylists(),
				this.repo.getFavorites(),
				this.repo.getRatings(),
				this.repo.getAllStats(),
				this.repo.getSources(),
				this.repo.getMeasurements(),
				this.repo.getTargets(),
				this.repo.getProfiles(),
			]);
			const statsById: Record<string, PlayStats> = {};
			for (const s of stats) statsById[s.trackId] = s;
			const ratingsById: Record<string, number> = {};
			for (const r of ratings) ratingsById[r.trackId] = r.value;
			store().hydrate({
				tracks,
				playlists,
				favoriteIds: favorites.map((f) => f.trackId),
				ratings: ratingsById,
				stats: statsById,
				sources,
			});
			useIEMStore.getState().hydrate({ measurements, targets, profiles });
			// Loose-file tracks have no handle to re-resolve: mark them
			// missing until the user re-selects the file.
			const orphaned = tracks.filter((t) => !t.sourceId && !t.missing);
			if (orphaned.length > 0) {
				const patched = orphaned.map((t) => ({ ...t, missing: true }));
				await this.repo.saveTracks(patched);
				store().upsertTracks(patched);
			}
			// Queue + transport modes restore after the library so stale ids
			// can be validated against real records.
			await this.restoreQueueState();
			this.startQueuePersistence();
			// Directory sources: status now, background validation when the
			// permission is already granted (no prompt without a gesture).
			// Cloud sources: live token means ready, otherwise sign-in needed.
			// Remote tracks stay in place either way — never deleted for
			// being temporarily unreachable.
			for (const source of sources) {
				if (source.kind === "cloud") {
					const { hasLiveToken } = await import("../cloud/registry");
					const accountId = source.cloud?.accountId;
					store().setSourceStatus(
						source.id,
						accountId && hasLiveToken(accountId) ? "ready" : "auth-required",
					);
					continue;
				}
				if (source.kind !== "directory" || !source.handle) {
					store().setSourceStatus(source.id, "unavailable");
					continue;
				}
				const permission = await queryHandlePermission(source.handle);
				if (permission === "granted") {
					store().setSourceStatus(source.id, "ready");
					void this.revalidateSource(source.id);
				} else if (permission === "denied") {
					store().setSourceStatus(source.id, "permission-denied");
				} else {
					store().setSourceStatus(source.id, "permission-required");
				}
			}
		} finally {
			store().setRestoring(false);
		}
		return { persistent: true };
	}

	// -- import ----------------------------------------------------------

	/** Loose files from picker/drop: no source, filename-based identity. */
	async importPickedFiles(
		files: Iterable<File>,
		onProgress?: (processed: number, total: number) => void,
	): Promise<IngestResult> {
		const scanned = await scanFiles(files, ({ processed, total }) =>
			onProgress?.(processed, total),
		);
		const existing = new Map(
			store().order.map((id) => [id, store().tracks[id]] as const),
		);
		const records: Track[] = [];
		const result: IngestResult = { added: [], updated: [] };
		for (const item of scanned) {
			// Loose-file identity derives from name+size+mtime, so an id
			// match always means the same logical file: update in place.
			// (A 32-bit hash collision between different inputs would merge;
			// that 2^-32 risk is documented in identity.ts.)
			const id = looseFileTrackId(
				item.file.name,
				item.file.size,
				item.file.lastModified,
			);
			const known = existing.get(id);
			const now = Date.now();
			const track: Track = {
				...item.track,
				id,
				sourceId: null,
				path: item.relativePath,
				fileName: item.file.name,
				fileType: item.file.type,
				fileSize: item.file.size,
				mtime: item.file.lastModified,
				artworkId: item.artwork
					? await this.cacheArtwork(item.artwork, known?.artworkId ?? null)
					: null,
				addedAt: known?.addedAt ?? now,
				updatedAt: now,
				missing: false,
			};
			if (!known) result.added.push(id);
			else {
				this.releaseArtworkIfReplaced(known.artworkId, track.artworkId);
				result.updated.push(id);
			}
			records.push(track);
			store().registerFile(id, item.file);
		}
		await this.persistTracks(records);
		return result;
	}

	/** Folder import: stable source identity, incremental diff, handle saved. */
	async importDirectory(
		dir: FileSystemDirectoryHandle,
		onProgress?: (processed: number, total: number) => void,
	): Promise<IngestResult> {
		const found = Object.values(store().sources).find(
			(s) => s.kind === "directory" && s.name === dir.name,
		);
		const sourceId =
			found?.id ??
			resolveCollision(
				directorySourceId(dir.name),
				new Set(Object.keys(store().sources)),
			);
		const source: LibrarySource = {
			id: sourceId,
			kind: "directory",
			name: dir.name,
			handle: dir,
			addedAt: found?.addedAt ?? Date.now(),
			lastValidatedAt: Date.now(),
		};
		const scanned = await scanDirectory(dir, ({ processed, total }) =>
			onProgress?.(processed, total),
		);
		const result = await this.ingestScanned(scanned, source);
		if (this.persistent) await this.repo.saveSource(source);
		store().setSources([
			...Object.values(store().sources).filter((s) => s.id !== sourceId),
			source,
		]);
		store().setSourceStatus(sourceId, "ready");
		return result;
	}

	// -- revalidation ----------------------------------------------------

	async revalidateSource(
		sourceId: string,
		onProgress?: (processed: number, total: number) => void,
	): Promise<IngestResult | null> {
		const source = store().sources[sourceId];
		if (!source || source.kind !== "directory" || !source.handle) return null;
		if (!supportsDirectoryPicker()) {
			store().setSourceStatus(sourceId, "unsupported");
			return null;
		}
		const permission = await queryHandlePermission(source.handle);
		if (permission !== "granted") {
			store().setSourceStatus(
				sourceId,
				permission === "denied" ? "permission-denied" : "permission-required",
			);
			return null;
		}
		const scanned = await scanDirectory(source.handle, ({ processed, total }) =>
			onProgress?.(processed, total),
		);
		const result = await this.ingestScanned(scanned, source, true);
		if (this.persistent) {
			await this.repo.saveSource({ ...source, lastValidatedAt: Date.now() });
		}
		return result;
	}

	/** Gesture handler for the "Reconnect folder" button. */
	async requestSourceAccess(sourceId: string): Promise<boolean> {
		const source = store().sources[sourceId];
		if (!source?.handle) return false;
		const granted = await requestHandlePermission(source.handle);
		store().setSourceStatus(sourceId, granted ? "ready" : "permission-denied");
		if (granted) void this.revalidateSource(sourceId);
		return granted;
	}

	// -- file resolution --------------------------------------------------
	//
	// Playback needs a File. Session registry first (picked files, already
	// resolved tracks), then the stored directory handle walked on demand.

	/**
	 * Resolve a track to something the engine can load: local bytes or a
	 * borrowed remote URL. Remote URLs are memory-only and may carry an
	 * expiry plus a refresh closure — the controller retries once with a
	 * fresh URL before surfacing an error.
	 */
	async resolvePlayable(trackId: string): Promise<PlayableTrackSource | null> {
		const track = store().tracks[trackId];
		if (!track) return null;
		if (track.remote) {
			const { resolveRemoteSource } = await import("../cloud/registry");
			const { defaultFetch } = await import("../cloud/oauth");
			const resolved = await resolveRemoteSource(track, defaultFetch);
			if (!resolved) return null;
			const refresh = resolved.refresh
				? async (): Promise<PlayableTrackSource> => {
						const next = await resolved.refresh?.();
						if (!next) throw new Error("refresh failed");
						return {
							kind: "url",
							url: next.url,
							mimeType: next.mimeType,
							expiresAt: next.expiresAt,
							supportsRange: next.supportsRange,
							refresh: null,
						};
					}
				: null;
			return {
				kind: "url",
				url: resolved.url,
				mimeType: resolved.mimeType,
				expiresAt: resolved.expiresAt,
				supportsRange: resolved.supportsRange,
				refresh,
			};
		}
		const file = await this.resolveFile(trackId);
		return file ? { kind: "file", file } : null;
	}

	async resolveFile(trackId: string): Promise<File | null> {
		const cached = store().getFile(trackId);
		if (cached) return cached;
		const track = store().tracks[trackId];
		// CUE virtual tracks share their parent's bytes (one hop, no loops:
		// virtual tracks never nest — enforced at import).
		if (track?.cue) {
			if (track.cue.audioTrackId === trackId) return null;
			const parent = await this.resolveFile(track.cue.audioTrackId);
			if (parent) store().registerFile(trackId, parent);
			return parent;
		}
		if (!track?.sourceId || !track.path) return null;
		const source = store().sources[track.sourceId];
		if (source?.kind !== "directory" || !source.handle) return null;
		if ((await queryHandlePermission(source.handle)) !== "granted") return null;
		try {
			const segments = track.path.split("/");
			const fileName = segments.pop();
			if (!fileName) return null;
			let dir = source.handle;
			for (const segment of segments) {
				dir = await dir.getDirectoryHandle(segment);
			}
			const file = await (await dir.getFileHandle(fileName)).getFile();
			store().registerFile(trackId, file);
			if (track.missing) {
				store().patchTrack(trackId, { missing: false });
				if (this.persistent)
					await this.repo.saveTracks([{ ...track, missing: false }]);
			}
			return file;
		} catch {
			return null;
		}
	}

	// -- library mutations ------------------------------------------------

	/** Persist a source record (local or cloud) and mirror it to the store. */
	async upsertSourceRecord(source: LibrarySource): Promise<void> {
		if (this.persistent) await this.repo.saveSource(source);
		store().setSources([
			...Object.values(store().sources).filter((s) => s.id !== source.id),
			source,
		]);
	}

	/** Drop a source record; tracks are handled separately (never cascade). */
	async deleteSourceRecord(sourceId: string): Promise<void> {
		if (this.persistent) await this.repo.deleteSource(sourceId);
		store().setSources(
			Object.values(store().sources).filter((s) => s.id !== sourceId),
		);
	}

	/**
	 * Mark every track of a source missing/available (disconnect, removal,
	 * reconnect). Records, playlists, history, favorites, and ratings are
	 * preserved — only reachability flips.
	 */
	async markSourceTracks(sourceId: string, missing: boolean): Promise<number> {
		const now = Date.now();
		const patched = Object.values(store().tracks)
			.filter((t) => t.sourceId === sourceId && t.missing !== missing)
			.map((t) => ({ ...t, missing, updatedAt: now }));
		if (patched.length > 0) await this.persistTracks(patched);
		return patched.length;
	}

	/** Persist remote-track metadata (no bytes fetched, none registered). */
	async saveRemoteTracks(tracks: Track[]): Promise<void> {
		if (tracks.length > 0) await this.persistTracks(tracks);
	}

	async removeTrack(id: string): Promise<void> {
		const track = store().tracks[id];
		if (this.persistent) {
			await this.repo.deleteTrack(id);
			if (track?.artworkId) {
				if (await this.repo.releaseArtwork(track.artworkId))
					this.urls.revoke(track.artworkId);
			}
		} else if (track?.artworkId) {
			this.urls.revoke(track.artworkId);
		}
		store().removeTrack(id);
	}

	async clearLibrary(): Promise<void> {
		if (this.persistent) await this.repo.clearTracks();
		this.urls.revokeAll();
		store().clearLibrary();
	}

	async toggleFavorite(trackId: string): Promise<boolean> {
		const favored = store().favorites.includes(trackId);
		if (favored) {
			if (this.persistent) await this.repo.removeFavorite(trackId);
			store().setFavorites(store().favorites.filter((t) => t !== trackId));
			return false;
		}
		if (this.persistent) await this.repo.addFavorite(trackId);
		store().setFavorites([trackId, ...store().favorites]);
		return true;
	}

	async setRating(trackId: string, value: number): Promise<void> {
		if (this.persistent) await this.repo.setRating(trackId, value);
		const ratings = { ...store().ratings };
		if (value <= 0) delete ratings[trackId];
		else ratings[trackId] = Math.min(5, Math.round(value * 2) / 2);
		store().setRatings(ratings);
	}

	async createPlaylist(name: string, trackIds: string[]): Promise<string> {
		const id = store().createPlaylist(name, trackIds);
		if (this.persistent) {
			const playlist = store().playlists[id];
			if (playlist) await this.repo.savePlaylist(playlist);
		}
		return id;
	}

	async renamePlaylist(id: string, name: string): Promise<void> {
		store().renamePlaylist(id, name);
		if (this.persistent) {
			const playlist = store().playlists[id];
			if (playlist) await this.repo.savePlaylist(playlist);
		}
	}

	async addToPlaylist(id: string, trackIds: string[]): Promise<void> {
		store().addToPlaylist(id, trackIds);
		if (this.persistent) {
			const playlist = store().playlists[id];
			if (playlist) await this.repo.savePlaylist(playlist);
		}
	}

	async removeFromPlaylist(playlistId: string, trackId: string): Promise<void> {
		store().removeFromPlaylist(playlistId, trackId);
		if (this.persistent) {
			const playlist = store().playlists[playlistId];
			if (playlist) await this.repo.savePlaylist(playlist);
		}
	}

	async deletePlaylist(id: string): Promise<void> {
		store().deletePlaylist(id);
		if (this.persistent) await this.repo.deletePlaylist(id);
	}

	async togglePlaylistFavorite(id: string): Promise<void> {
		store().togglePlaylistFavorite(id);
		if (this.persistent) {
			const playlist = store().playlists[id];
			if (playlist) await this.repo.savePlaylist(playlist);
		}
	}

	// -- playlist import sessions --------------------------------------------
	// External metadata + user resolutions. Memory-map when persistence is
	// unavailable so the flow still works for the session.

	private importSessions = new Map<string, ImportSession>();

	async listImportSessions(): Promise<ImportSession[]> {
		if (this.persistent) return this.repo.getImportSessions();
		return [...this.importSessions.values()].sort(
			(a, b) => b.updatedAt - a.updatedAt,
		);
	}

	async saveImportSession(session: ImportSession): Promise<void> {
		if (this.persistent) await this.repo.saveImportSession(session);
		else this.importSessions.set(session.id, session);
	}

	async deleteImportSession(id: string): Promise<void> {
		if (this.persistent) await this.repo.deleteImportSession(id);
		else this.importSessions.delete(id);
	}

	/**
	 * Create a normal local playlist from an import session: matched and
	 * manually resolved tracks in source order. Unmatched/skipped tracks
	 * stay in the session only — never fake ids. Provenance is stamped on
	 * the playlist; the session keeps the full external metadata.
	 */
	async createPlaylistFromImport(
		session: ImportSession,
		name: string,
	): Promise<string> {
		const ids = sessionLocalIds(session);
		const playlistId = store().createPlaylist(name, ids);
		store().stampPlaylistImport(playlistId, {
			provider: session.provider,
			externalId: session.externalId,
			sourceUrl: session.sourceUrl,
			importedAt: session.importedAt,
		});
		const playlist = store().playlists[playlistId];
		if (this.persistent && playlist) {
			await this.repo.savePlaylist(playlist);
		}
		await this.saveImportSession({
			...session,
			localPlaylistId: playlistId,
			updatedAt: Date.now(),
		});
		return playlistId;
	}

	/**
	 * Apply an update diff to the linked local playlist: imported tracks
	 * take the new source order; user-added tracks (never imported) keep
	 * their relative tail position. Manual resolutions were already merged
	 * into the session by diffSessions.
	 */
	async updatePlaylistFromImport(
		playlistId: string,
		session: ImportSession,
		previousIds: string[],
	): Promise<void> {
		const playlist = store().playlists[playlistId];
		if (!playlist) return;
		const next = sessionLocalIds(session);
		const nextSet = new Set(next);
		const userAdded = playlist.trackIds.filter(
			(id) =>
				!previousIds.includes(id) && store().tracks[id] && !nextSet.has(id),
		);
		store().replacePlaylistTracks(playlistId, [...next, ...userAdded]);
		await this.saveImportSession({ ...session, updatedAt: Date.now() });
		if (this.persistent) {
			const final = store().playlists[playlistId];
			if (final) await this.repo.savePlaylist(final);
		}
	}

	// -- playback events ---------------------------------------------------
	// Called by the playback controller. One history entry per start; stats
	// update on meaningful ends only (completed or >30s). Never per-tick.

	async beginPlayback(trackId: string): Promise<void> {
		if (!this.persistent) return;
		await this.finishActive(false);
		const startedAt = Date.now();
		const seq = await this.repo.recordPlayStart(trackId, startedAt);
		this.active = { trackId, seq, startedAt };
	}

	async finishPlayback(trackId: string, completed: boolean): Promise<void> {
		if (!this.persistent || this.active?.trackId !== trackId) return;
		await this.repo.recordPlayEnd(this.active.seq, completed, Date.now());
		this.active = null;
		await this.refreshStats();
	}

	async updateDuration(trackId: string, seconds: number | null): Promise<void> {
		if (seconds == null || !Number.isFinite(seconds)) return;
		const track = store().tracks[trackId];
		if (!track) return;
		// CUE virtual tracks keep their segment duration; the file's own
		// duration must never overwrite it.
		if (track.cue) return;
		if (track.duration != null && Math.abs(track.duration - seconds) < 0.5)
			return;
		store().patchTrack(trackId, { duration: seconds });
		if (this.persistent)
			await this.repo.saveTracks([{ ...track, duration: seconds }]);
	}

	/**
	 * Attach lyrics to a track (embedded fallback or .lrc sidecar).
	 * Persisted with the track; returns false for unknown ids.
	 */
	async attachLyrics(
		trackId: string,
		lyrics: NonNullable<Track["lyrics"]>,
	): Promise<boolean> {
		const track = store().tracks[trackId];
		if (!track) return false;
		const updated = { ...track, lyrics, updatedAt: Date.now() };
		store().upsertTracks([updated]);
		if (this.persistent) await this.repo.saveTracks([updated]);
		return true;
	}

	/**
	 * Import a CUE sheet: match its FILE against imported directory tracks
	 * (case-insensitive basename match), create virtual segment tracks that
	 * share the parent's bytes, and build a playlist. Nothing is decoded
	 * or duplicated. Returns null when the audio file isn't in the library.
	 */
	async importCueSheet(text: string): Promise<{
		playlistId: string;
		trackIds: string[];
		warnings: string[];
	} | null> {
		const { parseCueSheet } = await import("../dsp/cue");
		const { cueTrackId } = await import("../db/identity");
		const cue = parseCueSheet(text);
		if (!cue || !cue.audioFileName) return null;
		const wanted = cue.audioFileName.toLowerCase();
		const parent = Object.values(store().tracks).find(
			(t) =>
				!t.cue &&
				(t.fileName.toLowerCase() === wanted ||
					(t.path ?? "").toLowerCase().endsWith(`/${wanted}`) ||
					(t.path ?? "").toLowerCase() === wanted),
		);
		if (!parent) return null;
		const now = Date.now();
		const parentSourceId = parent.sourceId ?? "loose";
		const album = cue.title ?? parent.album;
		const artist = cue.performer ?? parent.artist;
		const records: Track[] = [];
		const trackIds: string[] = [];
		for (const entry of cue.tracks) {
			const id = cueTrackId(parentSourceId, parent.id, entry.number);
			const duration =
				entry.endSec !== null
					? Math.max(0, entry.endSec - entry.startSec)
					: null;
			const known = store().tracks[id];
			records.push({
				...parent,
				id,
				title: entry.title ?? `Track ${entry.number}`,
				artist: entry.performer ?? artist,
				album,
				trackNumber: entry.number,
				duration: known?.duration ?? duration,
				sourceId: parent.sourceId,
				path: `${parent.path ?? parent.fileName}#cue${entry.number}`,
				artworkId: parent.artworkId,
				addedAt: known?.addedAt ?? now,
				updatedAt: now,
				missing: parent.missing,
				cue: {
					audioTrackId: parent.id,
					startSec: entry.startSec,
					endSec: entry.endSec,
					cueTrackNumber: entry.number,
					cueTitle: entry.title,
				},
			});
			trackIds.push(id);
		}
		await this.persistTracks(records);
		const playlistId = await this.createPlaylist(
			cue.title ? `${cue.title} (CUE)` : `${parent.fileName} (CUE)`,
			trackIds,
		);
		return { playlistId, trackIds, warnings: cue.warnings };
	}

	/** Lazily mint (and cache) an object URL for an artwork id. */
	async getArtworkUrl(artworkId: string | null): Promise<string | null> {
		if (!artworkId) return null;
		const cached = this.urls.get(artworkId);
		if (cached) return cached;
		if (!this.persistent) return null;
		const record = await this.repo.getArtwork(artworkId);
		if (!record) return null;
		return this.urls.create(artworkId, record.blob);
	}

	// -- IEM measurements ----------------------------------------------------
	//
	// Curve data persists in IndexedDB; the stores only mirror it for UI.
	// Profiles reference measurement/target ids — never embedded copies.

	async importMeasurementFile(
		text: string,
		fileName: string,
		source: string,
		displayName?: string,
	): Promise<{ ids: string[]; warnings: string[] }> {
		const parsed = parseCurveText(text, fileName);
		const ids: string[] = [];
		const now = Date.now();
		const base = (displayName?.trim() || fileName).replace(/\.[^.]+$/, "");
		for (const { channel, curve } of parsed.curves) {
			const stats = {
				pointCount: curve.frequencies.length,
				minFrequency: curve.frequencies[0] ?? 0,
				maxFrequency: curve.frequencies[curve.frequencies.length - 1] ?? 0,
			};
			const measurement: Measurement = {
				id: newId("meas"),
				name: parsed.curves.length > 1 ? `${base} (${channel})` : base,
				source,
				channel,
				frequencies: curve.frequencies,
				gains: curve.gains,
				metadata: { ...stats },
				createdAt: now,
			};
			if (this.persistent) await this.repo.saveMeasurement(measurement);
			useIEMStore.getState().upsertMeasurement(measurement);
			ids.push(measurement.id);
		}
		return { ids, warnings: parsed.warnings };
	}

	async deleteMeasurement(id: string): Promise<void> {
		if (this.persistent) await this.repo.deleteMeasurement(id);
		useIEMStore.getState().removeMeasurement(id);
		useIEMStore.getState().detachMeasurement(id);
	}

	async importTargetFile(
		text: string,
		fileName: string,
		name: string,
	): Promise<{ id: string; warnings: string[] }> {
		const parsed = parseCurveText(text, fileName);
		const first = parsed.curves[0];
		if (!first) throw new Error(`"${fileName}" contains no usable curve`);
		const now = Date.now();
		const target: TargetCurve = {
			id: newId("target"),
			name: name.trim() || fileName.replace(/\.[^.]+$/, ""),
			kind: "imported",
			frequencies: first.curve.frequencies,
			gains: first.curve.gains,
			metadata: {
				source: `imported from ${fileName}`,
				pointCount: first.curve.frequencies.length,
			},
			createdAt: now,
			updatedAt: now,
		};
		if (this.persistent) await this.repo.saveTarget(target);
		useIEMStore.getState().upsertTarget(target);
		return { id: target.id, warnings: parsed.warnings };
	}

	async saveParametricTarget(
		name: string,
		params: TargetBuilderParams,
		existingId?: string,
	): Promise<string> {
		const grid = buildParametricTarget(params);
		const now = Date.now();
		const current = existingId
			? useIEMStore.getState().targets[existingId]
			: undefined;
		const target: TargetCurve = {
			id: existingId ?? newId("target"),
			name: name.trim() || "Custom target",
			kind: "parametric",
			frequencies: grid.frequencies,
			gains: grid.gains,
			metadata: {
				source: "parametric builder",
				params: { ...params },
				pointCount: grid.frequencies.length,
			},
			createdAt: current?.createdAt ?? now,
			updatedAt: now,
		};
		if (this.persistent) await this.repo.saveTarget(target);
		useIEMStore.getState().upsertTarget(target);
		return target.id;
	}

	async deleteTarget(id: string): Promise<void> {
		if (this.persistent) await this.repo.deleteTarget(id);
		useIEMStore.getState().removeTarget(id);
		useIEMStore.getState().detachTarget(id);
	}

	// -- IEM profiles --------------------------------------------------------

	async createProfile(input: {
		name: string;
		manufacturer: string;
		model: string;
		measurementId: string | null;
		targetId: string | null;
	}): Promise<string> {
		const now = Date.now();
		const profile: IEMProfile = {
			id: newId("iem"),
			name: input.name.trim() || "Untitled IEM",
			manufacturer: input.manufacturer.trim(),
			model: input.model.trim(),
			measurementId: input.measurementId,
			targetId: input.targetId,
			eq: null,
			eqMeta: null,
			createdAt: now,
			updatedAt: now,
		};
		if (this.persistent) await this.repo.saveProfile(profile);
		useIEMStore.getState().upsertProfile(profile);
		return profile.id;
	}

	async renameProfile(id: string, name: string): Promise<void> {
		const trimmed = name.trim();
		if (trimmed === "") return;
		const current = useIEMStore.getState().profiles[id];
		if (!current || current.name === trimmed) return;
		const updated = { ...current, name: trimmed, updatedAt: Date.now() };
		if (this.persistent) await this.repo.saveProfile(updated);
		useIEMStore.getState().upsertProfile(updated);
	}

	async duplicateProfile(id: string): Promise<string | null> {
		const current = useIEMStore.getState().profiles[id];
		if (!current) return null;
		const now = Date.now();
		const copy: IEMProfile = {
			...current,
			id: newId("iem"),
			name: `${current.name} (copy)`,
			eq: current.eq
				? { ...current.eq, bands: current.eq.bands.map((b) => ({ ...b })) }
				: null,
			eqMeta: current.eqMeta ? { ...current.eqMeta } : null,
			...(current.dsp
				? {
						dsp: JSON.parse(JSON.stringify(current.dsp)) as NonNullable<
							IEMProfile["dsp"]
						>,
					}
				: {}),
			createdAt: now,
			updatedAt: now,
		};
		if (this.persistent) await this.repo.saveProfile(copy);
		useIEMStore.getState().upsertProfile(copy);
		return copy.id;
	}

	/**
	 * Import device profiles from a backup file. Validates shape (including
	 * the DSP snapshot when present); existing ids are skipped, never
	 * overwritten. Returns counts for the UI report.
	 */
	async importDeviceProfiles(
		raw: unknown,
	): Promise<{ added: number; skipped: number; errors: string[] }> {
		const { parseSnapshot } = await import("../dsp/snapshot");
		const errors: string[] = [];
		let added = 0;
		let skipped = 0;
		const list = Array.isArray(raw)
			? raw
			: typeof raw === "object" &&
					raw !== null &&
					Array.isArray((raw as { profiles?: unknown }).profiles)
				? ((raw as { profiles?: unknown }).profiles as unknown[])
				: null;
		if (!list)
			return { added: 0, skipped: 0, errors: ["Not a device-profile backup."] };
		if (list.length > 500)
			return {
				added: 0,
				skipped: 0,
				errors: ["Backup too large (500 profile cap)."],
			};
		for (const item of list) {
			if (typeof item !== "object" || item === null) {
				errors.push("Skipped a malformed entry.");
				continue;
			}
			const record = item as Record<string, unknown>;
			if (typeof record["name"] !== "string" || record["name"].trim() === "") {
				errors.push("Skipped an entry without a name.");
				continue;
			}
			const id =
				typeof record["id"] === "string" && record["id"].trim() !== ""
					? record["id"].trim().slice(0, 120)
					: newId("iem");
			if (useIEMStore.getState().profiles[id]) {
				skipped += 1;
				continue;
			}
			let dsp: IEMProfile["dsp"] = null;
			if (record["dsp"] !== undefined && record["dsp"] !== null) {
				const parsed = parseSnapshot(record["dsp"]);
				if (!parsed) {
					errors.push(
						`Skipped DSP layer of "${String(record["name"]).slice(0, 40)}" (invalid snapshot).`,
					);
				} else {
					dsp = parsed;
				}
			}
			const now = Date.now();
			const profile: IEMProfile = {
				id,
				name: String(record["name"]).trim().slice(0, 200),
				manufacturer:
					typeof record["manufacturer"] === "string"
						? record["manufacturer"].slice(0, 200)
						: "",
				model:
					typeof record["model"] === "string"
						? record["model"].slice(0, 200)
						: "",
				measurementId: null,
				targetId: null,
				eq: null,
				eqMeta: null,
				...(dsp ? { dsp } : {}),
				createdAt: now,
				updatedAt: now,
			};
			if (this.persistent) await this.repo.saveProfile(profile);
			useIEMStore.getState().upsertProfile(profile);
			added += 1;
		}
		return { added, skipped, errors: errors.slice(0, 10) };
	}

	async deleteProfile(id: string): Promise<void> {
		if (this.persistent) await this.repo.deleteProfile(id);
		useIEMStore.getState().removeProfile(id);
		if (useSettingsStore.getState().selectedIemProfileId === id) {
			useSettingsStore.getState().setSelectedIemProfileId(null);
		}
	}

	/**
	 * Select a profile AND make its sound live: a profile with stored EQ
	 * loads it into the playback EQ; a profile without EQ bypasses it.
	 * Without this, selecting B would keep playing A's correction while
	 * the UI claims B is selected.
	 */
	selectProfile(id: string | null): void {
		useSettingsStore.getState().setSelectedIemProfileId(id);
		const eq = useEQStore.getState();
		if (id === null) {
			useDspStore.getState().clearDevice();
			return;
		}
		const profile = useIEMStore.getState().profiles[id];
		if (!profile) return;
		if (profile.dsp) {
			// Device layer: replaces all module state (documented).
			useDspStore.getState().applySnapshot(profile.dsp, {
				id: profile.id,
				name: profile.name,
			});
		} else if (profile.eq) {
			useDspStore.getState().clearDevice();
			eq.loadBands(profile.eq.bands, profile.eq.preamp, profile.eq.enabled);
		} else {
			useDspStore.getState().clearDevice();
			eq.setEnabled(false);
		}
	}

	/**
	 * Capture the live DSP state into a profile (creates its device
	 * layer). Never touches the optimizer, measurement, or target.
	 */
	async captureDeviceDsp(id: string): Promise<boolean> {
		const profile = useIEMStore.getState().profiles[id];
		if (!profile) return false;
		const snapshot = useDspStore.getState().snapshot();
		const updated: IEMProfile = {
			...profile,
			dsp: snapshot,
			updatedAt: Date.now(),
		};
		if (this.persistent) await this.repo.saveProfile(updated);
		useIEMStore.getState().upsertProfile(updated);
		useDspStore.getState().applySnapshot(snapshot, { id, name: profile.name });
		return true;
	}

	/** Drop a profile's device layer (legacy eq field is untouched). */
	async clearProfileDsp(id: string): Promise<boolean> {
		const profile = useIEMStore.getState().profiles[id];
		if (!profile || !profile.dsp) return false;
		const updated: IEMProfile = {
			...profile,
			dsp: null,
			updatedAt: Date.now(),
		};
		if (this.persistent) await this.repo.saveProfile(updated);
		useIEMStore.getState().upsertProfile(updated);
		useDspStore.getState().clearDevice();
		return true;
	}

	/**
	 * Use a catalog device: find the profile for this make/model or
	 * create one, then apply its DSP layer (or legacy EQ). One device
	 * profile is active at a time — applying another replaces the first.
	 */
	async useDevice(input: {
		manufacturer: string;
		model: string;
		measurementId: string | null;
		targetId: string | null;
	}): Promise<{ profileId: string; created: boolean }> {
		const existing = Object.values(useIEMStore.getState().profiles).find(
			(p) =>
				p.manufacturer.toLowerCase() === input.manufacturer.toLowerCase() &&
				p.model.toLowerCase() === input.model.toLowerCase(),
		);
		const profileId =
			existing?.id ??
			(await this.createProfile({
				name: `${input.manufacturer} ${input.model}`,
				manufacturer: input.manufacturer,
				model: input.model,
				measurementId: input.measurementId,
				targetId: input.targetId,
			}));
		this.selectProfile(profileId);
		return { profileId, created: existing === undefined };
	}

	async setProfileTargets(
		id: string,
		measurementId: string | null,
		targetId: string | null,
	): Promise<void> {
		const current = useIEMStore.getState().profiles[id];
		if (!current) return;
		const updated = {
			...current,
			measurementId,
			targetId,
			updatedAt: Date.now(),
		};
		if (this.persistent) await this.repo.saveProfile(updated);
		useIEMStore.getState().upsertProfile(updated);
	}

	/**
	 * Store an AutoEQ result on the profile AND load it as the live manual
	 * EQ (explicit user action only — never called automatically). The DSP
	 * engine cannot distinguish fitted from hand-made profiles afterwards.
	 */
	async applyAutoEQResult(
		id: string,
		eq: SerializedPEQ,
		meta: {
			optimizerVersion: number;
			fittedAt: number;
			rmsAfterDb: number;
			maxBands: number;
			hfTreatment?: HfTreatment;
			fitRangePreset?: FitRangePresetId;
			effectiveRangeHz?: [number, number];
			smoothingPreset?: SmoothingPresetId;
		},
	): Promise<void> {
		const current = useIEMStore.getState().profiles[id];
		if (!current) return;
		const updated = { ...current, eq, eqMeta: meta, updatedAt: Date.now() };
		if (this.persistent) await this.repo.saveProfile(updated);
		useIEMStore.getState().upsertProfile(updated);
		useEQStore.getState().loadBands(eq.bands, eq.preamp, eq.enabled);
	}

	// -- queue persistence --------------------------------------------------
	//
	// Order, position, and transport modes survive reloads. Playback time
	// deliberately does not (no UX reason to resume mid-track). Stale ids
	// (deleted tracks) are dropped; missing-but-known tracks are kept.

	async saveQueueState(): Promise<void> {
		if (!this.persistent) return;
		const player = usePlayerStore.getState();
		const currentId = player.currentTrackId();
		const state: PersistedQueueState = {
			version: 1,
			trackIds: player.queue.map((q) => q.trackId),
			index: player.currentIndex,
			repeat: player.repeat,
			shuffle: player.shuffle,
			crossfadeEnabled: player.crossfadeEnabled,
			crossfadeDuration: player.crossfadeDuration,
		};
		if (currentId !== null) state.currentTrackId = currentId;
		await this.repo.setMeta(QUEUE_STATE_KEY, state);
	}

	async restoreQueueState(): Promise<void> {
		if (!this.persistent) return;
		const parsed = parseQueueState(await this.repo.getMeta(QUEUE_STATE_KEY));
		if (!parsed || parsed.trackIds.length === 0) return;
		const library = store();
		const valid = parsed.trackIds.filter((id) => library.tracks[id]);
		if (valid.length === 0) return;
		// Anchor by track id so deletions before the cursor don't retarget
		// playback; fall back to the saved position for old records.
		const byId =
			parsed.currentTrackId != null ? valid.indexOf(parsed.currentTrackId) : -1;
		const index =
			byId >= 0 ? byId : Math.min(Math.max(0, parsed.index), valid.length - 1);
		const player = usePlayerStore.getState();
		player.restoreQueue(valid, index);
		player.restoreTransport({
			repeat: parsed.repeat,
			shuffle: parsed.shuffle,
			crossfadeEnabled: parsed.crossfadeEnabled,
			crossfadeDuration: parsed.crossfadeDuration,
		});
	}

	private queueUnsubscribe: (() => void) | null = null;

	/** Persist on every queue/transport change. Call once after initialize. */
	startQueuePersistence(): void {
		if (this.queueUnsubscribe) return;
		this.queueUnsubscribe = usePlayerStore.subscribe(
			(s) => [
				s.queue.map((q) => q.trackId).join(","),
				s.currentIndex,
				s.repeat,
				s.shuffle,
				s.crossfadeEnabled,
				s.crossfadeDuration,
			],
			() => {
				void this.saveQueueState();
			},
		);
	}

	// -- internals --------------------------------------------------------

	private async finishActive(completed: boolean): Promise<void> {
		if (!this.active) return;
		const { seq } = this.active;
		this.active = null;
		await this.repo.recordPlayEnd(seq, completed, Date.now());
		await this.refreshStats();
	}

	private async refreshStats(): Promise<void> {
		const all = await this.repo.getAllStats();
		const next: Record<string, PlayStats> = {};
		for (const s of all) next[s.trackId] = s;
		store().setStats(next);
	}

	private async persistTracks(records: Track[]): Promise<void> {
		if (this.persistent) await this.repo.saveTracks(records.map(toRecord));
		store().upsertTracks(records);
	}

	private async cacheArtwork(
		artwork: ArtworkPayload,
		previousId: string | null,
	): Promise<string> {
		const processed = await processArtwork(artwork.bytes, artwork.mime);
		if (this.persistent) {
			await this.repo.ensureArtwork(toArtworkRecord(processed));
			if (processed.id !== previousId)
				await this.repo.retainArtwork(processed.id);
		}
		return processed.id;
	}

	private releaseArtworkIfReplaced(
		previousId: string | null,
		nextId: string | null,
	): void {
		if (!previousId || previousId === nextId) return;
		if (this.persistent) {
			void this.repo.releaseArtwork(previousId).then((deleted) => {
				if (deleted) this.urls.revoke(previousId);
			});
		} else {
			this.urls.revoke(previousId);
		}
	}

	/**
	 * Core incremental ingest: stable ids → diff against existing source
	 * records → persist added/changed → mark vanished records missing.
	 * Store updates happen once per call (no per-file renders).
	 */
	private async ingestScanned(
		scanned: ScannedFile[],
		source: LibrarySource,
		markRemovedMissing = false,
	): Promise<IngestResult> {
		const s = store();
		const existingById = new Map<string, Track>();
		for (const id of s.order) {
			const track = s.tracks[id];
			if (track?.sourceId === source.id && track.path)
				existingById.set(id, track);
		}
		const taken = new Set(s.order);
		const fingerprints = scanned.map((item) => {
			const baseId = stableTrackId(source.id, item.relativePath);
			return { item, baseId };
		});
		const existingStats = new Map<
			string,
			{ size: number; lastModified: number }
		>();
		for (const [id, track] of existingById) {
			existingStats.set(id, {
				size: track.fileSize,
				lastModified: track.mtime,
			});
		}
		// Match first: same slot (source + path) means the same logical file
		// even when its metadata changed. Only a true hash collision
		// (different slot, same id) earns a suffix.
		const toFingerprint = fingerprints.map(({ item, baseId }) => {
			const known = existingById.get(baseId);
			const sameSlot =
				known?.sourceId === source.id && known.path === item.relativePath;
			const id = sameSlot || !known ? baseId : resolveCollision(baseId, taken);
			taken.add(id);
			return {
				item,
				id,
				size: item.file.size,
				lastModified: item.file.lastModified,
			};
		});
		const diff = diffScan(
			toFingerprint.map(({ id, size, lastModified }) => ({
				id,
				size,
				lastModified,
			})),
			existingStats,
		);
		const byId = new Map(toFingerprint.map((f) => [f.id, f]));
		const result: IngestResult = { added: [], updated: [] };
		const records: Track[] = [];
		const now = Date.now();
		const handleIds = [...diff.added, ...diff.changed];
		for (const fp of handleIds) {
			const found = byId.get(fp.id);
			if (!found) continue;
			const { item } = found;
			const known = existingById.get(fp.id);
			const artworkId = item.artwork
				? await this.cacheArtwork(item.artwork, known?.artworkId ?? null)
				: (known?.artworkId ?? null);
			if (known) this.releaseArtworkIfReplaced(known.artworkId, artworkId);
			const track: Track = {
				...item.track,
				id: fp.id,
				sourceId: source.id,
				path: item.relativePath,
				fileName: item.file.name,
				fileType: item.file.type,
				fileSize: item.file.size,
				mtime: item.file.lastModified,
				artworkId,
				addedAt: known?.addedAt ?? now,
				updatedAt: now,
				missing: false,
			};
			records.push(track);
			s.registerFile(fp.id, item.file);
			if (known) result.updated.push(fp.id);
			else {
				taken.add(fp.id);
				result.added.push(fp.id);
			}
		}
		if (markRemovedMissing && diff.removed.length > 0) {
			const missing = diff.removed
				.map((id) => existingById.get(id))
				.filter((t): t is Track => !!t && !t.missing)
				.map((t) => ({ ...t, missing: true, updatedAt: now }));
			records.push(...missing);
			result.updated.push(...missing.map((t) => t.id));
		}
		await this.persistTracks(records);
		return result;
	}
}

export const libraryService = new LibraryService();
