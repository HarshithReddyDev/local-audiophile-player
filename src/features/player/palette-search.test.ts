import { describe, expect, it } from "vitest";
import { type PaletteCorpus, searchPalette } from "./palette-search";

function corpus(): PaletteCorpus {
	return {
		tracks: [
			{
				id: "t1",
				title: "Blue in Green",
				artist: "Miles Davis",
				album: "Kind of Blue",
			},
			{
				id: "t2",
				title: "So What",
				artist: "Miles Davis",
				album: "Kind of Blue",
			},
			{ id: "t3", title: "Headphones Etude", artist: "Autechre", album: "LP5" },
		],
		playlists: [{ id: "p1", name: "Late Night Jazz", trackIds: ["t1", "t2"] }],
		presets: [{ id: "e1", name: "Warm Tilt", detail: "Manual · 3 bands" }],
		devices: [{ id: "d1", title: "Sennheiser HD 600", subtitle: "Headphones" }],
		routes: [{ id: "eq", title: "EQ", subtitle: "Parametric and graphic" }],
		actions: [
			{ id: "play-pause", title: "Play / pause", subtitle: "Transport" },
			{ id: "toggle-dsp", title: "Toggle DSP bypass", subtitle: "Audio" },
		],
	};
}

describe("searchPalette", () => {
	it("returns routes and actions for an empty query", () => {
		const results = searchPalette("", corpus());
		expect(results.length).toBeGreaterThan(0);
		expect(
			results.every((r) => r.kind === "route" || r.kind === "action"),
		).toBe(true);
	});

	it("matches tracks by title, artist, and album", () => {
		expect(searchPalette("so what", corpus()).map((r) => r.id)).toContain("t2");
		const miles = searchPalette("miles", corpus());
		expect(miles.filter((r) => r.kind === "track").map((r) => r.id)).toEqual(
			expect.arrayContaining(["t1", "t2"]),
		);
		const album = searchPalette("kind of blue", corpus());
		expect(
			album.some((r) => r.kind === "album" && r.id === "Kind of Blue"),
		).toBe(true);
	});

	it("finds playlists, devices, presets, and actions", () => {
		expect(searchPalette("late night", corpus())[0]).toMatchObject({
			kind: "playlist",
			id: "p1",
		});
		expect(searchPalette("hd 600", corpus())[0]).toMatchObject({
			kind: "device",
			id: "d1",
		});
		expect(searchPalette("warm tilt", corpus())[0]).toMatchObject({
			kind: "preset",
			id: "e1",
		});
		expect(searchPalette("toggle dsp", corpus())[0]).toMatchObject({
			kind: "action",
			id: "toggle-dsp",
		});
	});

	it("ranks exact and prefix matches first and caps results", () => {
		const results = searchPalette(" Miles ", corpus(), 2);
		expect(results).toHaveLength(2);
		// Exact artist match outranks artist-substring track matches.
		expect(results[0]).toMatchObject({ kind: "artist", id: "Miles Davis" });
		expect(searchPalette("zzz-no-match", corpus())).toEqual([]);
	});

	it("is deterministic across runs", () => {
		const a = JSON.stringify(searchPalette("e", corpus()));
		const b = JSON.stringify(searchPalette("e", corpus()));
		expect(a).toBe(b);
	});
});
