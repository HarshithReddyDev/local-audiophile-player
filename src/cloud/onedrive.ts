/**
 * OneDrive adapter (Microsoft Graph v1.0, delegated Files.Read).
 *
 * Verified against official documentation (see docs/cloud-music.md):
 * - `GET /me/drive/items/{id}/content` 302-redirects to a
 *   pre-authenticated download URL — the same URL exposed as
 *   `@microsoft.graph.downloadUrl`, which the docs direct JavaScript
 *   apps to use precisely to avoid CORS preflights. No Authorization
 *   header needed on the media element.
 * - Those URLs expire within minutes: resolved fresh per playback and
 *   refreshed on expiry (never persisted).
 * - Range requests against the download URL are documented (seek works).
 * - Least-privilege delegated scopes: Files.Read (+ User.Read for the
 *   stable account id). No write permissions requested.
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

export const ONEDRIVE_ID: CloudProviderId = "one-drive";

const AUTHORIZE_URL =
	"https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH = "https://graph.microsoft.com/v1.0";

export const ONEDRIVE_SCOPES = ["Files.Read", "User.Read"];

/** Expiry headroom for pre-authenticated URLs ("minutes", per docs). */
const DOWNLOAD_URL_TTL_MS = 5 * 60 * 1000;

const PENDING_KEY = "one-drive:pending";

interface GraphItem {
	id?: string;
	name?: string;
	folder?: unknown;
	file?: { mimeType?: string };
	size?: number;
	lastModifiedDateTime?: string;
	cTag?: string;
	eTag?: string;
	parentReference?: { path?: string };
	"@microsoft.graph.downloadUrl"?: string;
}

function toItem(
	item: GraphItem,
	breadcrumb: string[] | null,
): CloudItem | null {
	if (!item.id || !item.name) return null;
	const folder = item.folder !== undefined;
	return {
		id: item.id,
		name: item.name,
		kind: folder ? "folder" : "file",
		mimeType: folder ? null : (item.file?.mimeType ?? null),
		size: typeof item.size === "number" ? item.size : null,
		modifiedTime: item.lastModifiedDateTime
			? Date.parse(item.lastModifiedDateTime)
			: null,
		revision: item.cTag ?? item.eTag ?? null,
		path: breadcrumb,
		canDownload: folder ? null : true,
	};
}

function breadcrumbOf(item: GraphItem): string[] | null {
	const path = item.parentReference?.path;
	if (!path) return null;
	// "/drive/root:/Music/Album" → ["Music", "Album"]
	const match = /:\/(.*)$/.exec(path);
	if (!match?.[1]) return null;
	const parts = match[1].split("/").filter(Boolean);
	return parts.length > 0 ? parts : null;
}

export class OneDriveProvider implements CloudMusicProvider {
	readonly id: CloudProviderId = ONEDRIVE_ID;
	readonly usesRedirectFlow = true;
	readonly capabilities: ProviderCapabilities = {
		folderBrowse: true,
		metadataSearch: true,
		picker: false,
		directMediaUrl: "pre-authenticated",
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
		return [...ONEDRIVE_SCOPES];
	}

	setAccountKey(key: string | null): void {
		this.accountKey = key;
	}

	getAccountKey(): string | null {
		return this.accountKey;
	}

