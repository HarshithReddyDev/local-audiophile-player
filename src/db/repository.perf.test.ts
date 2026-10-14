import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { destroyLibraryDatabase } from "../db/database";
import { LibraryRepository } from "../db/repository";
import type { TrackRecord } from "../db/schema";
import { buildAlbums, buildArtists } from "../library/grouping";

const COUNT = 10_000;

function synthetic(i: number): TrackRecord {
	const artist = `Artist ${i % 400}`;
	return {
		id: `trk-perf-${i}`,
		title: `Song ${i}`,
		artist,
		album: `Album ${i % 1200}`,
		albumArtist: artist,
		trackNumber: (i % 12) + 1,
		discNumber: 1,
		duration: 200 + (i % 180),
		year: 1990 + (i % 35),
		genre: i % 3 === 0 ? ["Rock"] : i % 3 === 1 ? ["Jazz"] : ["Electronic"],
		fileName: `song-${i}.mp3`,
		fileType: "audio/mpeg",
		fileSize: 5_000_000 + i,
		mtime: 1_700_000_000_000,
		artworkId: null,
		sourceId: "src-perf",
		path: `song-${i}.mp3`,
		addedAt: 1_700_000_000_000 + i,
		updatedAt: 1_700_000_000_000 + i,
		missing: false,
	};
}

async function buildDb(): Promise<LibraryRepository> {
	await destroyLibraryDatabase("iem-player-library");
	const repo = new LibraryRepository();
	await repo.init();
	return repo;
}

afterEach(async () => {
	await destroyLibraryDatabase("iem-player-library");
});

describe("10k-track performance (fake-indexeddb measures JS + algorithm cost)", () => {
	it("inserts, searches, groups, and restores within budget", async () => {
		const repo = await buildDb();
		const records = Array.from({ length: COUNT }, (_, i) => synthetic(i));

		let start = performance.now();
		await repo.saveTracks(records);
		const insertMs = performance.now() - start;

		start = performance.now();
		const all = await repo.getAllTracks();
		const restoreMs = performance.now() - start;
		expect(all).toHaveLength(COUNT);

		start = performance.now();
		const hits = await repo.searchTracks("song 999");
		const searchMs = performance.now() - start;
		expect(hits.length).toBeGreaterThan(0);

		start = performance.now();
		const albums = buildAlbums(all);
		const artists = buildArtists(all, albums);
		const groupMs = performance.now() - start;
		expect(albums.length).toBeGreaterThan(0);
		expect(artists).toHaveLength(400);

		start = performance.now();
		const recent = await repo.getRecentlyAdded(100);
		const recentMs = performance.now() - start;
		expect(recent).toHaveLength(100);

		// Timings are informational; ceilings are generous anti-regression
		// guards (Node + in-memory IDB shim, not a real browser disk).
		console.log(
			`perf/10k insert=${Math.round(insertMs)}ms restore=${Math.round(restoreMs)}ms ` +
				`search=${Math.round(searchMs)}ms group=${Math.round(groupMs)}ms recent=${Math.round(recentMs)}ms`,
		);
		expect(insertMs).toBeLessThan(60_000);
		expect(searchMs).toBeLessThan(2_000);
		expect(groupMs).toBeLessThan(5_000);
		expect(restoreMs).toBeLessThan(5_000);
		expect(recentMs).toBeLessThan(1_000);
		await repo.close();
	}, 120_000);
});
