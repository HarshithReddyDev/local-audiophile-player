import { describe, expect, it } from "vitest";
import { makeTrack } from "../types/library";
import { useLibraryStore } from "./library-store";

function reset() {
	useLibraryStore.getState().clearLibrary();
	useLibraryStore.setState({ searchQuery: "", selectedTrackId: null });
}

function file(name: string, size = 100): File {
	return new File([new Uint8Array(size)], name, {
		type: "audio/mpeg",
		lastModified: 1,
	});
}

describe("library store", () => {
	it("adds tracks and dedupes identical files", () => {
		reset();
		const s = useLibraryStore.getState();
		const added = s.addTracks([
			{ track: makeTrack({ id: "a", title: "A" }), file: file("a.mp3") },
			{ track: makeTrack({ id: "b", title: "B" }), file: file("b.mp3") },
		]);
		expect(added).toEqual(["a", "b"]);
		const again = useLibraryStore.getState().addTracks([
			{
				track: makeTrack({ id: "a2", title: "A copy" }),
				file: file("a.mp3"),
			},
		]);
		expect(again).toEqual([]);
		expect(useLibraryStore.getState().order).toEqual(["a", "b"]);
	});

	it("removes tracks and clears", () => {
		reset();
		const s = useLibraryStore.getState();
		s.addTracks([{ track: makeTrack({ id: "a" }), file: file("a.mp3") }]);
		s.removeTrack("a");
		expect(useLibraryStore.getState().order).toEqual([]);
		s.addTracks([{ track: makeTrack({ id: "b" }), file: file("b.mp3") }]);
		s.clearLibrary();
		expect(useLibraryStore.getState().order).toEqual([]);
		expect(useLibraryStore.getState().getFile("b")).toBeUndefined();
	});

	it("manages playlists and strips removed tracks", () => {
		reset();
		const s = useLibraryStore.getState();
		s.addTracks([
			{ track: makeTrack({ id: "a" }), file: file("a.mp3") },
			{ track: makeTrack({ id: "b" }), file: file("b.mp3") },
		]);
		const pid = s.createPlaylist("Mix", ["a"]);
		expect(useLibraryStore.getState().playlists[pid]?.trackIds).toEqual(["a"]);
		useLibraryStore.getState().addToPlaylist(pid, ["b", "b", "missing"]);
		expect(useLibraryStore.getState().playlists[pid]?.trackIds).toEqual([
			"a",
			"b",
		]);
		useLibraryStore.getState().removeTrack("a");
		expect(useLibraryStore.getState().playlists[pid]?.trackIds).toEqual(["b"]);
		useLibraryStore.getState().deletePlaylist(pid);
		expect(useLibraryStore.getState().playlists[pid]).toBeUndefined();
	});

	it("hydrate drops dangling references instead of keeping ghosts", () => {
		reset();
		useLibraryStore.getState().hydrate({
			tracks: [makeTrack({ id: "a" })],
			playlists: [
				{
					id: "p",
					name: "Mix",
					trackIds: ["a", "ghost"],
					createdAt: 0,
					updatedAt: 0,
				},
			],
			favoriteIds: ["a", "ghost"],
			ratings: { a: 4, ghost: 5 },
			stats: {
				a: { trackId: "a", playCount: 1, lastPlayedAt: 0 },
				ghost: { trackId: "ghost", playCount: 9, lastPlayedAt: 0 },
			},
			sources: [],
		});
		const s = useLibraryStore.getState();
		expect(s.playlists["p"]?.trackIds).toEqual(["a"]);
		expect(s.favorites).toEqual(["a"]);
		expect(s.ratings).toEqual({ a: 4 });
		expect(Object.keys(s.stats)).toEqual(["a"]);
	});
});
