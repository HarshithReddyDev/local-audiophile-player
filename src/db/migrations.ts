/**
 * Versioned migrations. Each step upgrades exactly one version and must be
 * idempotent (re-running it on an already-migrated database is a no-op).
 * Never drop/recreate the database to change schema — add a step.
 */
import type { IDBPDatabase } from "idb";
import type { Schema } from "./schema";
import { STORES } from "./schema";

export type Migration = (db: IDBPDatabase<Schema>) => void;

function createV1Stores(db: IDBPDatabase<Schema>): void {
	if (!db.objectStoreNames.contains(STORES.tracks)) {
		const tracks = db.createObjectStore(STORES.tracks, { keyPath: "id" });
		tracks.createIndex("by-added", "addedAt");
		tracks.createIndex("by-source", "sourceId");
	}
	if (!db.objectStoreNames.contains(STORES.sources)) {
		db.createObjectStore(STORES.sources, { keyPath: "id" });
	}
	if (!db.objectStoreNames.contains(STORES.artwork)) {
		db.createObjectStore(STORES.artwork, { keyPath: "id" });
	}
	if (!db.objectStoreNames.contains(STORES.playlists)) {
		const playlists = db.createObjectStore(STORES.playlists, { keyPath: "id" });
		playlists.createIndex("by-created", "createdAt");
	}
	if (!db.objectStoreNames.contains(STORES.favorites)) {
		const favorites = db.createObjectStore(STORES.favorites, {
			keyPath: "trackId",
		});
		favorites.createIndex("by-added", "addedAt");
	}
	if (!db.objectStoreNames.contains(STORES.ratings)) {
		db.createObjectStore(STORES.ratings, { keyPath: "trackId" });
	}
	if (!db.objectStoreNames.contains(STORES.history)) {
		const history = db.createObjectStore(STORES.history, {
			keyPath: "seq",
			autoIncrement: true,
		});
		history.createIndex("by-started", "startedAt");
		history.createIndex("by-track", "trackId");
	}
	if (!db.objectStoreNames.contains(STORES.stats)) {
		const stats = db.createObjectStore(STORES.stats, { keyPath: "trackId" });
		stats.createIndex("by-last-played", "lastPlayedAt");
	}
	if (!db.objectStoreNames.contains(STORES.meta)) {
		db.createObjectStore(STORES.meta, { keyPath: "key" });
	}
}

/** Ordered migration steps; index i migrates v(i) → v(i+1). */
export const MIGRATIONS: Migration[] = [
	createV1Stores,
	createV2IemStores,
	createV3ImportStores,
];

/** v2: IEM measurements, targets, and profiles. Additive only. */
function createV2IemStores(db: IDBPDatabase<Schema>): void {
	if (!db.objectStoreNames.contains(STORES.measurements)) {
		const measurements = db.createObjectStore(STORES.measurements, {
			keyPath: "id",
		});
		measurements.createIndex("by-created", "createdAt");
	}
	if (!db.objectStoreNames.contains(STORES.targets)) {
		db.createObjectStore(STORES.targets, { keyPath: "id" });
	}
	if (!db.objectStoreNames.contains(STORES.iemProfiles)) {
		const profiles = db.createObjectStore(STORES.iemProfiles, {
			keyPath: "id",
		});
		profiles.createIndex("by-created", "createdAt");
	}
}

/** v3: playlist import sessions. Additive only. */
function createV3ImportStores(db: IDBPDatabase<Schema>): void {
	if (!db.objectStoreNames.contains(STORES.playlistImports)) {
		const imports = db.createObjectStore(STORES.playlistImports, {
			keyPath: "id",
		});
		imports.createIndex("by-updated", "updatedAt");
	}
}

/** Latest version the code understands. */
export const LATEST_VERSION = MIGRATIONS.length;
/** Applies every pending step from oldVersion up to the latest. */
export function runMigrations(
	db: IDBPDatabase<Schema>,
	oldVersion: number,
): void {
	for (let v = oldVersion; v < LATEST_VERSION; v++) {
		const step = MIGRATIONS[v];
		if (step) step(db);
	}
}
