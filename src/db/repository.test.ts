import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { destroyLibraryDatabase } from "./database";
import { LibraryRepository } from "./repository";
import type { TrackRecord } from "./schema";

const TEST_DB = "test-repo-db";

function record(id: string, overrides: Partial<TrackRecord> = {}): TrackRecord {
	return {
		id,
		title: `Title ${id}`,
		artist: "Alice",
		album: "First",
		albumArtist: "Alice",
		trackNumber: null,
		discNumber: null,
		duration: 180,
		year: 2020,
		genre: [],
		fileName: `${id}.mp3`,
		fileType: "audio/mpeg",
		fileSize: 1000,
		mtime: 7,
		artworkId: null,
		sourceId: null,
		path: `${id}.mp3`,
		addedAt: 1000,
		updatedAt: 1000,
		missing: false,
		...overrides,
	};
}

async function newRepo(): Promise<LibraryRepository> {
	const repo = new LibraryRepository();
	await repo.init();
	return repo;
}

afterEach(async () => {
	await destroyLibraryDatabase(TEST_DB);
	await destroyLibraryDatabase("iem-player-library");
});

describe("tracks", () => {
	it("saves, reads, searches, and cascades deletes", async () => {
		const repo = await newRepo();
		await repo.saveTracks([
			record("a", { title: "Blue Sky", genre: ["Rock"] }),
			record("b", { title: "Green Field", artist: "Bob", addedAt: 2000 }),
		]);
		expect(await repo.getTrack("a")).toMatchObject({ title: "Blue Sky" });
		expect(await repo.getAllTracks()).toHaveLength(2);
		expect(await repo.searchTracks("blue")).toHaveLength(1);
		expect(await repo.searchTracks("bob")).toHaveLength(1);
		expect(await repo.searchTracks("")).toHaveLength(2);

		// addedAt survives re-save (stable identity keeps history).
		await repo.saveTracks([
			record("a", { title: "Blue Sky v2", addedAt: 9999 }),
		]);
		expect(await repo.getTrack("a")).toMatchObject({
			title: "Blue Sky v2",
			addedAt: 1000,
		});

		// Cascade: playlist/favorite/rating/stats/history entries vanish
		// with the track.
		await repo.savePlaylist({
			id: "p",
			name: "Mix",
			trackIds: ["a", "b"],
			createdAt: 1,
			updatedAt: 1,
		});
		await repo.addFavorite("a");
		await repo.setRating("a", 4);
		await repo.recordPlayStart("a", 1000);
		await repo.recordPlayStart("b", 2000);
		await repo.deleteTrack("a");
		expect(await repo.getTrack("a")).toBeUndefined();
		expect(await repo.getPlaylists()).toMatchObject([
			{ id: "p", trackIds: ["b"] },
		]);
		expect(await repo.getFavorites()).toHaveLength(0);
		expect(await repo.getRatings()).toHaveLength(0);
		expect((await repo.getHistory(10)).map((h) => h.trackId)).toEqual(["b"]);
		await repo.close();
	});

	it("lists recently added newest-first", async () => {
		const repo = await newRepo();
		await repo.saveTracks([
			record("a", { addedAt: 100 }),
			record("b", { addedAt: 300 }),
			record("c", { addedAt: 200 }),
		]);
		expect((await repo.getRecentlyAdded(2)).map((t) => t.id)).toEqual([
			"b",
			"c",
		]);
		await repo.close();
	});
});

describe("artwork refs", () => {
	it("refcounts and deletes at zero", async () => {
		const repo = await newRepo();
		const blob = new Blob(["cover"]);
		await repo.ensureArtwork({
			id: "art-1",
			blob,
			mime: "image/jpeg",
			width: null,
			height: null,
			refs: 0,
		});
		await repo.ensureArtwork({
			id: "art-1",
			blob,
			mime: "image/jpeg",
			width: null,
			height: null,
			refs: 0,
		});
		await repo.retainArtwork("art-1");
		await repo.retainArtwork("art-1");
		expect(await repo.releaseArtwork("art-1")).toBe(false);
		expect(await repo.releaseArtwork("art-1")).toBe(true);
		expect(await repo.getArtwork("art-1")).toBeUndefined();
		expect(await repo.releaseArtwork("missing")).toBe(false);
		await repo.close();
	});
});

