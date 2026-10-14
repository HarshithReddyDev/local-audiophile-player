/**
 * LibraryRepository — the only module that talks to IndexedDB.
 *
 * Layers above (service → store → UI) use this interface and never touch
 * IDB directly. Writes keep an in-memory snapshot so full-text search stays
 * a millisecond filter; sorted/limited queries (recents, history) use real
 * indexes. Bulk writes are chunked into bounded transactions.
 */

import type { IEMProfile, Measurement, TargetCurve } from "../iem/types";
import type { ImportSession } from "../import/model";
import type {
	Favorite,
	HistoryEntry,
	Playlist,
	PlayStats,
	Rating,
} from "../types/library";
import type { Database } from "./database";
import { openLibraryDatabase } from "./database";
import type {
	ArtworkRecord,
	Schema,
	SourceRecord,
	TrackRecord,
} from "./schema";
import { STORES } from "./schema";

const WRITE_CHUNK = 500;
const HISTORY_CAP = 1000;

export class LibraryRepository {
	private db: Database | null = null;
	private snapshot: TrackRecord[] | null = null;

	/** Open (or create) the database. Null when IndexedDB is unavailable. */
	async init(): Promise<boolean> {
		this.db = await openLibraryDatabase();
		return this.db !== null;
	}

	get ready(): boolean {
		return this.db !== null;
	}

	async close(): Promise<void> {
		this.db?.close();
		this.db = null;
		this.snapshot = null;
	}

	private requireDb(): Database {
		if (!this.db) throw new Error("LibraryRepository not initialized");
		return this.db;
	}

	/**
	 * Durable single-record write: resolves after the transaction COMMITS,
	 * not merely when the request succeeds. Page unload between request
	 * success and commit can otherwise roll the write back — the exact race
	 * behind "saved, reloaded instantly, data missing".
	 */
	private async putCommitted<K extends keyof Schema>(
		store: K,
		value: Schema[K],
	): Promise<void> {
		const db = this.requireDb();
		// String-typed call: idb overloads can't express a generic single
		// store name; runtime behavior is identical and call sites stay typed.
		const tx = db.transaction(store as string, "readwrite");
		await (tx.store as { put(v: unknown): Promise<unknown> }).put(value);
		await tx.done;
	}

	private async delCommitted<K extends keyof Schema>(
		store: K,
		key: string | number,
	): Promise<void> {
		const db = this.requireDb();
		const tx = db.transaction(store as string, "readwrite");
		await (tx.store as { delete(k: unknown): Promise<unknown> }).delete(key);
		await tx.done;
	}

	// -- tracks -----------------------------------------------------------

	/** Bulk upsert in bounded transactions. Preserves addedAt of existing rows. */
	async saveTracks(
		records: TrackRecord[],
		onProgress?: (saved: number, total: number) => void,
	): Promise<void> {
		const db = this.requireDb();
		let saved = 0;
		for (let i = 0; i < records.length; i += WRITE_CHUNK) {
			const chunk = records.slice(i, i + WRITE_CHUNK);
			const tx = db.transaction(STORES.tracks, "readwrite");
			await Promise.all(
				chunk.map(async (record) => {
					const existing = await tx.store.get(record.id);
					await tx.store.put(
						existing ? { ...record, addedAt: existing.addedAt } : record,
					);
				}),
			);
			await tx.done;
			saved += chunk.length;
			onProgress?.(saved, records.length);
		}
		this.snapshot = null;
	}

	async getTrack(id: string): Promise<TrackRecord | undefined> {
		return this.requireDb().get(STORES.tracks, id);
	}

	/** Full snapshot, insertion-ordered by key. Cached until the next write. */
	async getAllTracks(): Promise<TrackRecord[]> {
		if (!this.snapshot) {
			this.snapshot = await this.requireDb().getAll(STORES.tracks);
		}
		return [...this.snapshot];
	}

