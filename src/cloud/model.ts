/**
 * Cloud music domain model: remote files the user owns in their own
 * cloud-storage accounts (NOT streaming-catalog audio). A remote cloud
 * track is never a local File object and never a manufactured fake —
 * it is metadata + remote identity + a playback reference that is
 * resolved fresh at play time.
 *
 * Three states stay explicit: LOCAL FILE (bytes on device) vs REMOTE
 * CLOUD FILE (bytes in the user's cloud account) vs IMPORTED METADATA
 * (playlist text only, see src/import).
 */

/** Cloud storage providers with a real adapter in this codebase. */
export type CloudProviderId = "google-drive" | "one-drive" | "dropbox" | "box";

export const CLOUD_PROVIDER_IDS: CloudProviderId[] = [
	"google-drive",
	"one-drive",
	"dropbox",
	"box",
];

export interface CloudProviderMeta {
	id: CloudProviderId;
	/** Short display name (text badges; no trademark logos shipped). */
	label: string;
	/** One-line description for the source picker. */
	description: string;
	/** Where the account lives (for honest "leaves the browser" copy). */
	accountHome: string;
}

/** Static, dependency-free provider metadata (no network, no secrets). */
export const CLOUD_PROVIDERS: CloudProviderMeta[] = [
	{
		id: "google-drive",
		label: "Google Drive",
		description: "Play music stored in your Google Drive.",
		accountHome: "drive.google.com",
	},
	{
		id: "one-drive",
		label: "OneDrive",
		description: "Play music stored in your OneDrive.",
		accountHome: "onedrive.live.com",
	},
	{
		id: "dropbox",
		label: "Dropbox",
		description: "Play music stored in your Dropbox.",
		accountHome: "dropbox.com",
	},
	{
		id: "box",
		label: "Box",
		description: "Play music stored in your Box account.",
		accountHome: "app.box.com",
	},
];

export function cloudProviderLabel(id: CloudProviderId): string {
	return CLOUD_PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

/**
 * What a provider can do, from verified behavior — never from the
 * provider's marketing. The UI branches on these flags, never on
 * `if (provider === "google")` chains.
 */
export interface ProviderCapabilities {
	/** List/browse the user's own folders and files. */
	folderBrowse: boolean;
	/** Server-side audio search. */
	metadataSearch: boolean;
	/** System file picker that grants per-file access (narrow scopes). */
	picker: boolean;
	/**
	 * Browser-playable media URL kind, or null when the provider offers no
	 * documented media-element-compatible delivery (then playback is
	 * reported STREAMING_UNSUPPORTED, never faked with full downloads).
	 */
	directMediaUrl:
		| "cookie-authenticated"
		| "pre-authenticated"
		| "temporary-link"
		| "scoped-token-url"
		| null;
	/** Temporary playback URLs expire and must be refreshed. */
	temporaryUrl: boolean;
	/** Byte-range retrieval documented (seek support). */
	rangeRequests: boolean;
	/** Remote artwork/thumbnails available. */
	artwork: boolean;
	/** Browser-safe OAuth without a client secret. */
	publicClientAuth: boolean;
	/** Account + file metadata usable offline once cached. */
	offlineMetadata: boolean;
}

/** Connection state of one cloud account. Tokens live elsewhere. */
export type CloudConnectionStatus =
	| "unconfigured"
	| "disconnected"
	| "connecting"
	| "connected"
	| "auth-required"
	| "error";

/**
 * Durable per-account record. Persisted (sources store): identity and
 * preferences only — never tokens, codes, verifiers, or playback URLs.
 */
export interface CloudAccount {
	/** Stable local id for this connection (see identity.ts). */
	id: string;
	provider: CloudProviderId;
	/** Provider-side user/drive id (never email alone). */
	accountId: string;
	/** Human label (name or email) for display. */
	accountLabel: string;
	status: CloudConnectionStatus;
	/** OAuth scopes granted, for honest permission display. */
	scopes: string[];
	connectedAt: number;
	lastSyncedAt: number | null;
	/** Last error message (cleared on success). Never raw API dumps. */
	lastError: string | null;
}

/**
 * Remote identity + metadata for one cloud track. Stored on Track.remote.
 * Display path is informational only — identity never uses it.
 */
export interface RemoteTrackRef {
	provider: CloudProviderId;
	/** Local cloud-account id (CloudAccount.id). */
	accountId: string;
	/** Opaque provider file id (Drive file id, Graph item id, …). */
	providerFileId: string;
	/**
	 * Provider revision/etag/cTag for change detection (like mtime for
	 * local files). Excluded from identity so in-place edits keep history.
	 */
	contentRevision: string | null;
	/** MIME type reported by the provider, may be empty. */
	mimeType: string | null;
	/** Display-only path/folder breadcrumb. Never identity. */
	providerPath: string | null;
}

/** Availability of one remote track right now (transient, never persisted). */
export type RemoteTrackStatus =
	| "available"
	| "auth-required"
	| "access-denied"
	| "not-found"
	| "unsupported-format"
	| "temp-url-expired"
	| "network-error"
	| "provider-rate-limit"
	| "streaming-unsupported";

/** Machine-readable provider failures; the UI maps these to sentences. */
export type CloudErrorCode =
	| "NOT_CONFIGURED"
	| "AUTH_REQUIRED"
	| "ACCESS_DENIED"
	| "NOT_FOUND"
	| "RATE_LIMITED"
	| "NETWORK_ERROR"
	| "UNSUPPORTED_FORMAT"
	| "STREAMING_UNSUPPORTED"
	| "TEMP_URL_EXPIRED"
	| "OAUTH_CANCELLED"
	| "OAUTH_STATE_MISMATCH"
	| "OAUTH_EXCHANGE_FAILED"
	| "PICKER_UNAVAILABLE";

export class CloudError extends Error {
	readonly code: CloudErrorCode;
	constructor(code: CloudErrorCode, message: string) {
		super(message);
		this.name = "CloudError";
		this.code = code;
	}
}

/**
 * User-facing sentences for remote-track states. Raw provider payloads
 * never reach the UI.
 */
export const REMOTE_STATUS_MESSAGE: Record<RemoteTrackStatus, string> = {
	available: "Available.",
	"auth-required": "Cloud authorization expired. Reconnect the source.",
	"access-denied": "File is no longer shared with this account.",
	"not-found": "File is no longer available in the cloud account.",
	"unsupported-format": "This audio format isn't supported by your browser.",
	"temp-url-expired": "Playback URL expired. Refreshing…",
	"network-error": "Cloud provider temporarily unavailable.",
	"provider-rate-limit":
		"Cloud provider is rate-limiting requests. Retry soon.",
	"streaming-unsupported":
		"Remote seeking isn't supported for this file/provider.",
};

export function statusForError(code: CloudErrorCode): RemoteTrackStatus {
	switch (code) {
		case "AUTH_REQUIRED":
			return "auth-required";
		case "ACCESS_DENIED":
			return "access-denied";
		case "NOT_FOUND":
			return "not-found";
		case "UNSUPPORTED_FORMAT":
			return "unsupported-format";
		case "TEMP_URL_EXPIRED":
			return "temp-url-expired";
		case "RATE_LIMITED":
			return "provider-rate-limit";
		case "STREAMING_UNSUPPORTED":
			return "streaming-unsupported";
		case "NETWORK_ERROR":
		case "OAUTH_EXCHANGE_FAILED":
			return "network-error";
		default:
			return "network-error";
	}
}
