/**
 * CloudService — orchestration between providers, the library, and the
 * cloud store. Mirrors LibraryService conventions: persist first, then
 * sync state; audio bytes are never fetched here (metadata only).
 *
 * Identity recap: provider account → local account id (cloudAccountId)
 * → library source (kind 'cloud') → remote tracks (cloudTrackId).
 * Reconnecting the same provider account restores the same ids, so
 * playlists, history, favorites, and ratings reattach by themselves.
 */

import { libraryService } from "../library/library-service";
import { useLibraryStore } from "../state/library-store";
import type { Track } from "../types/library";
import { makeTrack } from "../types/library";
import { browserFormatSupport, isAudioFile } from "./audio-formats";
import { useCloudStore } from "./cloud-store";
import { cloudAccountId, cloudSourceId, cloudTrackId } from "./identity";
import {
	type CloudAccount,
	CloudError,
	type CloudProviderId,
	cloudProviderLabel,
	type RemoteTrackStatus,
	statusForError,
} from "./model";
import { type FetchImpl, peekOAuthRoundTrip } from "./oauth";
import type {
	CloudAccountInfo,
	CloudItem,
	CloudListing,
	CloudMusicProvider,
	ConnectOptions,
} from "./providers";
import { getCloudProvider, useProviderAccount } from "./registry";
import { getClientId, rekeyTokens } from "./token-store";

export interface ConnectResult {
	/** Redirect flows leave the page; popup flows finish in place. */
	finished: boolean;
	accountId: string | null;
}

export interface ImportResult {
	added: string[];
	updated: string[];
	skippedUnsupported: number;
}

function displayPath(item: CloudItem): string {
	if (item.path && item.path.length > 0)
		return [...item.path, item.name].join("/");
	return item.name;
}

/** "Artist - Title" filename parsing (explicitly non-authoritative). */
export function parseFileName(name: string): {
	artist: string;
	title: string;
	trackNumber: number | null;
} {
	const stem = name.replace(/\.[^.]+$/, "").trim();
	const split = stem.split(" - ");
	let artist = "Unknown artist";
	let title = stem;
	if (split.length >= 2) {
		artist = (split[0] ?? "").trim() || "Unknown artist";
		title = split.slice(1).join(" - ").trim() || stem;
	}
	let trackNumber: number | null = null;
	const numbered = /^(\d{1,3})[.\-_ ]+(.+)$/.exec(title);
	if (numbered?.[1] && numbered[2]) {
		trackNumber = Number(numbered[1]);
		title = numbered[2].trim();
	}
	return { artist, title, trackNumber };
}

export function remoteTrackFor(
	provider: CloudProviderId,
	accountLocalId: string,
	sourceId: string,
	item: CloudItem,
	known?: Track,
): Track | null {
	if (item.kind !== "file") return null;
	const now = Date.now();
	const { artist, title, trackNumber } = parseFileName(item.name);
	return makeTrack({
		id: cloudTrackId(provider, accountLocalId, item.id),
		title,
		artist,
		trackNumber,
		fileName: item.name,
		fileType: item.mimeType ?? "",
		fileSize: item.size ?? 0,
		mtime: item.modifiedTime ?? 0,
		sourceId,
		path: displayPath(item),
		artworkId: null,
		addedAt: known?.addedAt ?? now,
		updatedAt: now,
		missing: false,
		duration: known?.duration ?? null,
		remote: {
			provider,
			accountId: accountLocalId,
			providerFileId: item.id,
			contentRevision: item.revision,
			mimeType: item.mimeType,
			providerPath: displayPath(item),
		},
	});
}

class CloudService {
	private fetchImpl: FetchImpl = (input, init) => fetch(input, init);

	/** Test seam: inject a fixture transport for all provider calls. */
	setFetchForTests(fetchImpl: FetchImpl | null): void {
		this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
	}

	provider(id: CloudProviderId): CloudMusicProvider {
		const provider = getCloudProvider(id);
		if (!provider) throw new CloudError("NETWORK_ERROR", "Unknown provider.");
		return provider;
	}

	/** Whether Connect can proceed (a user-supplied OAuth client id exists). */
	isConfigured(providerId: CloudProviderId): boolean {
		return getClientId(providerId) !== null;
	}

	scopesPreview(
		providerId: CloudProviderId,
		options: ConnectOptions,
	): string[] {
		return this.provider(providerId).scopesFor(options);
	}

	// -- connection ----------------------------------------------------

