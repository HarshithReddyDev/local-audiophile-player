/**
 * Dropbox adapter (Dropbox API v2, PKCE public-client flow).
 *
 * Documented behavior used here (see docs/cloud-music.md):
 * - OAuth2 authorization-code flow with PKCE (no client secret for
 *   public clients); `token_access_type=offline` issues a refresh token
 *   only when the user opts into "remember this connection".
 * - `files/list_folder` (+ `list_folder/continue`) for bounded folder
 *   paging; `files/search_v2` for name search; `users/get_current_account`
 *   for the stable account id.
 * - `files/get_temporary_link` returns a short-lived (~4h) streaming
 *   link: the media element consumes it directly, it is never persisted,
 *   and it is refreshed on expiry.
 * - Minimal scopes: account_info.read + files.metadata.read +
 *   files.content.read (read-only; nothing requested beyond that).
 */

import { isAudioFile } from "./audio-formats";
import {
	CloudError,
	type CloudProviderId,
	type ProviderCapabilities,
} from "./model";
import {
	defaultRedirectUri,
	exchangeCode,
	type FetchImpl,
	type OAuthConfig,
	parseOAuthCallback,
	refreshAccessToken,
	startOAuth,
	takeOAuthRoundTrip,
} from "./oauth";
import {
	type CloudAccountInfo,
	type CloudItem,
	type CloudListing,
	type CloudMusicProvider,
	type ConnectOptions,
	mapHttpError,
	type PlaybackContext,
	type ResolvedAudioSource,
	toCloudError,
} from "./providers";
import {
	clearTokens,
	getAccessToken,
	getClientId,
	getRefreshToken,
	rekeyTokens,
	storeAccessToken,
	storeRefreshToken,
} from "./token-store";

export const DROPBOX_ID: CloudProviderId = "dropbox";

const AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const API = "https://api.dropboxapi.com/2";

export const DROPBOX_SCOPES = [
	"account_info.read",
	"files.metadata.read",
	"files.content.read",
];

/** Temporary links live ~4h; refresh well inside that window. */
const TEMP_LINK_TTL_MS = 3 * 60 * 60 * 1000;

const PENDING_KEY = "dropbox:pending";

interface DbxEntry {
	".tag": "file" | "folder" | string;
	id?: string;
	name?: string;
	path_display?: string;
	size?: number;
	client_modified?: string;
	server_modified?: string;
	rev?: string;
}

function toItem(entry: DbxEntry): CloudItem | null {
	if (!entry.name) return null;
	if (entry[".tag"] === "folder") {
		return {
			id: entry.id ?? entry.path_display ?? entry.name,
			name: entry.name,
			kind: "folder",
			mimeType: null,
			size: null,
			modifiedTime: null,
			revision: null,
			path: null,
			canDownload: null,
		};
	}
	if (entry[".tag"] !== "file" || !entry.id) return null;
	return {
		id: entry.id,
		name: entry.name,
		kind: "file",
		mimeType: null,
		size: entry.size ?? null,
		modifiedTime: entry.server_modified
			? Date.parse(entry.server_modified)
			: null,
		revision: entry.rev ?? null,
		path: entry.path_display ? [entry.path_display] : null,
		canDownload: true,
	};
}

export class DropboxProvider implements CloudMusicProvider {
	readonly id: CloudProviderId = DROPBOX_ID;
	readonly usesRedirectFlow = true;
	readonly capabilities: ProviderCapabilities = {
		folderBrowse: true,
		metadataSearch: true,
		picker: false,
		directMediaUrl: "temporary-link",
		temporaryUrl: true,
		rangeRequests: true,
		artwork: false,
		publicClientAuth: true,
		offlineMetadata: true,
	};

	private fetchImpl: FetchImpl;
	private navigate: (url: string) => void;
	private accountKey: string | null = null;
	private remember = false;

	constructor(options?: {
		fetchImpl?: FetchImpl;
		navigate?: (url: string) => void;
	}) {
		this.fetchImpl =
			options?.fetchImpl ?? ((input, init) => fetch(input, init));
		this.navigate =
			options?.navigate ??
			((url) => {
				window.location.assign(url);
			});
	}

	scopesFor(_options: ConnectOptions): string[] {
		return [...DROPBOX_SCOPES];
	}

