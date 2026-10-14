import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { destroyLibraryDatabase } from "../db/database";
import { useLibraryStore } from "../state/library-store";
import { usePlayerStore } from "../state/player-store";
import { libraryService, parseQueueState } from "./library-service";

function audioFile(name: string): File {
	return new File([new Uint8Array([1, 2, 3, 4])], name, {
		type: "audio/mpeg",
		lastModified: 7,
	});
}

function resetStore(): void {
	useLibraryStore.getState().clearLibrary();
	useLibraryStore.setState({
		searchQuery: "",
		selectedTrackId: null,
		sources: {},
		sourceStatuses: {},
	});
}

afterEach(async () => {
	await libraryService.dispose();
	resetStore();
	await destroyLibraryDatabase("iem-player-library");
});

describe("library service", () => {
	it("imports files with stable ids and persists them", async () => {
		await libraryService.initialize();
		expect(libraryService.persistent).toBe(true);
		const first = await libraryService.importPickedFiles([
			audioFile("a.mp3"),
			audioFile("b.mp3"),
		]);
		expect(first.added).toHaveLength(2);
		const ids = [...first.added];

		// Re-importing the same bytes updates instead of duplicating.
		const second = await libraryService.importPickedFiles([audioFile("a.mp3")]);
		expect(second.added).toHaveLength(0);
		expect(second.updated).toEqual([ids[0]]);

		// Favorites and playlists survive through the repository.
		await libraryService.toggleFavorite(ids[0] ?? "");
		const pid = await libraryService.createPlaylist("Mix", ids);
		await libraryService.setRating(ids[0] ?? "", 4);
		expect(useLibraryStore.getState().favorites).toEqual([ids[0]]);
		expect(pid).toBeTruthy();
		await libraryService.dispose();
	});

	it("restores metadata across restart and marks loose files missing", async () => {
		await libraryService.initialize();
		const imported = await libraryService.importPickedFiles([
			audioFile("keep.mp3"),
		]);
		const id = imported.added[0] ?? "";
		await libraryService.toggleFavorite(id);
		await libraryService.createPlaylist("Keep", [id]);
		await libraryService.dispose();

		// Simulate a fresh page load: empty stores, same database.
		resetStore();
		expect(useLibraryStore.getState().order).toHaveLength(0);
		await libraryService.initialize();

		const state = useLibraryStore.getState();
		expect(state.order).toEqual([id]);
		expect(state.tracks[id]?.title).toBe("keep");
		// No handle can reproduce a picked File: honestly unavailable.
		expect(state.tracks[id]?.missing).toBe(true);
		expect(state.favorites).toEqual([id]);
		expect(Object.keys(state.playlists)).toHaveLength(1);

		// Re-selecting the file heals the record with the same stable id.
		const healed = await libraryService.importPickedFiles([
			audioFile("keep.mp3"),
		]);
		expect(healed.added).toHaveLength(0);
		expect(healed.updated).toEqual([id]);
		expect(useLibraryStore.getState().tracks[id]?.missing).toBe(false);
		expect(useLibraryStore.getState().favorites).toEqual([id]);
		await libraryService.dispose();
	});

	it("resolves session files without a database round-trip", async () => {
		await libraryService.initialize();
		const { added } = await libraryService.importPickedFiles([
			audioFile("s.mp3"),
		]);
		const file = await libraryService.resolveFile(added[0] ?? "");
		expect(file?.name).toBe("s.mp3");
		expect(await libraryService.resolveFile("nope")).toBeNull();
		await libraryService.dispose();
	});

	it("persists and restores queue order, index, and modes", async () => {
		await libraryService.initialize();
		const { added } = await libraryService.importPickedFiles([
			audioFile("q1.mp3"),
			audioFile("q2.mp3"),
			audioFile("q3.mp3"),
		]);
		const player = usePlayerStore.getState();
		player.setQueue(added, 1);
		player.cycleRepeat(); // all
		player.setCrossfade(true, 5);
		await libraryService.saveQueueState();
		await libraryService.dispose();

		// Fresh stores, same database.
		resetStore();
		usePlayerStore.getState().clearQueue();
		await libraryService.initialize();
		const restored = usePlayerStore.getState();
		expect(restored.queue.map((q) => q.trackId)).toEqual(added);
		expect(restored.currentIndex).toBe(1);
		expect(restored.currentTrackId()).toBe(added[1]);
		expect(restored.status).toBe("ready");
		expect(restored.repeat).toBe("all");
		expect(restored.crossfadeEnabled).toBe(true);
		expect(restored.crossfadeDuration).toBe(5);
		await libraryService.dispose();
	});

	it("drops stale queue entries for deleted tracks", async () => {
		await libraryService.initialize();
		const { added } = await libraryService.importPickedFiles([
			audioFile("k1.mp3"),
			audioFile("k2.mp3"),
		]);
		usePlayerStore.getState().setQueue(added, 0);
		await libraryService.saveQueueState();
		// Delete one track behind the queue's back, then restart.
		await libraryService.removeTrack(added[0] ?? "");
		await libraryService.dispose();
		resetStore();
		usePlayerStore.getState().clearQueue();
		await libraryService.initialize();
		const restored = usePlayerStore.getState();
		expect(restored.queue.map((q) => q.trackId)).toEqual([added[1]]);
		expect(restored.currentIndex).toBe(0);
		await libraryService.dispose();
	});

	it("restores the current track by id, not by position", async () => {
		await libraryService.initialize();
		const { added } = await libraryService.importPickedFiles([
			audioFile("m1.mp3"),
			audioFile("m2.mp3"),
			audioFile("m3.mp3"),
		]);
		usePlayerStore.getState().setQueue(added, 1);
		await libraryService.saveQueueState();
		// Delete the track *before* the cursor: positional restore would
		// retarget to m3, id-anchored restore stays on m2.
		await libraryService.removeTrack(added[0] ?? "");
		await libraryService.dispose();
		resetStore();
		usePlayerStore.getState().clearQueue();
		await libraryService.initialize();
		const restored = usePlayerStore.getState();
		expect(restored.queue.map((q) => q.trackId)).toEqual([added[1], added[2]]);
		expect(restored.currentTrackId()).toBe(added[1]);
		expect(restored.currentIndex).toBe(0);
		await libraryService.dispose();
	});
});

