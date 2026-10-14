import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { destroyLibraryDatabase } from "../db/database";
import { libraryService } from "../library/library-service";
import { useLibraryStore } from "../state/library-store";
import { cloudService, parseFileName, remoteTrackFor } from "./cloud-service";
import { useCloudStore } from "./cloud-store";
import { cloudAccountId, cloudSourceId, cloudTrackId } from "./identity";
import { CloudError, type CloudProviderId } from "./model";
import type {
	CloudAccountInfo,
	CloudItem,
	CloudMusicProvider,
	ConnectOptions,
	PlaybackContext,
	ResolvedAudioSource,
} from "./providers";
import { registerCloudProvider, resetCloudProviders } from "./registry";

/** Controllable test-double provider (no network, no OAuth). */
class FixtureProvider implements CloudMusicProvider {
	readonly id: CloudProviderId = "one-drive";
	readonly capabilities = {
		folderBrowse: true,
		metadataSearch: true,
		picker: false,
		directMediaUrl: "pre-authenticated" as const,
		temporaryUrl: true,
		rangeRequests: true,
		artwork: false,
		publicClientAuth: true,
		offlineMetadata: true,
	};
	account: CloudAccountInfo = { accountId: "u1", accountLabel: "Ada" };
	files = new Map<string, CloudItem>();
	playable: ((fileId: string) => ResolvedAudioSource) | null = null;
	failWith: CloudError | null = null;

	scopesFor(_options: ConnectOptions): string[] {
		return ["Files.Read"];
	}
	async connect(_options: ConnectOptions): Promise<void> {}
	async completeConnection(): Promise<CloudAccountInfo> {
		return this.account;
	}
	async getAccount(): Promise<CloudAccountInfo | null> {
		return this.account;
	}
	async listRoots(): Promise<CloudItem[]> {
		return [
			{
				id: "root",
				name: "OneDrive",
				kind: "folder",
				mimeType: null,
				size: null,
				modifiedTime: null,
				revision: null,
				path: null,
				canDownload: null,
			},
		];
	}
	async listChildren(folderId: string) {
		if (this.failWith) throw this.failWith;
		return {
			items: [...this.files.values()].filter((f) =>
				folderId === "root" ? true : f.path?.includes(folderId),
			),
			nextCursor: null,
		};
	}
	async searchFiles() {
		return null;
	}
	async getMetadata(fileId: string) {
		return this.files.get(fileId) ?? null;
	}
	async resolvePlaybackSource(
		fileId: string,
		_context: PlaybackContext,
	): Promise<ResolvedAudioSource> {
		if (this.failWith) throw this.failWith;
		if (this.playable) return this.playable(fileId);
		const file = this.files.get(fileId);
		if (!file) throw new CloudError("NOT_FOUND", "gone");
		return {
			kind: "url",
			url: `https://cloud.example/${fileId}.mp3`,
			mimeType: "audio/mpeg",
			expiresAt: Date.now() + 60_000,
			supportsRange: true,
			refresh: null,
		};
	}
	async disconnect(): Promise<void> {}
}

function audioItem(
	over: Partial<CloudItem> & { id: string; name: string },
): CloudItem {
	return {
		kind: "file",
		mimeType: "audio/mpeg",
		size: 100 * 1024 * 1024,
		modifiedTime: 1700000000000,
		revision: "r1",
		path: ["Music"],
		canDownload: true,
		...over,
	};
}

let fixture: FixtureProvider;

function resetAll(): void {
	useLibraryStore.getState().clearLibrary();
	useLibraryStore.setState({ sources: {}, sourceStatuses: {} });
	useCloudStore.getState().resetForTests();
	resetCloudProviders();
	fixture = new FixtureProvider();
	registerCloudProvider(fixture);
	cloudService.setFetchForTests(async () => {
		throw new Error("import must never fetch media");
	});
}

afterEach(async () => {
	cloudService.setFetchForTests(null);
	resetCloudProviders();
	await libraryService.dispose();
	useLibraryStore.getState().clearLibrary();
	useLibraryStore.setState({ sources: {}, sourceStatuses: {} });
	useCloudStore.getState().resetForTests();
	await destroyLibraryDatabase("iem-player-library");
});

describe("filename metadata (non-authoritative)", () => {
	it("splits artist - title and track numbers", () => {
		expect(parseFileName("Miles Davis - So What.flac")).toEqual({
			artist: "Miles Davis",
			title: "So What",
			trackNumber: null,
		});
		expect(parseFileName("02 So What.flac")).toMatchObject({
			title: "So What",
			trackNumber: 2,
		});
		expect(parseFileName("untitled.mp3")).toMatchObject({
			artist: "Unknown artist",
			title: "untitled",
		});
	});
});

describe("remote track records", () => {
	it("builds stable metadata-only records", () => {
		const track = remoteTrackFor(
			"one-drive",
			"acct1",
			"src1",
			audioItem({ id: "f1", name: "Miles Davis - So What.flac" }),
		);
		expect(track?.id).toBe(cloudTrackId("one-drive", "acct1", "f1"));
		expect(track).toMatchObject({
			title: "So What",
			artist: "Miles Davis",
			sourceId: "src1",
			remote: {
				provider: "one-drive",
				accountId: "acct1",
				providerFileId: "f1",
				contentRevision: "r1",
			},
		});
		expect(
			remoteTrackFor("one-drive", "acct1", "src1", {
				id: "d",
				name: "Music",
				kind: "folder",
				mimeType: null,
				size: null,
				modifiedTime: null,
				revision: null,
				path: null,
				canDownload: null,
			}),
		).toBeNull();
	});
});