	async connect(
		providerId: CloudProviderId,
		options: ConnectOptions,
	): Promise<ConnectResult> {
		const provider = this.provider(providerId);
		// Throws NOT_CONFIGURED when no client id — the UI shows setup.
		await provider.connect(options);
		if (provider.usesRedirectFlow) {
			// The page unloads into the provider now; completion happens
			// in handleOAuthReturn after the provider sends the browser
			// back. Never touch the round-trip here (it belongs to the
			// returning page load).
			return { finished: false, accountId: null };
		}
		// In-place flows (popup/token clients) finish immediately.
		try {
			const info = await provider.completeConnection(this.fetchImpl);
			const accountId = await this.commit(
				provider,
				info,
				provider.getPendingScopes?.() ?? [],
			);
			return { finished: true, accountId };
		} catch (error) {
			if (error instanceof CloudError && error.code === "OAUTH_CANCELLED") {
				// User closed the popup with no pending round-trip.
				return { finished: false, accountId: null };
			}
			throw error;
		}
	}

	/**
	 * Commit a fresh login: stable ids, mirrored records, ready status.
	 * Reconnecting the same provider account restores the same local ids.
	 */
	async commit(
		provider: CloudMusicProvider,
		info: CloudAccountInfo,
		scopes: string[],
	): Promise<string> {
		const localId = cloudAccountId(provider.id, info.accountId);
		rekeyTokens(pendingKeyFor(provider.id), localId);
		useProviderAccount(provider, localId);
		const now = Date.now();
		const previous = useCloudStore.getState().accounts[localId];
		const account: CloudAccount = {
			id: localId,
			provider: provider.id,
			accountId: info.accountId,
			accountLabel: info.accountLabel,
			status: "connected",
			scopes,
			connectedAt: previous?.connectedAt ?? now,
			lastSyncedAt: previous?.lastSyncedAt ?? null,
			lastError: null,
		};
		useCloudStore.getState().upsertAccount(account);
		const sourceId = cloudSourceId(localId);
		const existing = useLibraryStore.getState().sources[sourceId];
		await libraryService.upsertSourceRecord({
			id: sourceId,
			kind: "cloud",
			name: `${cloudProviderLabel(provider.id)} — ${info.accountLabel}`,
			handle: null,
			addedAt: existing?.addedAt ?? now,
			lastValidatedAt: now,
			cloud: {
				provider: provider.id,
				accountId: localId,
				accountLabel: info.accountLabel,
			},
		});
		useLibraryStore.getState().setSourceStatus(sourceId, "ready");
		// Tracks already referencing this account become reachable again.
		await libraryService.markSourceTracks(sourceId, false);
		return localId;
	}

	/** Boot: finish a redirect-flow OAuth return (?oauth=callback). */
	async handleOAuthReturn(url: string): Promise<CloudAccountInfo | null> {
		const parsed = new URL(url);
		if (parsed.searchParams.get("oauth") !== "callback") return null;
		const roundTrip = peekOAuthRoundTrip();
		if (!roundTrip) {
			cleanOAuthUrl();
			return null;
		}
		// Route to the provider owning this pending key.
		const { providerIds } = await import("./registry");
		for (const id of providerIds()) {
			if (pendingKeyFor(id) !== roundTrip.accountKey) continue;
			const provider = this.provider(id);
			try {
				const info = await provider.completeConnection(this.fetchImpl);
				const scopes =
					typeof provider.getPendingScopes === "function"
						? provider.getPendingScopes()
						: [];
				await this.commit(provider, info, scopes);
				cleanOAuthUrl();
				return info;
			} catch (error) {
				cleanOAuthUrl();
				throw error;
			}
		}
		cleanOAuthUrl();
		return null;
	}

	async disconnect(accountLocalId: string): Promise<void> {
		const account = useCloudStore.getState().accounts[accountLocalId];
		if (!account) return;
		const provider = this.provider(account.provider);
		useProviderAccount(provider, accountLocalId);
		try {
			await provider.disconnect();
		} finally {
			const sourceId = cloudSourceId(accountLocalId);
			// Auth cleared, tracks marked unreachable — records, playlists,
			// history, favorites, and ratings all preserved.
			await libraryService.markSourceTracks(sourceId, true);
			useLibraryStore.getState().setSourceStatus(sourceId, "auth-required");
			useCloudStore.getState().setStatus(accountLocalId, "disconnected");
			useCloudStore.getState().clearTrackStatuses(accountLocalId);
		}
	}

	/**
	 * Remove a cloud source (tracks stay as unavailable references —
	 * playlists and history keep working; reconnect restores them).
	 */
	async removeSource(accountLocalId: string): Promise<void> {
		const account = useCloudStore.getState().accounts[accountLocalId];
		await this.disconnect(accountLocalId);
		await libraryService.deleteSourceRecord(cloudSourceId(accountLocalId));
		if (account) useCloudStore.getState().removeAccount(accountLocalId);
	}

	// -- browsing -------------------------------------------------------