describe("playlist import sessions", () => {
	function sessionFor(ids: { a: string; b: string; c: string }) {
		return {
			id: "import-1",
			provider: "file" as const,
			externalId: "file:mix:abc123",
			name: "Mix",
			description: null,
			sourceUrl: null,
			importedAt: 0,
			updatedAt: 0,
			localPlaylistId: null as string | null,
			items: [
				{
					key: "k1",
					external: {
						provider: "file" as const,
						externalId: "e1",
						title: "A",
						artists: [],
						album: null,
						durationSec: null,
						isrc: null,
						trackNumber: null,
						sourceUrl: null,
						position: 0,
					},
					match: {
						state: "matched" as const,
						localTrackId: ids.a,
						candidates: [ids.a],
						confidence: "high" as const,
					},
					userResolved: true,
					skipped: false,
				},
				{
					key: "k2",
					external: {
						provider: "file" as const,
						externalId: "e2",
						title: "Ghost",
						artists: [],
						album: null,
						durationSec: null,
						isrc: null,
						trackNumber: null,
						sourceUrl: null,
						position: 1,
					},
					match: {
						state: "unmatched" as const,
						localTrackId: null,
						candidates: [],
						confidence: "none" as const,
					},
					userResolved: false,
					skipped: false,
				},
				{
					key: "k3",
					external: {
						provider: "file" as const,
						externalId: "e3",
						title: "C",
						artists: [],
						album: null,
						durationSec: null,
						isrc: null,
						trackNumber: null,
						sourceUrl: null,
						position: 2,
					},
					match: {
						state: "manual" as const,
						localTrackId: ids.c,
						candidates: [ids.c],
						confidence: "medium" as const,
					},
					userResolved: true,
					skipped: false,
				},
			],
		};
	}

	it("creates local playlists from sessions, skipping unresolved", async () => {
		await libraryService.initialize();
		const { added } = await libraryService.importPickedFiles([
			audioFile("ia.mp3"),
			audioFile("ib.mp3"),
			audioFile("ic.mp3"),
		]);
		const session = sessionFor({
			a: added[0] ?? "",
			b: added[1] ?? "",
			c: added[2] ?? "",
		});
		const pid = await libraryService.createPlaylistFromImport(session, "Mix");
		const playlist = useLibraryStore.getState().playlists[pid];
		// Order preserved, unmatched ghost never becomes a fake id.
		expect(playlist?.trackIds).toEqual([added[0], added[2]]);
		expect(playlist?.importedFrom).toMatchObject({
			provider: "file",
			externalId: "file:mix:abc123",
		});
		const sessions = await libraryService.listImportSessions();
		expect(sessions.find((s) => s.id === "import-1")?.localPlaylistId).toBe(
			pid,
		);
		await libraryService.dispose();
		// Sessions survive restart for re-import detection.
		resetStore();
		await libraryService.initialize();
		expect(
			(await libraryService.listImportSessions()).map((s) => s.externalId),
		).toContain("file:mix:abc123");
		await libraryService.dispose();
	});

	it("updates linked playlists, preserving user-added tracks", async () => {
		await libraryService.initialize();
		const { added } = await libraryService.importPickedFiles([
			audioFile("ua.mp3"),
			audioFile("ub.mp3"),
			audioFile("uc.mp3"),
			audioFile("ud.mp3"),
		]);
		const [a, b, c, d] = [
			added[0] ?? "",
			added[1] ?? "",
			added[2] ?? "",
			added[3] ?? "",
		];
		const session = sessionFor({ a, b, c });
		const pid = await libraryService.createPlaylistFromImport(session, "Mix");
		// User manually adds d to the playlist afterwards.
		await libraryService.addToPlaylist(pid, [d]);
		// Re-import drops a, keeps b/c: managed ids follow, d survives.
		const next = {
			...session,
			items: session.items.filter((i) => i.key !== "k1"),
			updatedAt: 5,
		};
		await libraryService.updatePlaylistFromImport(pid, next, [a, c]);
		expect(useLibraryStore.getState().playlists[pid]?.trackIds).toEqual([c, d]);
		await libraryService.dispose();
	});
});

