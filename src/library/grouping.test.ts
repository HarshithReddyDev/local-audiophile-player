import { describe, expect, it } from "vitest";
import { makeTrack } from "../types/library";
import {
	buildAlbums,
	buildArtists,
	filterTracks,
	sortTracks,
} from "./grouping";

const tracks = [
	makeTrack({
		id: "t1",
		title: "Beta",
		artist: "Alice",
		album: "First",
		albumArtist: "Alice",
		trackNumber: 2,
		year: 2020,
	}),
	makeTrack({
		id: "t2",
		title: "Alpha",
		artist: "Alice",
		album: "First",
		albumArtist: "Alice",
		trackNumber: 1,
		year: 2020,
	}),
	makeTrack({
		id: "t3",
		title: "Gamma",
		artist: "Bob",
		album: "Second",
		albumArtist: "Bob",
		year: 2022,
		genre: ["Jazz"],
	}),
];

describe("buildAlbums", () => {
	it("groups and orders by track number", () => {
		const albums = buildAlbums(tracks);
		expect(albums).toHaveLength(2);
		expect(albums[0]?.trackIds).toEqual(["t2", "t1"]);
		expect(albums[0]?.year).toBe(2020);
	});
});

describe("buildArtists", () => {
	it("collects tracks and albums", () => {
		const artists = buildArtists(tracks, buildAlbums(tracks));
		expect(artists.map((a) => a.name)).toEqual(["Alice", "Bob"]);
		expect(artists[0]?.trackIds).toEqual(["t1", "t2"]);
	});
});

describe("filterTracks", () => {
	it("matches across fields, case-insensitive", () => {
		expect(filterTracks(tracks, "alice")).toHaveLength(2);
		expect(filterTracks(tracks, "jazz")).toHaveLength(1);
		expect(filterTracks(tracks, "  ")).toHaveLength(3);
		expect(filterTracks(tracks, "zzz")).toHaveLength(0);
	});
});

describe("sortTracks", () => {
	it("sorts by title with stable tiebreak", () => {
		expect(sortTracks(tracks, "title").map((t) => t.id)).toEqual([
			"t2",
			"t1",
			"t3",
		]);
		expect(sortTracks(tracks, "year", -1).map((t) => t.id)).toEqual([
			"t3",
			"t2",
			"t1",
		]);
	});
});
