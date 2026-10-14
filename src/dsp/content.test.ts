import { describe, expect, it } from "vitest";
import { cueTimeToSeconds, parseCueSheet } from "./cue";
import {
	exportCurveCsv,
	exportGraphicEq,
	exportParametricText,
	parseCurveCsv,
	parseGraphicEq,
	parseParametricText,
} from "./formats";
import { activeLyricIndex, normalizeEmbeddedLyrics, parseLrc } from "./lyrics";
import { SMART_RULES, type SmartLibrary, smartTrackIds } from "./smart";

describe("cue sheets", () => {
	it("parses tracks with indexes and links ends", () => {
		expect(cueTimeToSeconds("04:20:00")).toBe(260);
		expect(cueTimeToSeconds("04:20:37")).toBeCloseTo(260 + 37 / 75, 9);
		expect(cueTimeToSeconds("bogus")).toBeNull();
		const cue = parseCueSheet(
			[
				'FILE "album.flac" WAVE',
				'  TITLE "Album"',
				'  PERFORMER "Artist"',
				"  TRACK 01 AUDIO",
				'    TITLE "One"',
				"    INDEX 01 00:00:00",
				"  TRACK 02 AUDIO",
				'    TITLE "Two"',
				"    INDEX 00 03:58:00",
				"    INDEX 01 04:00:00",
			].join("\n"),
		);
		expect(cue?.audioFileName).toBe("album.flac");
		expect(cue?.tracks).toHaveLength(2);
		expect(cue?.tracks[0]).toMatchObject({
			number: 1,
			title: "One",
			startSec: 0,
			endSec: 240,
		});
		expect(cue?.tracks[1]).toMatchObject({
			number: 2,
			pauseStartSec: 238,
			startSec: 240,
			endSec: null,
		});
	});

	it("fails safe on tracks without INDEX 01", () => {
		expect(parseCueSheet('TRACK 01 AUDIO\n  TITLE "X"\n')).toBeNull();
		expect(parseCueSheet("")).toBeNull();
	});
});

describe("preset text formats", () => {
	it("parses GraphicEQ lines with clamping warnings", () => {
		const parsed = parseGraphicEq("GraphicEQ: 31 0.0; 62 3.5; 125 -99");
		expect(parsed?.bands).toHaveLength(3);
		expect(parsed?.bands[1]).toMatchObject({
			type: "peaking",
			frequency: 62,
			gain: 3.5,
			q: 1,
		});
		expect(parsed?.bands[2]?.gain).toBe(-12);
		expect(parsed?.warnings.join(" ")).toMatch(/assumed Q 1\.0/);
		expect(parsed?.warnings.join(" ")).toMatch(/clamped/);
		expect(parseGraphicEq("")).toBeNull();
		expect(parseGraphicEq("GraphicEQ: bogus")).toBeNull();
	});

	it("round-trips GraphicEQ text", () => {
		const text = exportGraphicEq([100, 1000], [1.5, -2.25], -6);
		expect(text).toContain("Preamp: -6");
		expect(text).toContain("GraphicEQ: 100 1.5; 1000 -2.25");
		expect(parseGraphicEq(text)?.bands).toHaveLength(2);
	});

	it("parses the parametric subset with loss warnings", () => {
		const parsed = parseParametricText(
			[
				"Preamp: -6.0 dB",
				"Filter 1: ON PK Fc 1000 Hz Gain 3 dB Q 1",
				"Filter 2: OFF LS Fc 100 Hz Gain 2 dB Q 0.7",
				"Filter 3: ON NOPE Fc 100 Hz Gain 0 dB Q 1",
			].join("\n"),
		);
		expect(parsed?.preampDb).toBe(-6);
		expect(parsed?.bands).toHaveLength(2);
		expect(parsed?.bands[1]).toMatchObject({
			type: "lowshelf",
			enabled: false,
		});
		expect(parsed?.warnings.join(" ")).toMatch(/unrecognized/);
		expect(parseParametricText("# only a comment")).toBeNull();
	});

	it("round-trips parametric text", () => {
		const text = exportParametricText(-3, [
			{ type: "peaking", frequency: 1000, gain: 2, q: 1, enabled: true },
			{ type: "highpass", frequency: 30, gain: 0, q: 0.7, enabled: true },
		]);
		const back = parseParametricText(text);
		expect(back?.preampDb).toBe(-3);
		expect(back?.bands).toHaveLength(2);
		expect(back?.bands[0]).toMatchObject({ type: "peaking", gain: 2 });
	});

	it("parses curve CSV with headers tolerated", () => {
		const parsed = parseCurveCsv("# frequency,gain\n20,3.0\n1000,-1.5\n");
		expect(parsed?.bands).toHaveLength(2);
		expect(parsed?.warnings.join(" ")).toMatch(/assumed Q/);
		expect(exportCurveCsv([20], [3])).toContain("20,3");
		expect(parseCurveCsv("")).toBeNull();
	});
});