describe("parseQueueState", () => {
	it("rejects malformed shapes", () => {
		expect(parseQueueState(null)).toBeNull();
		expect(parseQueueState([])).toBeNull();
		expect(parseQueueState({ version: 2, trackIds: [] })).toBeNull();
		expect(
			parseQueueState({
				version: 1,
				trackIds: ["a", 42],
				index: 0,
				repeat: "off",
				shuffle: false,
				crossfadeEnabled: false,
				crossfadeDuration: 3,
			}),
		).toBeNull();
		expect(
			parseQueueState({
				version: 1,
				trackIds: ["a"],
				index: 0,
				repeat: "sideways",
				shuffle: false,
				crossfadeEnabled: false,
				crossfadeDuration: 3,
			}),
		).toBeNull();
	});

	it("accepts a valid shape, ignoring unknown fields", () => {
		expect(
			parseQueueState({
				version: 1,
				trackIds: ["a", "b"],
				index: 5,
				repeat: "one",
				shuffle: true,
				crossfadeEnabled: true,
				crossfadeDuration: 4,
				future: "ignored",
			}),
		).toMatchObject({ trackIds: ["a", "b"], repeat: "one" });
	});

	it("round-trips the optional current-track anchor", () => {
		expect(
			parseQueueState({
				version: 1,
				trackIds: ["a", "b"],
				index: 0,
				currentTrackId: "b",
				repeat: "off",
				shuffle: false,
				crossfadeEnabled: false,
				crossfadeDuration: 3,
			}),
		).toMatchObject({ currentTrackId: "b" });
		// Missing or mistyped anchor degrades to positional restore.
		expect(
			parseQueueState({
				version: 1,
				trackIds: ["a"],
				index: 0,
				repeat: "off",
				shuffle: false,
				crossfadeEnabled: false,
				crossfadeDuration: 3,
			}),
		).toMatchObject({ trackIds: ["a"] });
		expect(
			parseQueueState({
				version: 1,
				trackIds: ["a"],
				index: 0,
				currentTrackId: 42,
				repeat: "off",
				shuffle: false,
				crossfadeEnabled: false,
				crossfadeDuration: 3,
			})?.currentTrackId,
		).toBeUndefined();
	});
});

describe("lyrics attachment", () => {
	it("attaches and persists lyrics on a track", async () => {
		await libraryService.initialize();
		const imported = await libraryService.importPickedFiles([
			audioFile("song.mp3"),
		]);
		const id = imported.added[0] ?? "";
		expect(
			await libraryService.attachLyrics(id, {
				plain: null,
				synced: [{ t: 1.5, text: "Hello" }],
				source: "lrc",
			}),
		).toBe(true);
		expect(useLibraryStore.getState().tracks[id]?.lyrics).toMatchObject({
			source: "lrc",
		});
		expect(
			await libraryService.attachLyrics("missing-id", {
				plain: "x",
				synced: null,
				source: "lrc",
			}),
		).toBe(false);
		await libraryService.dispose();
	}, 30000);
});