	setAccountKey(key: string | null): void {
		this.accountKey = key;
	}

	getAccountKey(): string | null {
		return this.accountKey;
	}

	private oauthConfig(remember: boolean): OAuthConfig {
		const clientId = getClientId(DROPBOX_ID);
		if (!clientId) {
			throw new CloudError(
				"NOT_CONFIGURED",
				"Add your Dropbox app key first (settings explain how).",
			);
		}
		return {
			authorizeUrl: AUTHORIZE_URL,
			tokenUrl: TOKEN_URL,
			clientId,
			redirectUri: defaultRedirectUri(),
			scopes: DROPBOX_SCOPES,
			extraAuthorizeParams: remember ? { token_access_type: "offline" } : {},
		};
	}

	private requireToken(): string {
		const token = this.accountKey ? getAccessToken(this.accountKey) : null;
		if (!token) {
			throw new CloudError(
				"AUTH_REQUIRED",
				"Cloud authorization expired. Reconnect the source.",
			);
		}
		return token;
	}

	private async rpc<T>(path: string, body: unknown): Promise<T> {
		const token = this.requireToken();
		let res: Awaited<ReturnType<FetchImpl>>;
		try {
			res = await this.fetchImpl(`${API}${path}`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});
		} catch {
			throw new CloudError("NETWORK_ERROR", "Could not reach Dropbox.");
		}
		if (!res.ok) throw mapHttpError(res.status, `dropbox${path}`);
		return (await res.json()) as T;
	}

	async connect(options: ConnectOptions): Promise<void> {
		this.remember = options.remember ?? false;
		await startOAuth(
			this.oauthConfig(this.remember),
			PENDING_KEY,
			this.navigate,
		);
	}

	async completeConnection(fetchImpl: FetchImpl): Promise<CloudAccountInfo> {
		const roundTrip = takeOAuthRoundTrip();
		if (!roundTrip || roundTrip.accountKey !== PENDING_KEY) {
			throw new CloudError("OAUTH_CANCELLED", "Authorization was not granted.");
		}
		const callback = parseOAuthCallback(
			typeof window !== "undefined" ? window.location.href : "",
		);
		const tokens = await exchangeCode(
			this.oauthConfig(this.remember),
			roundTrip,
			callback,
			fetchImpl,
		);
		storeAccessToken(PENDING_KEY, tokens.accessToken, tokens.expiresIn);
		if (tokens.refreshToken) {
			storeRefreshToken(PENDING_KEY, tokens.refreshToken, this.remember);
		}
		this.accountKey = PENDING_KEY;
		const info = await this.getAccount(fetchImpl);
		if (!info) {
			throw new CloudError(
				"AUTH_REQUIRED",
				"Cloud authorization expired. Reconnect the source.",
			);
		}
		return info;
	}

	async getAccount(fetchImpl: FetchImpl): Promise<CloudAccountInfo | null> {
		void fetchImpl;
		let token = this.accountKey ? getAccessToken(this.accountKey) : null;
		if (!token && this.accountKey) token = await this.tryRefresh();
		if (!token) return null;
		let account: unknown;
		try {
			const res = await this.fetchImpl(`${API}/users/get_current_account`, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) {
				if (res.status === 401 || res.status === 403) return null;
				throw mapHttpError(res.status, "dropbox account");
			}
			account = await res.json();
		} catch (error) {
			if (error instanceof CloudError) throw error;
			throw new CloudError("NETWORK_ERROR", "Could not reach Dropbox.");
		}
		const body = account as {
			account_id?: string;
			name?: { display_name?: string };
			email?: string;
		};
		if (!body.account_id) return null;
		return {
			accountId: body.account_id,
			accountLabel: body.name?.display_name ?? body.email ?? "Dropbox",
		};
	}

	private async tryRefresh(): Promise<string | null> {
		if (!this.accountKey) return null;
		const refresh = getRefreshToken(this.accountKey);
		if (!refresh) return null;
		const clientId = getClientId(DROPBOX_ID);
		if (!clientId) return null;
		try {
			const tokens = await refreshAccessToken(
				TOKEN_URL,
				clientId,
				refresh,
				this.fetchImpl,
			);
			storeAccessToken(this.accountKey, tokens.accessToken, tokens.expiresIn);
			if (tokens.refreshToken) {
				storeRefreshToken(this.accountKey, tokens.refreshToken, true);
			}
			return tokens.accessToken;
		} catch {
			return null;
		}
	}

	/** Move pending login tokens onto the committed account key. */
	commitPending(accountKey: string): void {
		rekeyTokens(PENDING_KEY, accountKey);
		this.accountKey = accountKey;
	}

	async listRoots(fetchImpl: FetchImpl): Promise<CloudItem[]> {
		void fetchImpl;
		return [
			{
				id: "",
				name: "Dropbox",
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

	async listChildren(
		folderId: string,
		cursor: string | null,
		fetchImpl: FetchImpl,
	): Promise<CloudListing> {
		void fetchImpl;
		try {
			if (cursor) {
				const page = await this.rpc<{
					entries: DbxEntry[];
					cursor: string;
					has_more: boolean;
				}>("/files/list_folder/continue", { cursor });
				return {
					items: itemsOf(page.entries),
					nextCursor: page.has_more ? page.cursor : null,
				};
			}
			const page = await this.rpc<{
				entries: DbxEntry[];
				cursor: string;
				has_more: boolean;
			}>("/files/list_folder", {
				path: folderId === "" ? "" : folderId,
				recursive: false,
				limit: 100,
			});
			return {
				items: itemsOf(page.entries),
				nextCursor: page.has_more ? page.cursor : null,
			};
		} catch (error) {
			throw toCloudError(error, "dropbox list");
		}
	}

	async searchFiles(
		query: string,
		cursor: string | null,
		fetchImpl: FetchImpl,
	): Promise<CloudListing | null> {
		void fetchImpl;
		const q = query.trim();
		if (!q) return null;
		try {
			const page = await this.rpc<{
				matches: { metadata: { ".tag": string } & DbxEntry }[];
				cursor?: string;
				has_more?: boolean;
			}>("/files/search_v2", {
				query: q,
				options: { max_results: 100, ...(cursor ? { cursor } : {}) },
			});
			const entries = page.matches
				.map((m) => m.metadata)
				.filter(
					(e) => e[".tag"] === "folder" || isAudioFile(e.name ?? "", null),
				);
			return {
				items: itemsOf(entries),
				nextCursor: page.has_more && page.cursor ? page.cursor : null,
			};
		} catch (error) {
			throw toCloudError(error, "dropbox search");
		}
	}

	async getMetadata(
		fileId: string,
		fetchImpl: FetchImpl,
	): Promise<CloudItem | null> {
		void fetchImpl;
		try {
			const entry = await this.rpc<DbxEntry>("/files/get_metadata", {
				path: fileId,
			});
			return toItem(entry);
		} catch (error) {
			const mapped = toCloudError(error, "dropbox metadata");
			if (mapped.code === "NOT_FOUND") return null;
			throw mapped;
		}
	}

	async resolvePlaybackSource(
		fileId: string,
		_context: PlaybackContext,
	): Promise<ResolvedAudioSource> {
		let link: { link?: string };
		try {
			link = await this.rpc<{ link?: string }>("/files/get_temporary_link", {
				path: fileId,
			});
		} catch (error) {
			throw toCloudError(error, "dropbox temporary link");
		}
		if (!link.link) {
			throw new CloudError(
				"NOT_FOUND",
				"File is no longer available in the cloud account.",
			);
		}
		return {
			kind: "url",
			url: link.link,
			mimeType: null,
			expiresAt: Date.now() + TEMP_LINK_TTL_MS,
			supportsRange: true,
			refresh: () => this.resolvePlaybackSource(fileId, _context),
		};
	}

	async disconnect(): Promise<void> {
		const token = this.accountKey ? getAccessToken(this.accountKey) : null;
		if (token) {
			// Best-effort server-side revocation; local state clears regardless.
			try {
				await this.fetchImpl("https://api.dropboxapi.com/2/auth/token/revoke", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
				});
			} catch {
				// Disconnect is local-first; revocation failure is non-fatal.
			}
		}
		if (this.accountKey) clearTokens(this.accountKey);
		clearTokens(PENDING_KEY);
		this.accountKey = null;
	}
}

function itemsOf(entries: DbxEntry[]): CloudItem[] {
	const out: CloudItem[] = [];
	for (const entry of entries) {
		const item = toItem(entry);
		if (item) out.push(item);
	}
	return out;
}
