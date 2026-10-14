/**
 * Google Drive adapter (Drive API v3 + Google Identity Services).
 *
 * Verified against official documentation (see docs/cloud-music.md):
 * - `files.get?alt=media` returns raw bytes but needs an Authorization
 *   header the media element cannot send → NOT used for playback.
 * - `webContentLink` is the documented browser-download field: the element
 *   fetches it alone (Google session cookies), so no token ever enters a
 *   persisted URL. `capabilities.canDownload` is checked first.
 * - Partial downloads via Range are documented for content endpoints.
 * - `drive.file` is the narrow non-sensitive scope (per-file grants via
 *   Picker); whole-folder browsing needs `drive.readonly` (restricted —
 *   the UI says so before requesting it).
 * - Browser login uses the GIS token client (no client secret exists
 *   client-side; the user supplies their own OAuth client id).
 */

import { isAudioFile } from "./audio-formats";
import {
	CloudError,
	type CloudProviderId,
	type ProviderCapabilities,
} from "./model";
import { type FetchImpl, getHeader } from "./oauth";
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
	storeAccessToken,
} from "./token-store";

export const DRIVE_ID: CloudProviderId = "google-drive";

export const DRIVE_SCOPES_NARROW = [
	"https://www.googleapis.com/auth/drive.file",
];
export const DRIVE_SCOPES_BROAD = [
	"https://www.googleapis.com/auth/drive.readonly",
];

const API = "https://www.googleapis.com/drive/v3";
const GIS_SCRIPT = "https://accounts.google.com/gsi/client";
const PICKER_SCRIPT = "https://apis.google.com/js/api.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const META_FIELDS =
	"id,name,mimeType,size,modifiedTime,parents,capabilities(canDownload),webContentLink,md5Checksum";

export interface DriveTransport {
	fetchImpl: FetchImpl;
	loadScript(src: string): Promise<void>;
	popupToken(
		scopes: string[],
	): Promise<{ accessToken: string; expiresIn: number }>;
}

interface DriveFile {
	id?: string;
	name?: string;
	mimeType?: string;
	size?: string;
	modifiedTime?: string;
	parents?: string[];
	capabilities?: { canDownload?: boolean };
	webContentLink?: string;
	md5Checksum?: string;
}

function toItem(
	file: DriveFile,
	breadcrumb: string[] | null,
): CloudItem | null {
	if (!file.id || !file.name) return null;
	const folder = file.mimeType === FOLDER_MIME;
	return {
		id: file.id,
		name: file.name,
		kind: folder ? "folder" : "file",
		mimeType: file.mimeType ?? null,
		size: file.size !== undefined ? Number(file.size) : null,
		modifiedTime: file.modifiedTime ? Date.parse(file.modifiedTime) : null,
		revision: file.md5Checksum ?? null,
		path: breadcrumb,
		canDownload: file.capabilities?.canDownload ?? null,
	};
}

