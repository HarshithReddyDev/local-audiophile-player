/**
 * CloudMusicProvider — one adapter per cloud-storage vendor behind a
 * provider-neutral interface. The UI and the playback path branch on
 * ProviderCapabilities, never on provider identity.
 *
 * Transport (fetch) is injected per call context so adapters stay
 * testable with fixtures and the core never hard-depends on network
 * code. Every adapter speaks only documented public APIs (see
 * docs/cloud-music.md §provider audit) — no scraping, no private
 * endpoints.
 */

import {
	CloudError,
	type CloudErrorCode,
	type CloudProviderId,
	type ProviderCapabilities,
} from "./model";
import type { FetchImpl } from "./oauth";

/** One file or folder row from a provider listing. */
export interface CloudItem {
	/** Opaque provider id (folder ids drive navigation, file ids playback). */
	id: string;
	name: string;
	kind: "file" | "folder";
	mimeType: string | null;
	/** Bytes (null when the provider omits it). */
	size: number | null;
	/** Epoch ms (null when unknown). */
	modifiedTime: number | null;
	/** Revision/etag/cTag for change detection (null when none). */
	revision: string | null;
	/** Display breadcrumb segments from the provider (best effort). */
	path: string[] | null;
	/** Provider download-capability flag when the API exposes one. */
	canDownload: boolean | null;
}

/** A page of children (bounded; the UI paginates, never slurps). */
export interface CloudListing {
	items: CloudItem[];
	/** Opaque cursor for the next page (null when exhausted). */
	nextCursor: string | null;
}

/** Authenticated account identity from the provider. */
export interface CloudAccountInfo {
	/** Stable provider user/drive id (never email alone). */
	accountId: string;
	/** Display label (name or email). */
	accountLabel: string;
}

/**
 * Provider-neutral playable source. The existing PlaybackEngine consumes
 * the URL variant directly on its media element — no second engine, no
 * provider-specific players. Headers are never required of the element:
 * adapters must resolve to URLs the element can fetch alone.
 */
export interface ResolvedAudioSource {
	kind: "url";
	url: string;
	mimeType: string | null;
	/** Epoch ms when the URL stops working (0 = unknown/long-lived). */
	expiresAt: number;
	/** Documented range support (drives honest seek UI). */
	supportsRange: boolean;
	/**
	 * Resolve a fresh URL for the same file (expiry/refresh path).
	 * Null when the adapter cannot refresh without full re-auth.
	 */
	refresh: (() => Promise<ResolvedAudioSource>) | null;
}

export interface PlaybackContext {
	fetchImpl: FetchImpl;
}

/** Narrowest-workable permission request for one login. */
export interface ConnectOptions {
	/**
	 * Folder browsing needs broader scopes than picking. Drive defaults
	 * to per-file access; pass true only when the user explicitly asks
	 * to browse whole folders (documented restricted scope).
	 */
	broadAccess?: boolean | undefined;
	/** Persist the refresh token locally ("remember this connection"). */
	remember?: boolean | undefined;
}

export interface CloudMusicProvider {
	readonly id: CloudProviderId;
	readonly capabilities: ProviderCapabilities;
	/**
	 * True when connect() navigates away (PKCE redirect round-trip that
	 * completes in handleOAuthReturn after return). False/undefined for
	 * in-place flows (popup/token clients) that completeConnection()
	 * can finish immediately.
	 */
	readonly usesRedirectFlow?: boolean;
	/** Least-privilege scopes for the given mode (displayed before login). */
	scopesFor(options: ConnectOptions): string[];
	/** Scopes requested by the in-flight login (honest permission display). */
	getPendingScopes?(): string[];
	/** Begin OAuth login (redirects or opens the provider flow). */
	connect(options: ConnectOptions): Promise<void>;
	/** Finish an OAuth round-trip; returns the authenticated account. */
	completeConnection(fetchImpl: FetchImpl): Promise<CloudAccountInfo>;
	/** Authenticated account info, or null when logged out/expired. */
	getAccount(fetchImpl: FetchImpl): Promise<CloudAccountInfo | null>;
	/** Roots the UI can browse (My Drive, Recents, …). */
	listRoots(fetchImpl: FetchImpl): Promise<CloudItem[]>;
	/** One bounded page of a folder (cursor null = first page). */
	listChildren(
		folderId: string,
		cursor: string | null,
		fetchImpl: FetchImpl,
	): Promise<CloudListing>;
	/** Provider-side audio search (empty query = unsupported → null). */
	searchFiles(
		query: string,
		cursor: string | null,
		fetchImpl: FetchImpl,
	): Promise<CloudListing | null>;
	/** Fresh metadata for one file (refresh path, rename/move detection). */
	getMetadata(fileId: string, fetchImpl: FetchImpl): Promise<CloudItem | null>;
	/**
	 * Resolve a browser-playable source. Throws CloudError
	 * (STREAMING_UNSUPPORTED when the provider offers no compatible
	 * delivery — callers surface that instead of downloading).
	 */
	resolvePlaybackSource(
		fileId: string,
		context: PlaybackContext,
	): Promise<ResolvedAudioSource>;
	/** Forget tokens for this account (disconnect). */
	disconnect(): Promise<void>;
}

/** Map HTTP/API failures to CloudError without leaking payloads. */
export function mapHttpError(status: number, where: string): CloudError {
	let code: CloudErrorCode = "NETWORK_ERROR";
	let message = "Cloud provider temporarily unavailable.";
	if (status === 401 || status === 403) {
		code = "AUTH_REQUIRED";
		message = "Cloud authorization expired. Reconnect the source.";
	} else if (status === 404) {
		code = "NOT_FOUND";
		message = "File is no longer available in the cloud account.";
	} else if (status === 429) {
		code = "RATE_LIMITED";
		message = "Cloud provider is rate-limiting requests. Retry soon.";
	} else if (status >= 500) {
		code = "NETWORK_ERROR";
		message = "Cloud provider temporarily unavailable.";
	}
	const error = new CloudError(code, message);
	(error as { cause?: unknown }).cause = { status, where };
	return error;
}

export function toCloudError(error: unknown, where: string): CloudError {
	if (error instanceof CloudError) return error;
	return new CloudError("NETWORK_ERROR", `Cloud request failed (${where}).`);
}
