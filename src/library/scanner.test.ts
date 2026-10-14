import { describe, expect, it } from "vitest";
import { fallbackTrack } from "./metadata";
import { AUDIO_ACCEPT, isSupportedFile, scanFiles } from "./scanner";

function file(name: string, type = ""): File {
	return new File([new Uint8Array([0, 1, 2])], name, { type });
}

describe("isSupportedFile", () => {
	it("accepts audio MIME types and known extensions", () => {
		expect(isSupportedFile(file("song.mp3", "audio/mpeg"))).toBe(true);
		expect(isSupportedFile(file("song.FLAC", ""))).toBe(true);
		expect(isSupportedFile(file("notes.txt", "text/plain"))).toBe(false);
		expect(isSupportedFile(file("cover.jpg", "image/jpeg"))).toBe(false);
		expect(AUDIO_ACCEPT).toContain("audio/*");
	});
});

describe("scanFiles", () => {
	it("falls back to filename metadata for untagged files", async () => {
		const progress: number[] = [];
		const out = await scanFiles(
			[file("cool-song.mp3", "audio/mpeg"), file("skip.txt", "text/plain")],
			(p) => progress.push(p.processed),
		);
		expect(out).toHaveLength(1);
		expect(out[0]?.track.title).toBe("cool-song");
		expect(out[0]?.relativePath).toBe("cool-song.mp3");
		expect(out[0]?.artwork).toBeNull();
		expect(progress.at(-1)).toBe(1);
	});

	it("never throws on garbage input", async () => {
		const garbage = new File(["not audio at all"], "broken.mp3", {
			type: "audio/mpeg",
		});
		const out = await scanFiles([garbage]);
		expect(out).toHaveLength(1);
		expect(out[0]?.track.fileName).toBe("broken.mp3");
	});
});

describe("fallbackTrack", () => {
	it("derives title from filename", () => {
		const t = fallbackTrack(file("My Song.wav"));
		expect(t.title).toBe("My Song");
		expect(t.artist).toBe("Unknown artist");
	});
});

describe("scanDirectory", () => {
	function fakeFileHandle(name: string, contents: string | Uint8Array) {
		const bytes = new Uint8Array(
			typeof contents === "string"
				? new TextEncoder().encode(contents)
				: contents,
		);
		return {
			kind: "file",
			name,
			getFile: async () =>
				new File([bytes], name, {
					type: name.endsWith(".mp3") ? "audio/mpeg" : "text/plain",
				}),
		};
	}

	function fakeDir(
		name: string,
		entries: { kind: string; name: string; handle: unknown }[],
	) {
		return {
			kind: "directory",
			name,
			values: async function* () {
				for (const entry of entries) yield entry.handle;
			},
		};
	}

	it("attaches .lrc sidecars to matching tracks", async () => {
		const song = fakeFileHandle("song.mp3", new Uint8Array([1, 2, 3]));
		const lrc = fakeFileHandle(
			"song.lrc",
			"[00:10.00]Hello\n[00:20.00]World\n",
		);
		const other = fakeFileHandle("other.lrc", "[00:01.00]Orphan\n");
		const dir = fakeDir("root", [
			{ kind: "file", name: "song.mp3", handle: song },
			{ kind: "file", name: "song.lrc", handle: lrc },
			{ kind: "file", name: "other.lrc", handle: other },
		]);
		const { scanDirectory } = await import("./scanner");
		const out = await scanDirectory(
			dir as unknown as FileSystemDirectoryHandle,
		);
		expect(out).toHaveLength(1);
		expect(out[0]?.relativePath).toBe("song.mp3");
		expect(out[0]?.track.lyrics).toMatchObject({
			source: "lrc",
			synced: [
				{ t: 10, text: "Hello" },
				{ t: 20, text: "World" },
			],
		});
	});

	it("prefers embedded lyrics over sidecars", async () => {
		const { scanDirectory } = await import("./scanner");
		// Untagged garbage falls back to filename metadata with no lyrics;
		// a sidecar still attaches (nothing embedded to prefer).
		const song = fakeFileHandle("plain.mp3", new Uint8Array([9, 9]));
		const lrc = fakeFileHandle("plain.lrc", "Just words\n");
		const dir = fakeDir("root", [
			{ kind: "file", name: "plain.mp3", handle: song },
			{ kind: "file", name: "plain.lrc", handle: lrc },
		]);
		const out = await scanDirectory(
			dir as unknown as FileSystemDirectoryHandle,
		);
		expect(out[0]?.track.lyrics).toMatchObject({
			source: "lrc",
			synced: null,
		});
	});
});
