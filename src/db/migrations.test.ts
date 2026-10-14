import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, describe, expect, it } from "vitest";
import { destroyLibraryDatabase, openLibraryDatabase } from "./database";
import { LATEST_VERSION, MIGRATIONS } from "./migrations";
import type { Schema } from "./schema";
import { DB_VERSION, STORES } from "./schema";

const TEST_DB = "test-migrations-db";

afterEach(async () => {
	await destroyLibraryDatabase(TEST_DB);
});

describe("migrations", () => {
	it("exposes version 3 with three steps", () => {
		expect(DB_VERSION).toBe(3);
		expect(LATEST_VERSION).toBe(3);
		expect(MIGRATIONS).toHaveLength(3);
	});

	it("creates all v1 stores and indexes on fresh init", async () => {
		const db = await openLibraryDatabase(TEST_DB);
		expect(db).not.toBeNull();
		for (const name of Object.values(STORES)) {
			expect(db?.objectStoreNames.contains(name)).toBe(true);
		}
		const tracks = db?.transaction(STORES.tracks).store;
		expect(tracks?.indexNames.contains("by-added")).toBe(true);
		expect(tracks?.indexNames.contains("by-source")).toBe(true);
		expect(
			db?.transaction(STORES.history).store.indexNames.contains("by-started"),
		).toBe(true);
		expect(
			db?.transaction(STORES.stats).store.indexNames.contains("by-last-played"),
		).toBe(true);
		db?.close();
	});

	it("reopening a v2 database preserves data and schema", async () => {
		const first = await openLibraryDatabase(TEST_DB);
		expect(first).not.toBeNull();
		if (!first) return;
		await first.put(STORES.meta, { key: "probe", value: 42 });
		first.close();
		// Reopen: oldVersion === latest, so no step runs; data must survive.
		const second = await openLibraryDatabase(TEST_DB);
		expect(second).not.toBeNull();
		expect(await second?.get(STORES.meta, "probe")).toMatchObject({
			value: 42,
		});
		expect(second?.objectStoreNames.length).toBe(Object.values(STORES).length);
		second?.close();
	});

	it("migrates v1 → v3 without losing version-1 data", async () => {
		// Build a genuine v1 database: only the first migration step runs.
		const v1 = await openDB<Schema>(TEST_DB, 1, {
			upgrade(db) {
				MIGRATIONS[0]?.(db);
			},
		});
		expect(v1.objectStoreNames.contains(STORES.tracks)).toBe(true);
		expect(v1.objectStoreNames.contains(STORES.measurements)).toBe(false);
		expect(v1.objectStoreNames.contains(STORES.playlistImports)).toBe(false);
		await v1.put(STORES.meta, { key: "probe", value: 7 });
		v1.close();

		// Normal open upgrades to v3: new stores appear, old data survives.
		const v3 = await openLibraryDatabase(TEST_DB);
		expect(v3).not.toBeNull();
		expect(v3?.objectStoreNames.contains(STORES.measurements)).toBe(true);
		expect(v3?.objectStoreNames.contains(STORES.targets)).toBe(true);
		expect(v3?.objectStoreNames.contains(STORES.iemProfiles)).toBe(true);
		expect(v3?.objectStoreNames.contains(STORES.playlistImports)).toBe(true);
		expect(v3?.version).toBe(3);
		expect(await v3?.get(STORES.meta, "probe")).toMatchObject({ value: 7 });
		v3?.close();
	});

	it("returns null when IndexedDB is missing", async () => {
		const real = globalThis.indexedDB;
		// @ts-expect-error simulating an unavailable API
		globalThis.indexedDB = undefined;
		try {
			expect(await openLibraryDatabase(TEST_DB)).toBeNull();
		} finally {
			globalThis.indexedDB = real;
		}
	});
});