describe("cloud library integration", () => {
	it("imports remote files as metadata without fetching audio", async () => {
		resetAll();
		await libraryService.initialize();
		const localId = await cloudService.commit(
			fixture,
			{ accountId: "u1", accountLabel: "Ada" },
			[],
		);
		const accountId = cloudAccountId("one-drive", "u1");
		expect(localId).toBe(accountId);
		const sourceId = cloudSourceId(accountId);
		const result = await cloudService.importRemoteItems(accountId, [
			audioItem({ id: "f1", name: "Miles Davis - So What.flac" }),
			audioItem({ id: "f2", name: "notes.txt", mimeType: "text/plain" }),
		]);
		// notes.txt is honestly skipped (unsupported format); the FLAC
		// imports as a metadata reference.
		expect(result.added).toHaveLength(1);
		expect(result.skippedUnsupported).toBe(1);
		const tracks = useLibraryStore.getState().tracks;
		expect(Object.keys(tracks)).toHaveLength(1);
		// No bytes anywhere: no File registered, no blob, ~200 bytes.
		for (const id of result.added) {
			expect(useLibraryStore.getState().getFile(id)).toBeUndefined();
		}
		const persisted = await libraryService.repo.getAllTracks();
		expect(persisted).toHaveLength(1);
		const jsonBytes = JSON.stringify(persisted).length;
		expect(jsonBytes).toBeLessThan(5000);
		// …for a claimed 100 MB of remote audio.
		expect(
			persisted.reduce((n, t) => n + t.fileSize, 0),
		).toBeGreaterThanOrEqual(100 * 1024 * 1024);
		// Re-import updates instead of duplicating.
		const again = await cloudService.importRemoteItems(accountId, [
			audioItem({ id: "f1", name: "Miles Davis - So What.flac" }),
		]);
		expect(again.added).toHaveLength(0);
		expect(again.updated).toHaveLength(1);
		expect(sourceId).toContain("one-drive");
	});

	it("commit is stable: reconnect restores the same ids", async () => {
		resetAll();
		await libraryService.initialize();
		const provider = fixture;
		const localId = await cloudService.commit(
			provider,
			{ accountId: "u1", accountLabel: "Ada" },
			["Files.Read"],
		);
		expect(localId).toBe(cloudAccountId("one-drive", "u1"));
		await cloudService.importRemoteItems(localId, [
			audioItem({ id: "f1", name: "A - B.mp3" }),
		]);
		const playlist = await libraryService.createPlaylist("Mix", [
			cloudTrackId("one-drive", localId, "f1"),
		]);
		await libraryService.toggleFavorite(
			cloudTrackId("one-drive", localId, "f1"),
		);

		// Disconnect: records stay, tracks flagged, playlist intact.
		await cloudService.disconnect(localId);
		const after = useLibraryStore.getState();
		expect(
			after.tracks[cloudTrackId("one-drive", localId, "f1")]?.missing,
		).toBe(true);
		expect(after.playlists[playlist]?.trackIds).toHaveLength(1);
		expect(after.favorites).toHaveLength(1);

		// Reconnect the same provider account: identical ids reattach.
		const localId2 = await cloudService.commit(
			provider,
			{ accountId: "u1", accountLabel: "Ada" },
			["Files.Read"],
		);
		expect(localId2).toBe(localId);
		expect(
			useLibraryStore.getState().tracks[
				cloudTrackId("one-drive", localId, "f1")
			]?.missing,
		).toBe(false);
		expect(
			useLibraryStore.getState().playlists[playlist]?.trackIds,
		).toHaveLength(1);
	});

	it("removing the source keeps playlists and history references", async () => {
		resetAll();
		await libraryService.initialize();
		const localId = await cloudService.commit(
			fixture,
			{ accountId: "u1", accountLabel: "Ada" },
			[],
		);
		await cloudService.importRemoteItems(localId, [
			audioItem({ id: "f1", name: "A - B.mp3" }),
		]);
		const trackId = cloudTrackId("one-drive", localId, "f1");
		const playlist = await libraryService.createPlaylist("Mix", [trackId]);
		await cloudService.removeSource(localId);
		expect(
			useLibraryStore.getState().sources[cloudSourceId(localId)],
		).toBeUndefined();
		// Track reference survives (unavailable), playlist untouched.
		expect(useLibraryStore.getState().tracks[trackId]?.missing).toBe(true);
		expect(useLibraryStore.getState().playlists[playlist]?.trackIds).toEqual([
			trackId,
		]);
	});

	it("maps playback failures to transient statuses, never deletes", async () => {
		resetAll();
		await libraryService.initialize();
		const localId = await cloudService.commit(
			fixture,
			{ accountId: "u1", accountLabel: "Ada" },
			[],
		);
		await cloudService.importRemoteItems(localId, [
			audioItem({ id: "f1", name: "A - B.mp3" }),
		]);
		fixture.files.set("f1", audioItem({ id: "f1", name: "A - B.mp3" }));
		const trackId = cloudTrackId("one-drive", localId, "f1");
		const track = useLibraryStore.getState().tracks[trackId];
		if (!track) throw new Error("missing fixture track");

		const ok = await cloudService.resolveRemotePlayable(track);
		expect(ok?.url).toContain("https://cloud.example/f1.mp3");

		fixture.failWith = new CloudError("AUTH_REQUIRED", "expired");
		await expect(
			cloudService.resolveRemotePlayable(track),
		).rejects.toMatchObject({
			code: "AUTH_REQUIRED",
		});
		expect(useCloudStore.getState().trackStatuses[trackId]).toBe(
			"auth-required",
		);
		// Record still here for the next attempt.
		expect(useLibraryStore.getState().tracks[trackId]).toBeTruthy();
		fixture.failWith = null;
	});
});
