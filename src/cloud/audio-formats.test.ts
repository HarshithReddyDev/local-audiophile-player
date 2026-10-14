import { describe, expect, it } from "vitest";
import {
	browserFormatSupport,
	extensionOf,
	guessAudioMime,
	isAudioFile,
} from "./audio-formats";

describe("cloud audio discovery", () => {
	it("detects audio by provider MIME or extension", () => {
		expect(isAudioFile("song.mp3", null)).toBe(true);
		expect(isAudioFile("song.MP3", null)).toBe(true);
		expect(isAudioFile("recording", "audio/flac")).toBe(true);
		expect(isAudioFile("notes.txt", "text/plain")).toBe(false);
		expect(isAudioFile("photo.jpg", null)).toBe(false);
		expect(isAudioFile("track", null)).toBe(false);
	});

	it("guesses MIME from provider metadata first, extension second", () => {
		expect(guessAudioMime("song.bin", "audio/mpeg")).toBe("audio/mpeg");
		expect(guessAudioMime("song.flac", null)).toBe("audio/flac");
		expect(guessAudioMime("song.unknownext", null)).toBe("");
		expect(extensionOf("a.b.C")).toBe("c");
	});

	it("classifies browser support honestly (node: no decoder info)", () => {
		// Pure Node has no media stack: audio/* stays possibly-supported
		// (try at play time), non-audio is unsupported.
		expect(browserFormatSupport("song.mp3", "audio/mpeg")).toBe(
			"possibly-supported",
		);
		expect(browserFormatSupport("notes.txt", "text/plain")).toBe("unsupported");
		expect(browserFormatSupport("mystery", null)).toBe("possibly-supported");
	});
});