describe("lyrics", () => {
	it("parses LRC with offsets and multi-stamps", () => {
		const parsed = parseLrc(
			"[ti:Song]\n[ar:Singer]\n[offset:+500]\n[00:10.00]Hello\n[00:20.00][00:25.00]Again\n",
		);
		expect(parsed?.title).toBe("Song");
		expect(parsed?.artist).toBe("Singer");
		expect(parsed?.synced).toBe(true);
		expect(parsed?.lines).toHaveLength(3);
		expect(parsed?.lines[0]?.t).toBeCloseTo(10.5, 9);
		expect(activeLyricIndex(parsed?.lines ?? [], 0)).toBe(-1);
		expect(activeLyricIndex(parsed?.lines ?? [], 10.5)).toBe(0);
		expect(activeLyricIndex(parsed?.lines ?? [], 30)).toBe(2);
	});

	it("falls back to plain text without timestamps", () => {
		const parsed = parseLrc("Just\nsome words\n");
		expect(parsed?.synced).toBe(false);
		expect(parsed?.lines).toHaveLength(2);
		expect(parseLrc("")).toBeNull();
	});

	it("normalizes embedded tags defensively", () => {
		expect(
			normalizeEmbeddedLyrics({
				syncText: [
					{ text: "Hi", timestamp: 1500 },
					{ text: "  ", timestamp: 2000 },
				],
			}),
		).toMatchObject({ synced: true, lines: [{ t: 1.5, text: "Hi" }] });
		expect(normalizeEmbeddedLyrics({ text: "a\nb" })?.synced).toBe(false);
		expect(normalizeEmbeddedLyrics(null)).toBeNull();
		expect(normalizeEmbeddedLyrics({})).toBeNull();
	});
});

describe("smart playlists", () => {
	function library(): SmartLibrary {
		const tracks = {
			a: {
				id: "a",
				addedAt: 3,
				duration: 200,
				fileName: "a.flac",
				fileType: "",
				title: "A",
				artist: "Zed",
			},
			b: {
				id: "b",
				addedAt: 1,
				duration: 600,
				fileName: "b.mp3",
				fileType: "",
				title: "B",
				artist: "Al",
			},
			c: {
				id: "c",
				addedAt: 2,
				duration: 100,
				fileName: "c.wav",
				fileType: "",
				title: "C",
				artist: "Mid",
			},
		} as unknown as SmartLibrary["tracks"];
		return {
			tracks,
			order: ["a", "b", "c"],
			favorites: ["c"],
			ratings: { b: 5 },
			stats: {
				a: { trackId: "a", playCount: 5, lastPlayedAt: 10 },
				b: { trackId: "b", playCount: 2, lastPlayedAt: 20 },
			},
		};
	}

	it("covers every rule id deterministically", () => {
		expect(SMART_RULES.length).toBeGreaterThan(0);
		const lib = library();
		expect(smartTrackIds("most-played", lib)).toEqual(["a", "b"]);
		expect(smartTrackIds("recently-played", lib)).toEqual(["b", "a"]);
		expect(smartTrackIds("never-played", lib)).toEqual(["c"]);
		expect(smartTrackIds("favorites", lib)).toEqual(["c"]);
		expect(smartTrackIds("five-star", lib)).toEqual(["b"]);
		expect(smartTrackIds("recently-added", lib)).toEqual(["a", "c", "b"]);
		expect(smartTrackIds("long-tracks", lib)).toEqual(["b"]);
		expect(smartTrackIds("flac", lib)).toEqual(["a"]);
		expect(smartTrackIds("lossless", lib)).toEqual(["c", "a"]);
		// Deterministic reruns.
		expect(smartTrackIds("most-played", lib)).toEqual(
			smartTrackIds("most-played", lib),
		);
	});
});
