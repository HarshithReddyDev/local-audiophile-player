import { describe, expect, it } from "vitest";
import {
	type LocalCandidate,
	matchPlaylist,
	matchTrack,
	normalizeText,
	scorePair,
	splitArtists,
	splitVersion,
} from "./match";
import type { ExternalTrack } from "./model";

function ext(over: Partial<ExternalTrack> = {}): ExternalTrack {
	return {
		provider: "file",
		externalId: "x",
		title: "Blue Sky",
		artists: ["Green Field"],
		album: "Wide Open",
		durationSec: 200,
		isrc: null,
		trackNumber: null,
		sourceUrl: null,
		position: 0,
		...over,
	};
}

function local(over: Partial<LocalCandidate> = {}): LocalCandidate {
	return {
		id: "l1",
		title: "Blue Sky",
		artist: "Green Field",
		album: "Wide Open",
		durationSec: 201,
		isrc: null,
		...over,
	};
}

describe("normalization", () => {
	it("folds case, accents, punctuation, and whitespace", () => {
		expect(normalizeText("  Béyoncé — “Halo”! ")).toBe("beyonce halo");
		expect(normalizeText("AC/DC")).toBe("ac dc");
	});

	it("splits featured and joint artists", () => {
		expect(splitArtists("A feat. B")).toEqual(["a", "b"]);
		expect(splitArtists("A & B")).toEqual(["a", "b"]);
		expect(splitArtists("A ft B and C")).toEqual(["a", "b", "c"]);
	});

	it("separates version tags from identity", () => {
		expect(splitVersion("Halo (Live)")).toEqual({
			base: "halo",
			tags: ["live"],
		});
		expect(splitVersion("Halo [2018 Remaster]")).toEqual({
			base: "halo",
			tags: ["2018 remaster"],
		});
		expect(splitVersion("Halo")).toEqual({ base: "halo", tags: [] });
	});
});

describe("scorePair", () => {
	it("scores exact metadata HIGH", () => {
		expect(scorePair(ext(), local())).toBe("high");
	});

	it("scores ISRC equality HIGH regardless of text", () => {
		expect(
			scorePair(
				ext({
					isrc: "US-ABC-99-12345",
					title: "zzz",
					artists: ["Green Field"],
				}),
				local({ isrc: "usabc9912345 ", title: "Blue Sky" }),
			),
		).toBe("high");
	});

	it("needs title+artist; artist mismatch is NONE", () => {
		expect(scorePair(ext(), local({ artist: "Someone Else" }))).toBe("none");
		expect(scorePair(ext(), local({ title: "Red Sky" }))).toBe("none");
	});

	it("title+artist alone is MEDIUM (needs corroboration for HIGH)", () => {
		expect(
			scorePair(
				ext({ album: null, durationSec: null }),
				local({ album: "Other", durationSec: null }),
			),
		).toBe("medium");
	});

	it("same song, different version tag is LOW", () => {
		expect(
			scorePair(ext({ title: "Halo (Live)" }), local({ title: "Halo" })),
		).toBe("low");
	});

	it("tolerates ±3s durations and punctuation", () => {
		expect(
			scorePair(
				ext({ durationSec: 203, album: null }),
				local({ durationSec: 200 }),
			),
		).toBe("high");
		expect(
			scorePair(ext({ title: "Blue Sky!", artists: ["GREEN field"] }), local()),
		).toBe("high");
	});
});

describe("matchTrack", () => {
	const lib = [
		local({ id: "a" }),
		local({ id: "b", title: "Red Sky" }),
		local({ id: "c", album: "Wide Open" }),
	];

	it("auto-links exactly one HIGH candidate", () => {
		const m = matchTrack(ext(), [
			local({ id: "a" }),
			local({ id: "b", title: "Red Sky" }),
		]);
		expect(m).toMatchObject({ state: "matched", localTrackId: "a" });
	});

	it("marks multiple HIGHs ambiguous without picking", () => {
		const m = matchTrack(ext(), [local({ id: "a" }), local({ id: "a2" })]);
		expect(m.state).toBe("ambiguous");
		expect(m.localTrackId).toBeNull();
		expect(m.candidates).toEqual(["a", "a2"]);
	});

	it("marks MEDIUM-only as ambiguous", () => {
		const m = matchTrack(ext({ album: null, durationSec: null }), [
			local({ id: "a", album: "Elsewhere", durationSec: null }),
		]);
		expect(m.state).toBe("ambiguous");
		expect(m.confidence).toBe("medium");
	});

	it("marks no-signal as unmatched", () => {
		const m = matchTrack(ext({ title: "zzz", artists: ["yyy"] }), lib);
		expect(m).toMatchObject({ state: "unmatched", confidence: "none" });
	});

	it("is deterministic across library order", () => {
		const m1 = matchTrack(ext(), lib);
		const m2 = matchTrack(ext(), [...lib].reverse());
		expect(m1.state).toBe(m2.state);
	});
});

describe("matchPlaylist", () => {
	it("preserves order across the playlist", () => {
		const out = matchPlaylist(
			[
				ext({ position: 0 }),
				ext({ position: 1, title: "zzz", artists: ["y"] }),
			],
			[local({ id: "a" })],
		);
		expect(out.map((m) => m.state)).toEqual(["matched", "unmatched"]);
	});
});
