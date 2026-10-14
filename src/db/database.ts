/**
 * Database lifecycle: availability check, open with migrations, close.
 * Opening never throws for a missing API — callers get null and run the
 * app in memory-only mode with an "unavailable" source status.
 */

import type { IDBPDatabase } from "idb";
import { deleteDB, openDB } from "idb";
import { LATEST_VERSION, runMigrations } from "./migrations";
import type { Schema } from "./schema";
import { DB_NAME } from "./schema";

export type Database = IDBPDatabase<Schema>;

export function isIndexedDBAvailable(): boolean {
	try {
		return typeof indexedDB !== "undefined" && indexedDB !== null;
	} catch {
		return false;
	}
}

export async function openLibraryDatabase(
	name: string = DB_NAME,
): Promise<Database | null> {
	if (!isIndexedDBAvailable()) return null;
	try {
		return await openDB<Schema>(name, LATEST_VERSION, {
			upgrade(db, oldVersion) {
				runMigrations(db, oldVersion);
			},
			blocked() {
				// Another tab holds the old version; it must close first.
				// The app keeps running — restore retries on next launch.
			},
		});
	} catch {
		return null;
	}
}

export async function closeLibraryDatabase(db: Database): Promise<void> {
	db.close();
}

export async function destroyLibraryDatabase(
	name: string = DB_NAME,
): Promise<void> {
	if (!isIndexedDBAvailable()) return;
	await deleteDB(name);
}
