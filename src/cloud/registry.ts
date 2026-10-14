/**
 * Provider registry + remote-source resolution dispatch.
 *
 * One instance per vendor. Tests inject doubles via registerCloudProvider;
 * production code never branches on provider identity — capabilities and
 * the CloudMusicProvider interface carry the variation.
 */

import type { Track } from "../types/library";
import { BOX_ID, BoxProvider } from "./box";
import { DRIVE_ID, GoogleDriveProvider } from "./drive";
import { DROPBOX_ID, DropboxProvider } from "./dropbox";
import type { CloudProviderId } from "./model";
import type { FetchImpl } from "./oauth";
import { ONEDRIVE_ID, OneDriveProvider } from "./onedrive";
import { type CloudMusicProvider, type ResolvedAudioSource } from "./providers";
import { getAccessToken } from "./token-store";

const providers = new Map<CloudProviderId, CloudMusicProvider>();

function builtins(): CloudMusicProvider[] {
	return [
		new GoogleDriveProvider(),
		new OneDriveProvider(),
		new DropboxProvider(),
		new BoxProvider(),
	];
}

for (const provider of builtins()) providers.set(provider.id, provider);

/** Test seam: override/add a provider (unit + E2E fixtures). */
export function registerCloudProvider(provider: CloudMusicProvider): void {
	providers.set(provider.id, provider);
}

export function resetCloudProviders(): void {
	providers.clear();
	for (const provider of builtins()) providers.set(provider.id, provider);
}

export function getCloudProvider(
	id: CloudProviderId,
): CloudMusicProvider | null {
	return providers.get(id) ?? null;
}

export function providerIds(): CloudProviderId[] {
	return [DRIVE_ID, ONEDRIVE_ID, DROPBOX_ID, BOX_ID];
}

/** Set the provider's active local account key (committed id). */
export function useProviderAccount(
	provider: CloudMusicProvider,
	accountKey: string | null,
): void {
	const anyProvider = provider as unknown as {
		setAccountKey?: (key: string | null) => void;
	};
	anyProvider.setAccountKey?.(accountKey);
}

export function hasLiveToken(accountKey: string): boolean {
	return getAccessToken(accountKey) !== null;
}

/**
 * Resolve a remote track to a browser-playable source. Returns null when
 * the track is local (caller uses the file path) or the provider is
 * unknown — never throws for dispatch problems (provider errors keep
 * their CloudError for status mapping upstream).
 */
export async function resolveRemoteSource(
	track: Track,
	fetchImpl: FetchImpl,
): Promise<ResolvedAudioSource | null> {
	if (!track.remote) return null;
	const provider = getCloudProvider(track.remote.provider);
	if (!provider) return null;
	useProviderAccount(provider, track.remote.accountId);
	return provider.resolvePlaybackSource(track.remote.providerFileId, {
		fetchImpl,
	});
}