	async getTracksBySource(sourceId: string): Promise<TrackRecord[]> {
		return this.requireDb().getAllFromIndex(
			STORES.tracks,
			"by-source",
			sourceId,
		);
	}

	/** Newest first, bounded. Backed by the by-added index. */
	async getRecentlyAdded(limit: number): Promise<TrackRecord[]> {
		const db = this.requireDb();
		const out: TrackRecord[] = [];
		const tx = db.transaction(STORES.tracks);
		let cursor = await tx.store.index("by-added").openCursor(null, "prev");
		while (cursor && out.length < limit) {
			out.push(cursor.value);
			cursor = await cursor.continue();
		}
		return out;
	}

	/** Case-insensitive substring match over title/artist/album/genre. */
	async searchTracks(query: string): Promise<TrackRecord[]> {
		const q = query.trim().toLowerCase();
		const all = await this.getAllTracks();
		if (q === "") return all;
		return all.filter((t) =>
			[t.title, t.artist, t.album, t.albumArtist, ...t.genre].some((f) =>
				f.toLowerCase().includes(q),
			),
		);
	}

	/** Cascades to playlists, favorites, ratings, stats, and history. */
	async deleteTrack(id: string): Promise<void> {
		const db = this.requireDb();
		// Fetched BEFORE the transaction opens: any interleaved await on
		// another request would auto-commit the write transaction.
		const affected: Playlist[] = (await db.getAll(STORES.playlists)).filter(
			(p) => p.trackIds.includes(id),
		);
		const historyKeys = await db.getAllKeysFromIndex(
			STORES.history,
			"by-track",
			id,
		);
		const tx = db.transaction(
			[
				STORES.tracks,
				STORES.playlists,
				STORES.favorites,
				STORES.ratings,
				STORES.stats,
				STORES.history,
			],
			"readwrite",
		);
		const playlistsStore = tx.objectStore(STORES.playlists);
		const historyStore = tx.objectStore(STORES.history);
		await Promise.all([
			tx.objectStore(STORES.tracks).delete(id),
			tx.objectStore(STORES.favorites).delete(id),
			tx.objectStore(STORES.ratings).delete(id),
			tx.objectStore(STORES.stats).delete(id),
			...historyKeys.map((key) => historyStore.delete(key)),
			...affected.map((p) =>
				playlistsStore.put({
					...p,
					trackIds: p.trackIds.filter((t) => t !== id),
					updatedAt: Date.now(),
				}),
			),
		]);
		await tx.done;
		this.snapshot = null;
	}

	async clearTracks(): Promise<void> {
		// Full library reset: tracks, artwork, playlists, favorites, ratings,
		// history, and stats. Sources are kept (reconnect without re-picking).
		const db = this.requireDb();
		const tx = db.transaction(
			[
				STORES.tracks,
				STORES.artwork,
				STORES.playlists,
				STORES.favorites,
				STORES.ratings,
				STORES.history,
				STORES.stats,
			],
			"readwrite",
		);
		await tx.objectStore(STORES.tracks).clear();
		await tx.objectStore(STORES.artwork).clear();
		await tx.objectStore(STORES.playlists).clear();
		await tx.objectStore(STORES.favorites).clear();
		await tx.objectStore(STORES.ratings).clear();
		await tx.objectStore(STORES.history).clear();
		await tx.objectStore(STORES.stats).clear();
		await tx.done;
		this.snapshot = null;
	}

	// -- artwork ----------------------------------------------------------

	async ensureArtwork(record: ArtworkRecord): Promise<void> {
		const db = this.requireDb();
		const tx = db.transaction(STORES.artwork, "readwrite");
		const existing = await tx.store.get(record.id);
		if (!existing) await tx.store.put(record);
		await tx.done;
	}

	async retainArtwork(id: string): Promise<void> {
		const db = this.requireDb();
		const tx = db.transaction(STORES.artwork, "readwrite");
		const record = await tx.store.get(id);
		if (record) await tx.store.put({ ...record, refs: record.refs + 1 });
		await tx.done;
	}