	private withAccount(accountLocalId: string): {
		provider: CloudMusicProvider;
		account: CloudAccount;
	} {
		const account = useCloudStore.getState().accounts[accountLocalId];
		if (!account) {
			throw new CloudError("NOT_FOUND", "Cloud source is no longer connected.");
		}
		const provider = this.provider(account.provider);
		useProviderAccount(provider, accountLocalId);
		return { provider, account };
	}

	async listRoots(accountLocalId: string): Promise<CloudItem[]> {
		const { provider } = this.withAccount(accountLocalId);
		try {
			return await provider.listRoots(this.fetchImpl);
		} catch (error) {
			throw toServiceError(error);
		}
	}

	async listChildren(
		accountLocalId: string,
		folderId: string,
		cursor: string | null,
	): Promise<CloudListing> {
		const { provider } = this.withAccount(accountLocalId);
		try {
			return await provider.listChildren(folderId, cursor, this.fetchImpl);
		} catch (error) {
			throw toServiceError(error);
		}
	}

	async searchRemote(
		accountLocalId: string,
		query: string,
		cursor: string | null,
	): Promise<CloudListing | null> {
		const { provider } = this.withAccount(accountLocalId);
		try {
			return await provider.searchFiles(query, cursor, this.fetchImpl);
		} catch (error) {
			throw toServiceError(error);
		}
	}

	// -- import (metadata only — audio bytes are never fetched) ----------

	/**
	 * Add remote files to the library as metadata references. Never
	 * downloads audio: a 100 MB cloud FLAC stores ~200 bytes of JSON.
	 */
	async importRemoteItems(
		accountLocalId: string,
		items: CloudItem[],
	): Promise<ImportResult> {
		const account = useCloudStore.getState().accounts[accountLocalId];
		if (!account) {
			throw new CloudError("NOT_FOUND", "Cloud source is no longer connected.");
		}
		const sourceId = cloudSourceId(accountLocalId);
		const existing = useLibraryStore.getState().tracks;
		const records: Track[] = [];
		const result: ImportResult = {
			added: [],
			updated: [],
			skippedUnsupported: 0,
		};
		const now = Date.now();
		for (const item of items.slice(0, 5000)) {
			if (item.kind !== "file") continue;
			const support = browserFormatSupport(item.name, item.mimeType);
			if (support === "unsupported") {
				result.skippedUnsupported += 1;
				continue;
			}
			const id = cloudTrackId(account.provider, accountLocalId, item.id);
			const known = existing[id];
			const track = remoteTrackFor(
				account.provider,
				accountLocalId,
				sourceId,
				item,
				known,
			);
			if (!track) continue;
			if (known) {
				records.push({
					...track,
					addedAt: known.addedAt,
					duration: known.duration ?? track.duration,
					updatedAt: now,
				});
				result.updated.push(id);
			} else {
				records.push(track);
				result.added.push(id);
			}
		}
		await libraryService.saveRemoteTracks(records);
		return result;
	}

	/**
	 * Recursively collect audio files under a folder (bounded, paged,
	 * cancellable). Yields to the UI between pages; aborts cleanly.
	 */
	async collectFolderAudio(
		accountLocalId: string,
		folderId: string,
		folderName: string,
		onProgress: (collected: number) => void,
		signal?: AbortSignal,
		maxFiles = 5000,
	): Promise<{ items: CloudItem[]; truncated: boolean }> {
		const { provider } = this.withAccount(accountLocalId);
		const items: CloudItem[] = [];
		const folders: { id: string; name: string }[] = [
			{ id: folderId, name: folderName },
		];
		let truncated = false;
		while (folders.length > 0) {
			if (signal?.aborted) break;
			if (items.length >= maxFiles) {
				truncated = true;
				break;
			}
			const folder = folders.shift();
			if (!folder) break;
			let cursor: string | null = null;
			do {
				if (signal?.aborted) break;
				let listing: CloudListing;
				try {
					listing = await provider.listChildren(
						folder.id,
						cursor,
						this.fetchImpl,
					);
				} catch (error) {
					throw toServiceError(error);
				}
				for (const entry of listing.items) {
					if (entry.kind === "folder") {
						folders.push({ id: entry.id, name: entry.name });
					} else if (isAudioFile(entry.name, entry.mimeType)) {
						items.push(entry);
						if (items.length % 50 === 0) onProgress(items.length);
						if (items.length >= maxFiles) {
							truncated = true;
							break;
						}
					}
				}
				cursor = listing.nextCursor;
				await yieldToUI();
			} while (cursor && !signal?.aborted && !truncated);
		}
		onProgress(items.length);
		return { items, truncated };
	}

	// -- refresh (revalidate known files; transient failures ≠ deletion) -