describe("sources", () => {
	it("round-trips source records", async () => {
		const repo = await newRepo();
		await repo.saveSource({
			id: "s1",
			kind: "directory",
			name: "Music",
			handle: null,
			addedAt: 1,
			lastValidatedAt: null,
		});
		expect(await repo.getSources()).toHaveLength(1);
		await repo.deleteSource("s1");
		expect(await repo.getSources()).toHaveLength(0);
		await repo.close();
	});
});

describe("playlists", () => {
	it("saves newest-first and deletes", async () => {
		const repo = await newRepo();
		await repo.savePlaylist({
			id: "p1",
			name: "Old",
			trackIds: [],
			createdAt: 1,
			updatedAt: 1,
		});
		await repo.savePlaylist({
			id: "p2",
			name: "New",
			trackIds: ["x"],
			createdAt: 2,
			updatedAt: 2,
		});
		expect((await repo.getPlaylists()).map((p) => p.id)).toEqual(["p2", "p1"]);
		await repo.deletePlaylist("p1");
		expect(await repo.getPlaylists()).toHaveLength(1);
		await repo.close();
	});
});

describe("favorites and ratings", () => {
	it("adds, removes, and clears ratings at zero", async () => {
		const repo = await newRepo();
		await repo.addFavorite("a");
		await repo.addFavorite("b");
		expect((await repo.getFavorites()).map((f) => f.trackId)).toContain("a");
		await repo.removeFavorite("a");
		expect((await repo.getFavorites()).map((f) => f.trackId)).toEqual(["b"]);

		await repo.setRating("a", 4.5);
		expect(await repo.getRatings()).toMatchObject([
			{ trackId: "a", value: 4.5 },
		]);
		await repo.setRating("a", 0);
		expect(await repo.getRatings()).toHaveLength(0);
		await repo.close();
	});
});

describe("history and stats", () => {
	it("records plays, aggregates stats, caps history", async () => {
		const repo = await newRepo();
		const seq = await repo.recordPlayStart("a", 1000);
		await repo.recordPlayEnd(seq, true, 2000);
		const seq2 = await repo.recordPlayStart("a", 3000);
		await repo.recordPlayEnd(seq2, false, 3005); // too short: no count
		expect(await repo.getAllStats()).toMatchObject([
			{ trackId: "a", playCount: 1 },
		]);
		expect((await repo.getRecentlyPlayed(5)).map((s) => s.trackId)).toEqual([
			"a",
		]);
		expect(await repo.getHistory(10)).toHaveLength(2);
		await repo.recordPlayEnd(999999, true, 4000); // unknown seq: no-op
		await repo.close();
	});
});

describe("IEM measurements, targets, and profiles", () => {
	it("round-trips all three stores", async () => {
		const repo = await newRepo();
		await repo.saveMeasurement({
			id: "m1",
			name: "Test IEM",
			source: "unit",
			channel: "average",
			frequencies: [20, 1000, 20000],
			gains: [0, 5, -2],
			metadata: { pointCount: 3, minFrequency: 20, maxFrequency: 20000 },
			createdAt: 1,
		});
		await repo.saveTarget({
			id: "t1",
			name: "Flat",
			kind: "builtin-flat",
			frequencies: [20, 20000],
			gains: [0, 0],
			metadata: { pointCount: 2 },
			createdAt: 1,
			updatedAt: 1,
		});
		await repo.saveProfile({
			id: "p1",
			name: "My IEM",
			manufacturer: "",
			model: "",
			measurementId: "m1",
			targetId: "t1",
			eq: null,
			eqMeta: null,
			createdAt: 1,
			updatedAt: 1,
		});
		expect(await repo.getMeasurements()).toHaveLength(1);
		expect(await repo.getTargets()).toHaveLength(1);
		expect(await repo.getProfiles()).toMatchObject([
			{ id: "p1", measurementId: "m1" },
		]);
		await repo.deleteMeasurement("m1");
		await repo.deleteTarget("t1");
		await repo.deleteProfile("p1");
		expect(await repo.getMeasurements()).toHaveLength(0);
		expect(await repo.getTargets()).toHaveLength(0);
		expect(await repo.getProfiles()).toHaveLength(0);
		await repo.close();
	});
});

describe("uninitialized repository", () => {
	it("throws a clear error", async () => {
		const repo = new LibraryRepository();
		await expect(repo.getAllTracks()).rejects.toThrow("not initialized");
	});
});
