/**
 * Stable cloud identity without content hashes and without temporary URLs.
 *
 * Track identity = provider + account id + provider file id. Filenames,
 * paths, and playback URLs are explicitly excluded: renames keep history
 * (refresh updates the display path), and expiring URLs can never become
 * identity. Content revisions ride alongside for change detection, exactly
 * like mtime does for local files.
 */

import { fnv1aHex } from "../db/identity";
import type { CloudProviderId } from "./model";

/** Deterministic track id for a remote cloud file. */
export function cloudTrackId(
	provider: CloudProviderId,
	accountId: string,
	providerFileId: string,
): string {
	return `trk-${fnv1aHex(`cloud\n${provider}\n${accountId}\n${providerFileId}`)}`;
}

/**
 * Deterministic local id for a connected cloud account. Reconnecting the
 * same provider account restores the same id, so playlists, history,
 * favorites, and ratings reattach.
 */
export function cloudAccountId(
	provider: CloudProviderId,
	providerAccountId: string,
): string {
	return `cloud-${provider}-${fnv1aHex(`${provider}\n${providerAccountId}`)}`;
}

/** Deterministic library-source id for a cloud account connection. */
export function cloudSourceId(accountId: string): string {
	return `src-${accountId}`;
}