	async refreshSource(
		accountLocalId: string,
		onProgress: (processed: number, total: number) => void,
		signal?: AbortSignal,
	): Promise<{ checked: number; updated: number; missing: number }> {
		const { provider, account } = this.withAccount(accountLocalId);
		const sourceId = cloudSourceId(accountLocalId);
		const tracks = Object.values(useLibraryStore.getState().tracks).filter(
			(t) => t.sourceId === sourceId && t.remote,
		);
		const total = tracks.length;
		let processed = 0;
		let updated = 0;
		let missing = 0;
		const changed: Track[] = [];
		const now = Date.now();
		// Bounded parallelism: 6 in flight, UI yields between batches.
		for (let i = 0; i < tracks.length; i += 6) {
			if (signal?.aborted) break;
			const batch = tracks.slice(i, i + 6);
			const results = await Promise.all(
				batch.map(async (track) => {
					try {
						return await provider.getMetadata(
							track.remote?.providerFileId ?? "",
							this.fetchImpl,
						);
					} catch {
						// Transient failure: keep the record, try next refresh.
						return "transient" as const;
					}
				}),
			);
			for (let b = 0; b < batch.length; b++) {
				const track = batch[b];
				const meta = results[b];
				processed += 1;
				if (!track?.remote) continue;
				const remote = track.remote;
				if (meta === "transient" || meta === undefined) continue;
				if (meta === null) {
					if (!track.missing) {
						changed.push({ ...track, missing: true, updatedAt: now });
						missing += 1;
					}
					continue;
				}
				const revisionChanged =
					meta.revision !== null &&
					remote.contentRevision !== null &&
					meta.revision !== remote.contentRevision;
				const path = displayPath(meta);
				if (revisionChanged || path !== track.path || track.missing) {
					changed.push({
						...track,
						path,
						fileName: meta.name,
						fileSize: meta.size ?? track.fileSize,
						mtime: meta.modifiedTime ?? track.mtime,
						missing: false,
						updatedAt: now,
						remote: {
							...remote,
							contentRevision: meta.revision,
							mimeType: meta.mimeType,
							providerPath: path,
						},
					});
					updated += 1;
				}
			}
			onProgress(processed, total);
			await yieldToUI();
		}
		if (changed.length > 0) await libraryService.saveRemoteTracks(changed);
		useCloudStore.getState().upsertAccount({
			...account,
			status: "connected",
			lastSyncedAt: now,
			lastError: null,
		});
		useLibraryStore.getState().setSourceStatus(sourceId, "ready");
		return { checked: processed, updated, missing };
	}

	// -- playback resolution ----------------------------------------------

	/**
	 * Resolve a remote track for the engine. Maps provider failures to
	 * transient track statuses for honest UI (never deletes records).
	 */
	async resolveRemotePlayable(track: Track): Promise<{
		url: string;
		mimeType: string | null;
		expiresAt: number;
		supportsRange: boolean;
		refresh: (() => Promise<{ url: string }>) | null;
	} | null> {
		if (!track.remote) return null;
		const support = browserFormatSupport(track.fileName, track.remote.mimeType);
		if (support === "unsupported") {
			this.setTrackStatus(track.id, "unsupported-format");
			throw new CloudError(
				"UNSUPPORTED_FORMAT",
				"This audio format isn't supported by your browser.",
			);
		}
		const provider = this.provider(track.remote.provider);
		useProviderAccount(provider, track.remote.accountId);
		try {
			const resolved = await provider.resolvePlaybackSource(
				track.remote.providerFileId,
				{ fetchImpl: this.fetchImpl },
			);
			this.setTrackStatus(track.id, "available");
			return resolved;
		} catch (error) {
			const code = error instanceof CloudError ? error.code : "NETWORK_ERROR";
			this.setTrackStatus(track.id, statusForError(code));
			if (code === "AUTH_REQUIRED") {
				useLibraryStore
					.getState()
					.setSourceStatus(
						cloudSourceId(track.remote.accountId),
						"auth-required",
					);
			}
			throw error;
		}
	}

	setTrackStatus(trackId: string, status: RemoteTrackStatus): void {
		useCloudStore.getState().setTrackStatus(trackId, status);
	}
}

function pendingKeyFor(providerId: CloudProviderId): string {
	return `${providerId}:pending`;
}

function toServiceError(error: unknown): CloudError {
	if (error instanceof CloudError) return error;
	return new CloudError(
		"NETWORK_ERROR",
		"Cloud provider temporarily unavailable.",
	);
}

function cleanOAuthUrl(): void {
	try {
		const url = new URL(window.location.href);
		url.searchParams.delete("code");
		url.searchParams.delete("state");
		url.searchParams.delete("error");
		url.searchParams.delete("oauth");
		window.history.replaceState(null, "", url.toString());
	} catch {
		// URL cleanup is cosmetic; the flow already completed or failed.
	}
}

function yieldToUI(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

export const cloudService = new CloudService();