	/** Decrements refs; deletes the blob at zero. Returns true when deleted. */
	async releaseArtwork(id: string): Promise<boolean> {
		const db = this.requireDb();
		const tx = db.transaction(STORES.artwork, "readwrite");
		const record = await tx.store.get(id);
		if (!record) {
			await tx.done;
			return false;
		}
		if (record.refs <= 1) {
			await tx.store.delete(id);
		} else {
			await tx.store.put({ ...record, refs: record.refs - 1 });
		}
		await tx.done;
		return record.refs <= 1;
	}

	async getArtwork(id: string): Promise<ArtworkRecord | undefined> {
		return this.requireDb().get(STORES.artwork, id);
	}

	// -- sources ----------------------------------------------------------

	async saveSource(source: SourceRecord): Promise<void> {
		await this.putCommitted(STORES.sources, source);
	}

	async getSources(): Promise<SourceRecord[]> {
		return this.requireDb().getAll(STORES.sources);
	}

	async deleteSource(id: string): Promise<void> {
		await this.delCommitted(STORES.sources, id);
	}

	// -- playlists --------------------------------------------------------

	async savePlaylist(playlist: Playlist): Promise<void> {
		await this.putCommitted(STORES.playlists, playlist);
	}

	async getPlaylists(): Promise<Playlist[]> {
		const all = await this.requireDb().getAll(STORES.playlists);
		return all.sort((a, b) => b.createdAt - a.createdAt);
	}

	async deletePlaylist(id: string): Promise<void> {
		await this.delCommitted(STORES.playlists, id);
	}

	// -- playlist imports -------------------------------------------------

	async saveImportSession(session: ImportSession): Promise<void> {
		await this.putCommitted(STORES.playlistImports, session);
	}