async function driveFetch(
	transport: DriveTransport,
	token: string,
	path: string,
	params: Record<string, string>,
): Promise<unknown> {
	const url = new URL(`${API}${path}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	let res: Awaited<ReturnType<FetchImpl>>;
	try {
		res = await transport.fetchImpl(url.toString(), {
			headers: { Authorization: `Bearer ${token}` },
		});
	} catch {
		throw new CloudError("NETWORK_ERROR", "Could not reach Google Drive.");
	}
	if (!res.ok) throw mapHttpError(res.status, `drive${path}`);
	return res.json();
}

export class GoogleDriveProvider implements CloudMusicProvider {
	readonly id: CloudProviderId = DRIVE_ID;
	readonly capabilities: ProviderCapabilities = {
		folderBrowse: true,
		metadataSearch: true,
		picker: true,
		directMediaUrl: "cookie-authenticated",
		temporaryUrl: false,
		rangeRequests: true,
		artwork: false,
		publicClientAuth: true,
		offlineMetadata: true,
	};

	private transport: DriveTransport;
	/** Local account key once committed (null while logged out). */
	private accountKey: string | null = null;
	private pendingScopes: string[] = [];

	constructor(transport?: Partial<DriveTransport>) {
		this.transport = {
			fetchImpl: transport?.fetchImpl ?? ((input, init) => fetch(input, init)),
			loadScript: transport?.loadScript ?? defaultLoadScript,
			popupToken:
				transport?.popupToken ?? ((scopes) => defaultPopupToken(scopes)),
		};
	}

	scopesFor(options: ConnectOptions): string[] {
		return options.broadAccess ? DRIVE_SCOPES_BROAD : DRIVE_SCOPES_NARROW;
	}

	setAccountKey(key: string | null): void {
		this.accountKey = key;
	}

	getAccountKey(): string | null {
		return this.accountKey;
	}

	private requireClientId(): string {
		const id = getClientId(DRIVE_ID);
		if (!id) {
			throw new CloudError(
				"NOT_CONFIGURED",
				"Add your Google OAuth client ID first (settings explain how).",
			);
		}
		return id;
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

	async connect(options: ConnectOptions): Promise<void> {
		this.requireClientId();
		const scopes = this.scopesFor(options);
		this.pendingScopes = scopes;
		let token: { accessToken: string; expiresIn: number };
		try {
			token = await this.transport.popupToken(scopes);
		} catch (error) {
			if (error instanceof CloudError) throw error;
			throw new CloudError("NETWORK_ERROR", "Could not reach Google accounts.");
		}
		// Park under a pending key; committed once the account is known.
		storeAccessToken(
			"google-drive:pending",
			token.accessToken,
			token.expiresIn,
		);
		this.accountKey = "google-drive:pending";
	}

	async completeConnection(fetchImpl: FetchImpl): Promise<CloudAccountInfo> {
		void fetchImpl;
		if (this.accountKey !== "google-drive:pending") {
			throw new CloudError("OAUTH_CANCELLED", "Authorization was not granted.");
		}
		const info = await this.getAccount(this.transport.fetchImpl);
		if (!info) {
			throw new CloudError(
				"AUTH_REQUIRED",
				"Cloud authorization expired. Reconnect the source.",
			);
		}
		return info;
	}

	getPendingScopes(): string[] {
		return this.pendingScopes;
	}

	async getAccount(fetchImpl: FetchImpl): Promise<CloudAccountInfo | null> {
		const token = this.accountKey ? getAccessToken(this.accountKey) : null;
		if (!token) return null;
		let about: unknown;
		try {
			const url = new URL(`${API}/about`);
			url.searchParams.set("fields", "user");
			const res = await fetchImpl(url.toString(), {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) {
				if (res.status === 401 || res.status === 403) return null;
				throw mapHttpError(res.status, "drive/about");
			}
			about = await res.json();
		} catch (error) {
			if (error instanceof CloudError) throw error;
			throw new CloudError("NETWORK_ERROR", "Could not reach Google Drive.");
		}
		const user = (
			about as {
				user?: {
					emailAddress?: string;
					displayName?: string;
					permissionId?: string;
				};
			}
		).user;
		const accountId = user?.permissionId ?? user?.emailAddress ?? "";
		if (!accountId) return null;
		return {
			accountId,
			accountLabel: user?.displayName ?? user?.emailAddress ?? "Google Drive",
		};
	}

	async listRoots(fetchImpl: FetchImpl): Promise<CloudItem[]> {
		void fetchImpl;
		return [
			{
				id: "root",
				name: "My Drive",
				kind: "folder",
				mimeType: FOLDER_MIME,
				size: null,
				modifiedTime: null,
				revision: null,
				path: null,
				canDownload: null,
			},
			{
				id: "sharedWithMe",
				name: "Shared with me",
				kind: "folder",
				mimeType: FOLDER_MIME,
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
		const token = this.requireToken();
		const parentClause =
			folderId === "sharedWithMe" ? "sharedWithMe" : `'${folderId}' in parents`;
		const params: Record<string, string> = {
			q: `${parentClause} and trashed = false`,
			fields: `nextPageToken,files(${META_FIELDS})`,
			orderBy: "folder,name",
			pageSize: "100",
		};
		if (cursor) params["pageToken"] = cursor;
		let payload: unknown;
		try {
			payload = await driveFetch(this.transport, token, "/files", params);
		} catch (error) {
			throw toCloudError(error, "drive list");
		}
		const body = payload as { files?: DriveFile[]; nextPageToken?: string };
		const items: CloudItem[] = [];
		for (const file of body.files ?? []) {
			const item = toItem(file, null);
			if (item) items.push(item);
		}
		return { items, nextCursor: body.nextPageToken ?? null };
	}

	async searchFiles(
		query: string,
		cursor: string | null,
		fetchImpl: FetchImpl,
	): Promise<CloudListing | null> {
		void fetchImpl;
		const q = query.trim();
		if (!q) return null;
		const token = this.requireToken();
		const safe = q.replaceAll("'", "\\'");
		const params: Record<string, string> = {
			q: `(name contains '${safe}' or fullText contains '${safe}') and trashed = false`,
			fields: `nextPageToken,files(${META_FIELDS})`,
			orderBy: "folder,name",
			pageSize: "100",
		};
		if (cursor) params["pageToken"] = cursor;
		let payload: unknown;
		try {
			payload = await driveFetch(this.transport, token, "/files", params);
		} catch (error) {
			throw toCloudError(error, "drive search");
		}
		const body = payload as { files?: DriveFile[]; nextPageToken?: string };
		const items: CloudItem[] = [];
		for (const file of body.files ?? []) {
			if (file.mimeType === FOLDER_MIME) {
				const folder = toItem(file, null);
				if (folder) items.push(folder);
				continue;
			}
			if (!isAudioFile(file.name ?? "", file.mimeType ?? null)) continue;
			const item = toItem(file, null);
			if (item) items.push(item);
		}
		return { items, nextCursor: body.nextPageToken ?? null };
	}

	async getMetadata(
		fileId: string,
		fetchImpl: FetchImpl,
	): Promise<CloudItem | null> {
		void fetchImpl;
		const token = this.requireToken();
		let payload: unknown;
		try {
			payload = await driveFetch(
				this.transport,
				token,
				`/files/${encodeURIComponent(fileId)}`,
				{
					fields: META_FIELDS,
				},
			);
		} catch (error) {
			const mapped = toCloudError(error, "drive metadata");
			if (mapped.code === "NOT_FOUND") return null;
			throw mapped;
		}
		return toItem(payload as DriveFile, null);
	}

	async resolvePlaybackSource(
		fileId: string,
		context: PlaybackContext,
	): Promise<ResolvedAudioSource> {
		const meta = await this.getMetadata(fileId, context.fetchImpl);
		if (!meta) {
			throw new CloudError(
				"NOT_FOUND",
				"File is no longer available in the cloud account.",
			);
		}
		if (meta.canDownload === false) {
			throw new CloudError(
				"ACCESS_DENIED",
				"File is no longer shared with this account.",
			);
		}
		const link = await this.playbackLink(fileId, context.fetchImpl);
		if (!link) {
			throw new CloudError(
				"ACCESS_DENIED",
				"File is no longer shared with this account.",
			);
		}
		return {
			kind: "url",
			url: link,
			mimeType: meta.mimeType,
			expiresAt: 0,
			supportsRange: true,
			refresh: () => this.resolvePlaybackSource(fileId, context),
		};
	}

	private async playbackLink(
		fileId: string,
		fetchImpl: FetchImpl,
	): Promise<string | null> {
		void fetchImpl;
		const token = this.requireToken();
		let payload: unknown;
		try {
			payload = await driveFetch(
				this.transport,
				token,
				`/files/${encodeURIComponent(fileId)}`,
				{ fields: "id,webContentLink,capabilities(canDownload)" },
			);
		} catch (error) {
			throw toCloudError(error, "drive playback link");
		}
		const file = payload as DriveFile;
		if (file.capabilities?.canDownload === false) return null;
		return file.webContentLink ?? null;
	}

	/**
	 * Google Picker selection (per-file grants under drive.file): returns
	 * picked file ids. The Picker script loads on demand; when blocked,
	 * callers fall back to files.list with a clear PICKER_UNAVAILABLE.
	 */
	async pickFiles(
		selectFolder: boolean,
	): Promise<{ id: string; name: string }[]> {
		const token = this.requireToken();
		try {
			await this.transport.loadScript(PICKER_SCRIPT);
		} catch {
			throw new CloudError(
				"PICKER_UNAVAILABLE",
				"Google Picker could not load (network blocked). Browse files instead.",
			);
		}
		return pickWithGoogle(token, selectFolder);
	}

	async acceptPickedIds(ids: string[]): Promise<CloudItem[]> {
		const out: CloudItem[] = [];
		for (const id of ids.slice(0, 500)) {
			const meta = await this.getMetadata(id, this.transport.fetchImpl);
			if (
				meta &&
				(meta.kind === "folder" || isAudioFile(meta.name, meta.mimeType))
			) {
				out.push(meta);
			}
		}
		return out;
	}

	async disconnect(): Promise<void> {
		if (this.accountKey) clearTokens(this.accountKey);
		this.accountKey = null;
		this.pendingScopes = [];
	}
}

function defaultLoadScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		if (typeof document === "undefined") {
			reject(new Error("no document"));
			return;
		}
		if (document.querySelector(`script[src="${src}"]`)) {
			resolve();
			return;
		}
		const el = document.createElement("script");
		el.src = src;
		el.async = true;
		el.onload = () => resolve();
		el.onerror = () => reject(new Error(`script load failed: ${src}`));
		document.head.appendChild(el);
	});
}

interface GisTokenClient {
	requestAccessToken(options?: { prompt?: string }): void;
}

declare global {
	interface Window {
		google?: {
			accounts?: {
				oauth2?: {
					initTokenClient(options: {
						client_id: string;
						scope: string;
						callback: (response: {
							access_token?: string;
							expires_in?: number;
							error?: string;
						}) => void;
					}): GisTokenClient;
				};
			};
			picker?: unknown;
		};
		gapi?: unknown;
	}
}

async function defaultPopupToken(
	scopes: string[],
): Promise<{ accessToken: string; expiresIn: number }> {
	const clientId = getClientId(DRIVE_ID);
	if (!clientId) {
		throw new CloudError(
			"NOT_CONFIGURED",
			"Add your Google OAuth client ID first (settings explain how).",
		);
	}
	await defaultLoadScript(GIS_SCRIPT);
	const oauth2 = window.google?.accounts?.oauth2;
	if (!oauth2) {
		throw new CloudError(
			"NETWORK_ERROR",
			"Google accounts script was blocked. Check connection or extensions.",
		);
	}
	return new Promise((resolve, reject) => {
		let client: GisTokenClient;
		try {
			client = oauth2.initTokenClient({
				client_id: clientId,
				scope: scopes.join(" "),
				callback: (response) => {
					if (response.error || !response.access_token) {
						reject(
							new CloudError(
								"OAUTH_CANCELLED",
								"Authorization was not granted.",
							),
						);
						return;
					}
					resolve({
						accessToken: response.access_token,
						expiresIn: response.expires_in ?? 3600,
					});
				},
			});
		} catch {
			reject(
				new CloudError("NETWORK_ERROR", "Could not reach Google accounts."),
			);
			return;
		}
		try {
			client.requestAccessToken();
		} catch {
			reject(
				new CloudError("OAUTH_CANCELLED", "Authorization was not granted."),
			);
		}
	});
}

/** Minimal structural types for the dynamically loaded Picker API. */
interface PickerBuilderChain {
	addView(view: unknown): PickerBuilderChain;
	setOAuthToken(token: string): PickerBuilderChain;
	enableFeature(feature: string): PickerBuilderChain;
	setCallback(cb: (data: Record<string, unknown>) => void): PickerBuilderChain;
	build(): { setVisible(visible: boolean): void };
}

interface PickerNamespace {
	ViewId: { DOCS: string };
	Action: { PICKED: string };
	Response: { ACTION: string; DOCUMENTS: string };
	Document: { ID: string; NAME: string };
	Feature: { MULTISELECT_ENABLED: string };
	DocsView: new (
		viewId?: string,
	) => {
		setMimeTypes(types: string): unknown;
		setIncludeFolders(include: boolean): unknown;
		setSelectFolderEnabled(enabled: boolean): unknown;
	};
	PickerBuilder: new () => PickerBuilderChain;
}

/** Audio MIME filter for the Picker docs view. */
const PICKER_AUDIO_MIMES = [
	"audio/mpeg",
	"audio/flac",
	"audio/wav",
	"audio/x-wav",
	"audio/ogg",
	"audio/opus",
	"audio/mp4",
	"audio/aac",
	"audio/aiff",
	"audio/x-aiff",
	"audio/webm",
].join(",");

/**
 * Real Google Picker integration (loaded on demand; nothing bundled).
 * Under drive.file this is the narrow-permission route: the user picks
 * files/folders and Drive grants this app access to exactly those ids.
 */
function pickWithGoogle(
	token: string,
	selectFolder: boolean,
): Promise<{ id: string; name: string }[]> {
	return new Promise((resolve, reject) => {
		const fail = (): CloudError =>
			new CloudError(
				"PICKER_UNAVAILABLE",
				"Google Picker could not load (network blocked). Browse files instead.",
			);
		const gapi = window.gapi as
			| {
					load?: (api: string, callback: () => void) => void;
			  }
			| undefined;
		if (!gapi?.load) {
			reject(fail());
			return;
		}
		gapi.load("picker", () => {
			try {
				const picker = window.google?.picker as unknown as
					| PickerNamespace
					| undefined;
				if (!picker) {
					reject(fail());
					return;
				}
				const view = new picker.DocsView(picker.ViewId.DOCS);
				view.setMimeTypes(PICKER_AUDIO_MIMES);
				view.setIncludeFolders(true);
				view.setSelectFolderEnabled(selectFolder);
				const built = new picker.PickerBuilder()
					.addView(view)
					.setOAuthToken(token)
					.enableFeature(picker.Feature.MULTISELECT_ENABLED)
					.setCallback((data: Record<string, unknown>) => {
						if (data[picker.Response.ACTION] === picker.Action.PICKED) {
							const docs = data[picker.Response.DOCUMENTS] as
								| Record<string, unknown>[]
								| undefined;
							resolve(
								(docs ?? []).flatMap((d) => {
									const id = d[picker.Document.ID];
									const name = d[picker.Document.NAME];
									return typeof id === "string" && typeof name === "string"
										? [{ id, name }]
										: [];
								}),
							);
						} else {
							resolve([]);
						}
					})
					.build();
				built.setVisible(true);
			} catch {
				reject(fail());
			}
		});
	});
}

export { getHeader };