	private oauthConfig(): OAuthConfig {
		const clientId = getClientId(ONEDRIVE_ID);
		if (!clientId) {
			throw new CloudError(
				"NOT_CONFIGURED",
				"Add your Microsoft app (client) ID first (settings explain how).",
			);
		}
		return {
			authorizeUrl: AUTHORIZE_URL,
			tokenUrl: TOKEN_URL,
			clientId,
			redirectUri: defaultRedirectUri(),
			scopes: ONEDRIVE_SCOPES,
			extraAuthorizeParams: { response_mode: "query" },
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

	private async graph(
		path: string,
		params?: Record<string, string>,
	): Promise<unknown> {
		const token = this.requireToken();
		const url = new URL(`${GRAPH}${path}`);
		if (params)
			for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		let res: Awaited<ReturnType<FetchImpl>>;
		try {
			res = await this.fetchImpl(url.toString(), {
				headers: { Authorization: `Bearer ${token}` },
			});
		} catch {
			throw new CloudError("NETWORK_ERROR", "Could not reach Microsoft Graph.");
		}
		if (!res.ok) throw mapHttpError(res.status, `graph${path}`);
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
		const { parseOAuthCallback } = await import("./oauth");
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
		if (!token && this.accountKey) {
			token = await this.tryRefresh();
		}
		if (!token) return null;
		let me: unknown;
		try {
			const url = new URL(`${GRAPH}/me`);
			url.searchParams.set("$select", "id,displayName,mail,userPrincipalName");
			const res = await this.fetchImpl(url.toString(), {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) {
				if (res.status === 401 || res.status === 403) return null;
				throw mapHttpError(res.status, "graph/me");
			}
			me = await res.json();
		} catch (error) {
			if (error instanceof CloudError) throw error;
			throw new CloudError("NETWORK_ERROR", "Could not reach Microsoft Graph.");
		}
		const user = me as {
			id?: string;
			displayName?: string;
			mail?: string;
			userPrincipalName?: string;
		};
		if (!user.id) return null;
		return {
			accountId: user.id,
			accountLabel:
				user.displayName ?? user.mail ?? user.userPrincipalName ?? "OneDrive",
		};
	}

	private async tryRefresh(): Promise<string | null> {
		if (!this.accountKey) return null;
		const refresh = getRefreshToken(this.accountKey);
		if (!refresh) return null;
		const clientId = getClientId(ONEDRIVE_ID);
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

	async listChildren(
		folderId: string,
		cursor: string | null,
		fetchImpl: FetchImpl,
	): Promise<CloudListing> {
		void fetchImpl;
		let payload: unknown;
		try {
			if (cursor) {
				const token = this.requireToken();
				const res = await this.fetchImpl(cursor, {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (!res.ok) throw mapHttpError(res.status, "graph paging");
				payload = await res.json();
			} else {
				const path =
					folderId === "root"
						? "/me/drive/root/children"
						: `/me/drive/items/${encodeURIComponent(folderId)}/children`;
				payload = await this.graph(path, {
					$top: "100",
					$select:
						"id,name,folder,file,size,lastModifiedDateTime,cTag,eTag,parentReference",
					$orderby: "folder,name",
				});
			}
		} catch (error) {
			throw toCloudError(error, "onedrive list");
		}
		return pageOf(payload);
	}

	async searchFiles(
		query: string,
		cursor: string | null,
		fetchImpl: FetchImpl,
	): Promise<CloudListing | null> {
		void fetchImpl;
		const q = query.trim();
		if (!q) return null;
		let payload: unknown;
		try {
			if (cursor) {
				const token = this.requireToken();
				const res = await this.fetchImpl(cursor, {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (!res.ok) throw mapHttpError(res.status, "graph paging");
				payload = await res.json();
			} else {
				payload = await this.graph(
					`/me/drive/root/search(q='${encodeURIComponent(q)}')`,
					{
						$top: "100",
						$select:
							"id,name,folder,file,size,lastModifiedDateTime,cTag,eTag,parentReference",
					},
				);
			}
		} catch (error) {
			throw toCloudError(error, "onedrive search");
		}
		const listing = pageOf(payload);
		// Server search is full-text: keep audio files and folders only.
		return {
			items: listing.items.filter(
				(item) =>
					item.kind === "folder" || isAudioFile(item.name, item.mimeType),
			),
			nextCursor: listing.nextCursor,
		};
	}

	async getMetadata(
		fileId: string,
		fetchImpl: FetchImpl,
	): Promise<CloudItem | null> {
		void fetchImpl;
		let payload: unknown;
		try {
			payload = await this.graph(
				`/me/drive/items/${encodeURIComponent(fileId)}`,
				{
					$select:
						"id,name,folder,file,size,lastModifiedDateTime,cTag,eTag,parentReference",
				},
			);
		} catch (error) {
			const mapped = toCloudError(error, "onedrive metadata");
			if (mapped.code === "NOT_FOUND") return null;
			throw mapped;
		}
		return toItem(payload as GraphItem, breadcrumbOf(payload as GraphItem));
	}

	async resolvePlaybackSource(
		fileId: string,
		context: PlaybackContext,
	): Promise<ResolvedAudioSource> {
		let payload: unknown;
		try {
			const token = this.requireToken();
			const url = new URL(
				`${GRAPH}/me/drive/items/${encodeURIComponent(fileId)}`,
			);
			url.searchParams.set("$select", "id,file,@microsoft.graph.downloadUrl");
			const res = await context.fetchImpl(url.toString(), {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) throw mapHttpError(res.status, "graph downloadUrl");
			payload = await res.json();
		} catch (error) {
			throw toCloudError(error, "onedrive playback url");
		}
		const item = payload as GraphItem;
		const downloadUrl = item["@microsoft.graph.downloadUrl"];
		if (!downloadUrl) {
			throw new CloudError(
				"NOT_FOUND",
				"File is no longer available in the cloud account.",
			);
		}
		return {
			kind: "url",
			url: downloadUrl,
			mimeType: item.file?.mimeType ?? null,
			expiresAt: Date.now() + DOWNLOAD_URL_TTL_MS,
			supportsRange: true,
			refresh: () => this.resolvePlaybackSource(fileId, context),
		};
	}

	async disconnect(): Promise<void> {
		if (this.accountKey) clearTokens(this.accountKey);
		clearTokens(PENDING_KEY);
		this.accountKey = null;
	}
}

function pageOf(payload: unknown): CloudListing {
	const body = payload as {
		value?: GraphItem[];
		"@odata.nextLink"?: string;
	};
	const items: CloudItem[] = [];
	for (const entry of body.value ?? []) {
		const item = toItem(entry, breadcrumbOf(entry));
		if (item) items.push(item);
	}
	return { items, nextCursor: body["@odata.nextLink"] ?? null };
}