describe("cue sheets", () => {
	const CUE = [
		'FILE "album.flac" WAVE',
		'  TITLE "Album"',
		"  TRACK 01 AUDIO",
		'    TITLE "One"',
		"    INDEX 01 00:00:00",
		"  TRACK 02 AUDIO",
		'    TITLE "Two"',
		"    INDEX 01 04:00:00",
	].join("\n");

	it("creates virtual tracks sharing the parent bytes plus a playlist", async () => {
		await libraryService.initialize();
		const imported = await libraryService.importPickedFiles([
			audioFile("album.flac"),
		]);
		const parentId = imported.added[0] ?? "";
		const result = await libraryService.importCueSheet(CUE);
		expect(result?.trackIds).toHaveLength(2);
		expect(result?.warnings).toEqual([]);
		const tracks = useLibraryStore.getState().tracks;
		const first = tracks[result?.trackIds[0] ?? ""];
		const second = tracks[result?.trackIds[1] ?? ""];
		expect(first?.cue).toMatchObject({
			audioTrackId: parentId,
			startSec: 0,
			endSec: 240,
			cueTrackNumber: 1,
		});
		expect(first?.duration).toBe(240);
		expect(second?.cue?.endSec).toBeNull();
		expect(
			useLibraryStore.getState().playlists[result?.playlistId ?? ""],
		).toBeTruthy();
		// Virtual tracks resolve the parent's file (registered on import).
		await expect(
			libraryService.resolveFile(first?.id ?? ""),
		).resolves.toBeTruthy();
		// The file's own duration never overwrites the segment duration.
		await libraryService.updateDuration(first?.id ?? "", 9999);
		expect(useLibraryStore.getState().tracks[first?.id ?? ""]?.duration).toBe(
			240,
		);
		await libraryService.dispose();
	}, 30000);

	it("fails safe when the audio file is not in the library", async () => {
		await libraryService.initialize();
		await expect(libraryService.importCueSheet(CUE)).resolves.toBeNull();
		await expect(
			libraryService.importCueSheet("not a cue"),
		).resolves.toBeNull();
		await libraryService.dispose();
	}, 30000);
});

describe("device profile import", () => {
	it("validates, skips existing ids, and reports", async () => {
		await libraryService.initialize();
		const first = await libraryService.importDeviceProfiles([
			{ id: "p1", name: "One", dsp: null },
			{ name: "", dsp: null },
			"bogus",
			{ id: "p1", name: "Dupe" },
		]);
		expect(first.added).toBe(1);
		expect(first.skipped).toBe(1);
		expect(first.errors.length).toBeGreaterThan(0);
		expect(useLibraryStore.getState()).toBeTruthy();
		expect(
			(await import("../state/iem-store")).useIEMStore.getState().profiles["p1"]
				?.name,
		).toBe("One");
		const bad = await libraryService.importDeviceProfiles({ nope: true });
		expect(bad.added).toBe(0);
		expect(bad.errors.length).toBeGreaterThan(0);
		await libraryService.dispose();
	}, 30000);
});

describe("device dsp layers", () => {
	it("useDevice finds-or-creates a profile and applies its layer", async () => {
		await libraryService.initialize();
		const { useDspStore } = await import("../state/dsp-store");
		const { useIEMStore } = await import("../state/iem-store");
		useDspStore.getState().resetAll();
		useDspStore
			.getState()
			.setBass({ enabled: true, gainDb: 5, turnoverHz: 200 });

		const first = await libraryService.useDevice({
			manufacturer: "Acme",
			model: "X1",
			measurementId: null,
			targetId: null,
		});
		expect(first.created).toBe(true);
		// Fresh profile has no layer: legacy path (EQ off), no device set.
		expect(useDspStore.getState().activeDeviceId).toBeNull();

		// Capture the live bass boost into the profile, diverge, re-apply.
		expect(await libraryService.captureDeviceDsp(first.profileId)).toBe(true);
		expect(
			useIEMStore.getState().profiles[first.profileId]?.dsp?.bass.gainDb,
		).toBe(5);
		useDspStore.getState().resetAll();
		libraryService.selectProfile(first.profileId);
		expect(useDspStore.getState().bass.gainDb).toBe(5);
		expect(useDspStore.getState().activeDeviceName).toContain("Acme");

		// Second useDevice call reuses the profile (no duplicate).
		const second = await libraryService.useDevice({
			manufacturer: "acme",
			model: "x1",
			measurementId: null,
			targetId: null,
		});
		expect(second.created).toBe(false);
		expect(second.profileId).toBe(first.profileId);

		// Clearing the layer keeps the profile, drops the device binding.
		expect(await libraryService.clearProfileDsp(first.profileId)).toBe(true);
		expect(useIEMStore.getState().profiles[first.profileId]?.dsp).toBeNull();
		expect(useDspStore.getState().activeDeviceId).toBeNull();
		expect(await libraryService.clearProfileDsp("missing")).toBe(false);
		expect(await libraryService.captureDeviceDsp("missing")).toBe(false);
		await libraryService.dispose();
	}, 30000);
});