	async getImportSessions(): Promise<ImportSession[]> {
		const all = await this.requireDb().getAll(STORES.playlistImports);
		return all.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	async deleteImportSession(id: string): Promise<void> {
		await this.delCommitted(STORES.playlistImports, id);
	}

	// -- favorites --------------------------------------------------------

	async addFavorite(trackId: string): Promise<void> {
		await this.putCommitted(STORES.favorites, {
			trackId,
			addedAt: Date.now(),
		});
	}

	async removeFavorite(trackId: string): Promise<void> {
		await this.delCommitted(STORES.favorites, trackId);
	}

	async getFavorites(): Promise<Favorite[]> {
		const all = await this.requireDb().getAll(STORES.favorites);
		return all.sort((a, b) => b.addedAt - a.addedAt);
	}

	// -- ratings ----------------------------------------------------------

	async setRating(trackId: string, value: number): Promise<void> {
		if (value <= 0) {
			await this.delCommitted(STORES.ratings, trackId);
			return;
		}
		await this.putCommitted(STORES.ratings, {
			trackId,
			value: Math.min(5, Math.round(value * 2) / 2),
			updatedAt: Date.now(),
		});
	}

	async getRatings(): Promise<Rating[]> {
		return this.requireDb().getAll(STORES.ratings);
	}

	// -- history + stats --------------------------------------------------
	//
	// One entry per playback start is too noisy to aggregate on every read,
	// so stats (playCount/lastPlayedAt) are maintained on write. History is
	// capped; stats live forever.

	async recordPlayStart(trackId: string, startedAt: number): Promise<number> {
		const db = this.requireDb();
		const tx = db.transaction(STORES.history, "readwrite");
		const seq = (await tx.store.add({
			trackId,
			startedAt,
			completedAt: null,
			completed: false,
		})) as number;
		await tx.done;
		await this.pruneHistory(db as Database);
		return seq;
	}

	async recordPlayEnd(
		seq: number,
		completed: boolean,
		at: number,
	): Promise<void> {
		const db = this.requireDb();
		const tx = db.transaction([STORES.history, STORES.stats], "readwrite");
		const history = tx.objectStore(STORES.history);
		const statsStore = tx.objectStore(STORES.stats);
		const entry = await history.get(seq);
		if (!entry) {
			await tx.done;
			return;
		}
		await history.put({ ...entry, completedAt: at, completed });
		const stats = await statsStore.get(entry.trackId);
		const substantial = completed || at - entry.startedAt >= 30_000;
		if (substantial) {
			await statsStore.put({
				trackId: entry.trackId,
				playCount: (stats?.playCount ?? 0) + 1,
				lastPlayedAt: at,
			});
		} else if (!stats) {
			await statsStore.put({
				trackId: entry.trackId,
				playCount: 0,
				lastPlayedAt: at,
			});
		}
		await tx.done;
	}

	async getHistory(limit: number): Promise<HistoryEntry[]> {
		const db = this.requireDb();
		const out: HistoryEntry[] = [];
		const tx = db.transaction(STORES.history);
		let cursor = await tx.store.index("by-started").openCursor(null, "prev");
		while (cursor && out.length < limit) {
			out.push(cursor.value);
			cursor = await cursor.continue();
		}
		return out;
	}

	/** Most-recently-played first, bounded. Backed by the by-last-played index. */
	async getRecentlyPlayed(limit: number): Promise<PlayStats[]> {
		const db = this.requireDb();
		const out: PlayStats[] = [];
		const tx = db.transaction(STORES.stats);
		let cursor = await tx.store
			.index("by-last-played")
			.openCursor(null, "prev");
		while (cursor && out.length < limit) {
			out.push(cursor.value);
			cursor = await cursor.continue();
		}
		return out;
	}

	async getAllStats(): Promise<PlayStats[]> {
		return this.requireDb().getAll(STORES.stats);
	}

	// -- key/value ---------------------------------------------------------

	async getMeta<T>(key: string): Promise<T | undefined> {
		const record = await this.requireDb().get(STORES.meta, key);
		return record?.value as T | undefined;
	}

	async setMeta(key: string, value: unknown): Promise<void> {
		await this.putCommitted(STORES.meta, { key, value });
	}

	// -- IEM measurements ---------------------------------------------------

	async saveMeasurement(measurement: Measurement): Promise<void> {
		await this.putCommitted(STORES.measurements, measurement);
	}

	async getMeasurements(): Promise<Measurement[]> {
		const all = await this.requireDb().getAll(STORES.measurements);
		return all.sort((a, b) => b.createdAt - a.createdAt);
	}

	async deleteMeasurement(id: string): Promise<void> {
		await this.delCommitted(STORES.measurements, id);
	}

	// -- IEM targets (custom + parametric; built-ins live in code) ---------

	async saveTarget(target: TargetCurve): Promise<void> {
		await this.putCommitted(STORES.targets, target);
	}

	async getTargets(): Promise<TargetCurve[]> {
		return this.requireDb().getAll(STORES.targets);
	}

	async deleteTarget(id: string): Promise<void> {
		await this.delCommitted(STORES.targets, id);
	}

	// -- IEM profiles -------------------------------------------------------

	async saveProfile(profile: IEMProfile): Promise<void> {
		await this.putCommitted(STORES.iemProfiles, profile);
	}

	async getProfiles(): Promise<IEMProfile[]> {
		const all = await this.requireDb().getAll(STORES.iemProfiles);
		return all.sort((a, b) => b.createdAt - a.createdAt);
	}

	async deleteProfile(id: string): Promise<void> {
		await this.delCommitted(STORES.iemProfiles, id);
	}

	private async pruneHistory(db: Database): Promise<void> {
		const count = await db.count(STORES.history);
		if (count <= HISTORY_CAP) return;
		let remaining = count - HISTORY_CAP;
		const tx = db.transaction(STORES.history, "readwrite");
		// Oldest first via the by-started index.
		let cursor = await tx.store.index("by-started").openCursor();
		while (cursor && remaining > 0) {
			await cursor.delete();
			remaining -= 1;
			cursor = await cursor.continue();
		}
		await tx.done;
	}
}
