/**
 * Box adapter (Box Platform API 2.0, PKCE public-client flow).
 *
 * Verified against official documentation (see docs/cloud-music.md):
 * - `GET /2.0/files/{id}/content` downloads bytes with an Authorization
 *   header the media element cannot send — but the same endpoint accepts
 *   a documented `access_token` query parameter for pre-authentication,
 *   explicitly so "a download link can be shared with a browser".
 *   The token travels in a memory-only resolved URL (never persisted);
 *   Box's own guidance is to scope such tokens read-only, which matches
 *   our `root_readonly` request.
 * - Preferred delivery is the 302 `Location` (dl.boxcloud.com) captured
 *   with a manual redirect; the `access_token` URL is the fallback.
 * - Range downloads are documented for the content endpoint (seek works).
 * - Folder items paging is offset-based; `search` filters file types.
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
	getHeader,
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

export const BOX_ID: CloudProviderId = "box";

const AUTHORIZE_URL = "https://account.box.com/api/oauth2/authorize";
const TOKEN_URL = "https://api.box.com/oauth2/token";
const API = "https://api.box.com/2.0";

export const BOX_SCOPES = ["root_readonly"];

const PENDING_KEY = "box:pending";
const PAGE_LIMIT = 100;

interface BoxEntry {
	type?: "file" | "folder" | string;
	id?: string;
	name?: string;
	size?: number;
	modified_at?: string;
	etag?: string;
	extension?: string;
	shared_link?: { download_url?: string } | null;
}

function toItem(entry: BoxEntry): CloudItem | null {
	if (!entry.id || !entry.name) return null;
	if (entry.type === "folder") {
		return {
			id: entry.id,
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
	if (entry.type !== "file") return null;
	return {
		id: entry.id,
		name: entry.name,
		kind: "file",
		mimeType: null,
		size: entry.size ?? null,
		modifiedTime: entry.modified_at ? Date.parse(entry.modified_at) : null,
		revision: entry.etag ?? null,
		path: null,
		canDownload: true,
	};
}

export class BoxProvider implements CloudMusicProvider {
	readonly id: CloudProviderId = BOX_ID;
	readonly usesRedirectFlow = true;
	readonly capabilities: ProviderCapabilities = {
		folderBrowse: true,
		metadataSearch: true,
		picker: false,
		directMediaUrl: "scoped-token-url",
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
		return [...BOX_SCOPES];
	}

	setAccountKey(key: string | null): void {
		this.accountKey = key;
	}

	getAccountKey(): string | null {
		return this.accountKey;
	}

	private oauthConfig(): OAuthConfig {
		const clientId = getClientId(BOX_ID);
		if (!clientId) {
			throw new CloudError(
				"NOT_CONFIGURED",
				"Add your Box app client ID first (settings explain how).",
			);
		}
		return {
			authorizeUrl: AUTHORIZE_URL,
			tokenUrl: TOKEN_URL,
			clientId,
			redirectUri: defaultRedirectUri(),
			scopes: BOX_SCOPES,
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

	private async api(
		path: string,
		params?: Record<string, string>,
	): Promise<unknown> {
		const token = this.requireToken();
		const url = new URL(`${API}${path}`);
		if (params)
			for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		let res: Awaited<ReturnType<FetchImpl>>;
		try {
			res = await this.fetchImpl(url.toString(), {
				headers: { Authorization: `Bearer ${token}` },
			});
		} catch {
			throw new CloudError("NETWORK_ERROR", "Could not reach Box.");
		}
		if (!res.ok) throw mapHttpError(res.status, `box${path}`);
		return res.json();
	}

	async connect(options: ConnectOptions): Promise<void> {
		this.remember = options.remember ?? false;
		await startOAuth(this.oauthConfig(), PENDING_KEY, this.navigate);
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
			this.oauthConfig(),
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
		let me: unknown;
		try {
			const res = await this.fetchImpl(`${API}/users/me?fields=id,name,login`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) {
				if (res.status === 401 || res.status === 403) return null;
				throw mapHttpError(res.status, "box/me");
			}
			me = await res.json();
		} catch (error) {
			if (error instanceof CloudError) throw error;
			throw new CloudError("NETWORK_ERROR", "Could not reach Box.");
		}
		const user = me as { id?: string; name?: string; login?: string };
		if (!user.id) return null;
		return {
			accountId: user.id,
			accountLabel: user.name ?? user.login ?? "Box",
		};
	}

	private async tryRefresh(): Promise<string | null> {
		if (!this.accountKey) return null;
		const refresh = getRefreshToken(this.accountKey);
		if (!refresh) return null;
		const clientId = getClientId(BOX_ID);
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
				id: "0",
				name: "Box",
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
			const payload = await this.api(
				`/folders/${encodeURIComponent(folderId)}/items`,
				{
					fields: "id,name,type,size,modified_at,etag,extension",
					limit: String(PAGE_LIMIT),
					offset: cursor ?? "0",
				},
			);
			const body = payload as { entries?: BoxEntry[]; total_count?: number };
			const items: CloudItem[] = [];
			for (const entry of body.entries ?? []) {
				const item = toItem(entry);
				if (item) items.push(item);
			}
			const offset = Number(cursor ?? "0") + (body.entries ?? []).length;
			const nextCursor =
				body.total_count !== undefined && offset < body.total_count
					? String(offset)
					: null;
			return { items, nextCursor };
		} catch (error) {
			throw toCloudError(error, "box list");
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
			const payload = await this.api("/search", {
				query: q,
				type: "file",
				file_extensions: "mp3,wav,flac,ogg,oga,opus,m4a,aac,aiff,webm",
				limit: String(PAGE_LIMIT),
				offset: cursor ?? "0",
			});
			const body = payload as { entries?: BoxEntry[]; total_count?: number };
			const items: CloudItem[] = [];
			for (const entry of body.entries ?? []) {
				if (entry.type !== "file") continue;
				if (!isAudioFile(entry.name ?? "", null)) continue;
				const item = toItem(entry);
				if (item) items.push(item);
			}
			const offset = Number(cursor ?? "0") + (body.entries ?? []).length;
			const nextCursor =
				body.total_count !== undefined && offset < body.total_count
					? String(offset)
					: null;
			return { items, nextCursor };
		} catch (error) {
			throw toCloudError(error, "box search");
		}
	}

	async getMetadata(
		fileId: string,
		fetchImpl: FetchImpl,
	): Promise<CloudItem | null> {
		void fetchImpl;
		try {
			const payload = await this.api(`/files/${encodeURIComponent(fileId)}`, {
				fields: "id,name,type,size,modified_at,etag,extension",
			});
			return toItem(payload as BoxEntry);
		} catch (error) {
			const mapped = toCloudError(error, "box metadata");
			if (mapped.code === "NOT_FOUND") return null;
			throw mapped;
		}
	}

	async resolvePlaybackSource(
		fileId: string,
		_context: PlaybackContext,
	): Promise<ResolvedAudioSource> {
		const token = this.requireToken();
		// Prefer the 302 Location (no token in the element URL)…
		try {
			const res = await this.fetchImpl(
				`${API}/files/${encodeURIComponent(fileId)}/content`,
				{
					headers: { Authorization: `Bearer ${token}` },
					redirect: "manual",
				},
			);
			const location = getHeader(res, "location");
			if ((res.status === 302 || res.status === 301) && location) {
				return {
					kind: "url",
					url: location,
					mimeType: null,
					expiresAt: 0,
					supportsRange: true,
					refresh: () => this.resolvePlaybackSource(fileId, _context),
				};
			}
			if (!res.ok && res.status !== 302 && res.status !== 301) {
				throw mapHttpError(res.status, "box content");
			}
		} catch (error) {
			if (error instanceof CloudError) throw error;
			throw new CloudError("NETWORK_ERROR", "Could not reach Box.");
		}
		// …fall back to the documented pre-authenticated access_token URL
		// (memory-only resolved URL; read-only token; never persisted).
		return {
			kind: "url",
			url: `${API}/files/${encodeURIComponent(fileId)}/content?access_token=${encodeURIComponent(token)}`,
			mimeType: null,
			expiresAt: 0,
			supportsRange: true,
			refresh: () => this.resolvePlaybackSource(fileId, _context),
		};
	}

	async disconnect(): Promise<void> {
		const token = this.accountKey ? getAccessToken(this.accountKey) : null;
		if (token) {
			try {
				await this.fetchImpl("https://api.box.com/oauth2/revoke", {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						client_id: getClientId(BOX_ID) ?? "",
						token,
					}),
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
