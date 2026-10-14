import { describe, expect, it } from "vitest";
import {
	cleanUrl,
	detectPlaylistFormat,
	PlaylistFileError,
	parsePlaylistFile,
	splitArtistTitle,
} from "./file-provider";

describe("playlist file detection", () => {
	it("routes by extension", () => {
		expect(detectPlaylistFormat("a.m3u")).toBe("m3u");
		expect(detectPlaylistFormat("a.m3u8")).toBe("m3u");
		expect(detectPlaylistFormat("a.csv")).toBe("csv");
		expect(detectPlaylistFormat("a.txt")).toBe("csv");
		expect(detectPlaylistFormat("a.json")).toBe("json");
		expect(() => detectPlaylistFormat("a.xml")).toThrowError(PlaylistFileError);
	});
});

describe("helpers", () => {
	it("keeps only http(s) URLs", () => {
		expect(cleanUrl("https://example.com/x")).toBe("https://example.com/x");
		expect(cleanUrl("file:///etc/passwd")).toBeNull();
		expect(cleanUrl("javascript:alert(1)")).toBeNull();
		expect(cleanUrl("  ")).toBeNull();
	});

	it("splits Artist - Title", () => {
		expect(splitArtistTitle("Green Field - Blue Sky")).toEqual({
			artist: "Green Field",
			title: "Blue Sky",
		});
		expect(splitArtistTitle("NoSeparator")).toEqual({
			artist: "",
			title: "NoSeparator",
		});
	});
});

describe("M3U parsing", () => {
	it("reads EXTINF entries and plain paths", () => {
		const pl = parsePlaylistFile(
			"#EXTM3U\n#EXTINF:200,Green Field - Blue Sky\n/music/sky.mp3\n# a comment\nhttps://example.com/stream\n",
			"mix.m3u",
			0,
		);
		expect(pl.name).toBe("mix");
		expect(pl.tracks).toHaveLength(2);
		expect(pl.tracks[0]).toMatchObject({
			title: "Blue Sky",
			artists: ["Green Field"],
			durationSec: 200,
			position: 0,
		});
		expect(pl.tracks[1]?.sourceUrl).toBe("https://example.com/stream");
		// Identity is the file name so edited re-imports diff as updates.
		expect(pl.externalId).toBe("file:mix");
	});

	it("rejects empty playlists", () => {
		expect(() => parsePlaylistFile("#EXTM3U\n", "empty.m3u", 0)).toThrowError(
			PlaylistFileError,
		);
	});
});

describe("CSV parsing", () => {
	it("detects headers and parses rows", () => {
		const pl = parsePlaylistFile(
			'title,artist,album,duration\n"Blue, Sky",Green Field,Wide Open,3:20\nRed Sky,Someone Else,,200\n',
			"list.csv",
			0,
		);
		expect(pl.tracks).toHaveLength(2);
		expect(pl.tracks[0]).toMatchObject({
			title: "Blue, Sky",
			artists: ["Green Field"],
			album: "Wide Open",
			durationSec: 200,
		});
		expect(pl.tracks[1]?.durationSec).toBe(200);
	});

	it("rejects headerless garbage without title/artist", () => {
		expect(() =>
			parsePlaylistFile("foo,bar\n1,2\n", "bad.csv", 0),
		).toThrowError(PlaylistFileError);
	});
});

describe("JSON parsing", () => {
	it("reads the documented shape", () => {
		const pl = parsePlaylistFile(
			JSON.stringify({
				name: "Roadtrip",
				description: "Driving tunes",
				tracks: [
					{
						title: "Blue Sky",
						artist: "Green Field",
						album: "Wide Open",
						duration: 200,
						isrc: "USX1",
					},
					{ title: "Red Sky", artists: ["Someone Else"] },
				],
			}),
			"road.json",
			7,
		);
		expect(pl.name).toBe("Roadtrip");
		expect(pl.importedAt).toBe(7);
		expect(pl.tracks).toHaveLength(2);
		expect(pl.tracks[0]).toMatchObject({ isrc: "USX1", durationSec: 200 });
		expect(pl.tracks[1]?.artists).toEqual(["Someone Else"]);
	});

	it("fails safe on malformed JSON content", () => {
		expect(() => parsePlaylistFile("{nope", "x.json", 0)).toThrowError(
			PlaylistFileError,
		);
		expect(() =>
			parsePlaylistFile(JSON.stringify({ tracks: [{ nope: 1 }] }), "x.json", 0),
		).toThrowError(/title or artist/);
		expect(() =>
			parsePlaylistFile(JSON.stringify({ tracks: [] }), "x.json", 0),
		).toThrowError(/no "tracks"/);
	});
});
